const axios = require('axios');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const https = require('https');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const CLIENT_ID         = process.env.CLIENT_ID;
const CLIENT_SECRET     = process.env.CLIENT_SECRET;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const AUTH_URL        = 'https://apis.usps.com/oauth2/v3/token';
const ZIPCODE_API_URL = 'https://apis.usps.com/addresses/v3/zipcode';

// ─── Axios instance with keep-alive ──────────────────────────────────────────
const axiosInstance = axios.create({
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 50 }),
  timeout: 10000,
});

// ─── Token Management ─────────────────────────────────────────────────────────
let TOKEN_INFO = {
  access_token: process.env.ACCESS_TOKEN || '',
  expires_at: 0,
};
let HEADERS = {
  Authorization: `Bearer ${TOKEN_INFO.access_token}`,
  'Content-Type': 'application/json',
};
let tokenRefreshPromise = null;

function isTokenValid() {
  return !!TOKEN_INFO.access_token && Date.now() < TOKEN_INFO.expires_at;
}

async function refreshUspsToken() {
  if (tokenRefreshPromise) return tokenRefreshPromise;
  tokenRefreshPromise = (async () => {
    try {
      const authData = new URLSearchParams();
      authData.append('grant_type', 'client_credentials');
      authData.append('client_id', CLIENT_ID);
      authData.append('client_secret', CLIENT_SECRET);
      const response = await axiosInstance.post(AUTH_URL, authData.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      TOKEN_INFO.access_token = response.data.access_token;
      TOKEN_INFO.expires_at   = Date.now() + response.data.expires_in * 1000 - 60000;
      HEADERS.Authorization   = `Bearer ${TOKEN_INFO.access_token}`;
      process.env.ACCESS_TOKEN = TOKEN_INFO.access_token;
      console.log('USPS Bearer token refreshed successfully');
    } catch (error) {
      console.error('Error refreshing USPS token:', error.response?.data || error.message);
      throw error;
    } finally {
      tokenRefreshPromise = null;
    }
  })();
  return tokenRefreshPromise;
}

// ─── US State name → abbreviation map ────────────────────────────────────────
// Handles cases like "Marion Indiana, IN" where full state name bleeds into city
const STATE_NAME_TO_ABBR = {
  'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR',
  'CALIFORNIA': 'CA', 'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE',
  'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI', 'IDAHO': 'ID',
  'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA', 'KANSAS': 'KS',
  'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD',
  'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS',
  'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH', 'OKLAHOMA': 'OK',
  'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT',
  'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV',
  'WISCONSIN': 'WI', 'WYOMING': 'WY', 'DISTRICT OF COLUMBIA': 'DC',
};

const VALID_STATE_ABBRS = new Set(Object.values(STATE_NAME_TO_ABBR));

// ─── Data Validation & Cleaning ───────────────────────────────────────────────

// Sentinel string values that mean "no data" — treat as null
const NULL_SENTINEL_VALUES = new Set([
  'NULL', 'N/A', 'NA', 'NONE', 'UNKNOWN', 'N.A.', '-', '--', 'N/A.', ''
]);

/**
 * Returns cleaned string or null if the value is empty/null-like.
 */
function cleanField(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (NULL_SENTINEL_VALUES.has(s.toUpperCase())) return null;
  return s || null;
}

/**
 * Cleans and validates city field.
 * Handles cases like "Marion Indiana" → "Marion" by stripping trailing state names.
 */
function cleanCity(rawCity) {
  const city = cleanField(rawCity);
  if (!city) return null;

  let cleaned = city.trim();

  // Strip trailing full state names (e.g. "Marion Indiana" → "Marion")
  for (const stateName of Object.keys(STATE_NAME_TO_ABBR)) {
    const pattern = new RegExp(`\\s+${stateName}$`, 'i');
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, '').trim();
      break;
    }
  }

  return cleaned || null;
}

/**
 * Cleans and validates state field.
 * Accepts both abbreviations ("IL") and full names ("Illinois").
 * Returns 2-letter abbreviation or null.
 */
function cleanState(rawState) {
  const state = cleanField(rawState);
  if (!state) return null;

  const upper = state.toUpperCase().trim();

  // Already a valid 2-letter abbreviation
  if (VALID_STATE_ABBRS.has(upper)) return upper;

  // Full state name — convert to abbreviation
  if (STATE_NAME_TO_ABBR[upper]) return STATE_NAME_TO_ABBR[upper];

  // Could not resolve to a valid US state
  return null;
}

/**
 * Cleans and validates street address field.
 * Rejects values that are clearly not street addresses (ZIP codes, PO Box formats, etc).
 */
function cleanStreetAddress(rawAddress) {
  const address = cleanField(rawAddress);
  if (!address) return null;

  const upper = address.toUpperCase().trim();

  // Reject if it looks like just a ZIP code (5-digit or ZIP+4)
  if (/^\d{5}(-\d{4})?$/.test(upper)) return null;

  // Normalize address abbreviations
  let normalized = upper.replace(/\s+/g, ' ');
  const abbreviations = {
    '\\bROAD\\b': 'RD',   '\\bSTREET\\b': 'ST',   '\\bAVENUE\\b': 'AVE',
    '\\bLANE\\b': 'LN',   '\\bBOULEVARD\\b': 'BLVD', '\\bNORTHEAST\\b': 'NE',
    '\\bSOUTHEAST\\b': 'SE', '\\bNORTHWEST\\b': 'NW', '\\bSOUTHWEST\\b': 'SW',
    '\\bDRIVE\\b': 'DR',  '\\bCOURT\\b': 'CT',    '\\bPLACE\\b': 'PL',
    '\\bCIRCLE\\b': 'CIR', '\\bTRAIL\\b': 'TRL',  '\\bPARKWAY\\b': 'PKWY',
    '\\bHIGHWAY\\b': 'HWY',
  };
  for (const [pattern, abbr] of Object.entries(abbreviations)) {
    normalized = normalized.replace(new RegExp(pattern, 'g'), abbr);
  }

  return normalized;
}

/**
 * Validates and cleans all three address fields together.
 * Returns { streetAddress, city, state } or null if invalid.
 * Also returns a reason string for logging skipped rows.
 */
function validateAndCleanAddress(rawStreet, rawCity, rawState) {
  const streetAddress = cleanStreetAddress(rawStreet);
  const city          = cleanCity(rawCity);
  const state         = cleanState(rawState);

  const issues = [];
  if (!streetAddress) issues.push(`invalid street: "${rawStreet}"`);
  if (!city)          issues.push(`invalid city: "${rawCity}"`);
  if (!state)         issues.push(`invalid state: "${rawState}"`);

  if (issues.length > 0) {
    return { valid: false, reason: issues.join(', ') };
  }

  return { valid: true, streetAddress, city, state };
}

// ─── Cache Key ────────────────────────────────────────────────────────────────
function getCacheKey(streetAddress, city, state) {
  return `${streetAddress.toUpperCase().trim()}|${city.toUpperCase().trim()}|${state.toUpperCase().trim()}`;
}

// ─── In-Memory Runtime Cache ──────────────────────────────────────────────────
const addressCache = new Map();

// ─── File-Based Cache ─────────────────────────────────────────────────────────
let fileAddressMap = null;

async function loadAddressFile() {
  const filePath = path.join(__dirname, 'addresses.txt');
  fileAddressMap = new Map();
  if (!fs.existsSync(filePath)) return;

  return new Promise((resolve) => {
    fs.createReadStream(filePath)
      .pipe(csv({ headers: ['StreetAddress', 'City', 'State', 'ZIPCode', 'ZIPPlus4'], skipLines: 1 }))
      .on('data', (data) => {
        if (data.StreetAddress && data.City && data.State && data.ZIPCode) {
          const key = getCacheKey(data.StreetAddress, data.City, data.State);
          fileAddressMap.set(key, { ZIPCode: data.ZIPCode, ZIPPlus4: data.ZIPPlus4 || '' });
        }
      })
      .on('end', resolve)
      .on('error', (err) => { console.error('Error loading addresses.txt:', err); resolve(); });
  });
}

function checkAddressInMemory(streetAddress, city, state) {
  if (!fileAddressMap) return null;
  return fileAddressMap.get(getCacheKey(streetAddress, city, state)) || null;
}

// ─── Debounced Batch File Writes ──────────────────────────────────────────────
const pendingFileWrites = [];
let fileWriteTimer = null;

function queueAddressWrite({ streetAddress, city, state, ZIPCode, ZIPPlus4 }) {
  const key = getCacheKey(streetAddress, city, state);
  if (fileAddressMap) fileAddressMap.set(key, { ZIPCode, ZIPPlus4: ZIPPlus4 || '' });
  pendingFileWrites.push({ StreetAddress: streetAddress, City: city, State: state, ZIPCode, ZIPPlus4: ZIPPlus4 || '' });
  if (fileWriteTimer) clearTimeout(fileWriteTimer);
  fileWriteTimer = setTimeout(flushAddressWrites, 2000);
}

async function flushAddressWrites() {
  if (pendingFileWrites.length === 0) return;
  const toWrite = pendingFileWrites.splice(0);
  const filePath = path.join(__dirname, 'addresses.txt');
  try {
    const writer = createCsvWriter({
      path: filePath,
      header: [
        { id: 'StreetAddress', title: 'StreetAddress' },
        { id: 'City',          title: 'City' },
        { id: 'State',         title: 'State' },
        { id: 'ZIPCode',       title: 'ZIPCode' },
        { id: 'ZIPPlus4',      title: 'ZIPPlus4' },
      ],
      append: true,
    });
    await writer.writeRecords(toWrite);
    console.log(`Flushed ${toWrite.length} new addresses to file cache`);
  } catch (err) {
    console.error('Error flushing addresses to file:', err);
  }
}

// ─── USPS API ─────────────────────────────────────────────────────────────────
async function validateUspsZipCode(streetAddress, city, state) {
  // Only pass required fields — never pass optional fields as null/undefined
  const params = { streetAddress, city, state };

  const makeRequest = () => axiosInstance.get(ZIPCODE_API_URL, { params, headers: HEADERS });

  try {
    if (!isTokenValid()) await refreshUspsToken();
    const response = await makeRequest();
    if (response.status === 200 && response.data?.address?.ZIPCode) return response.data;
    return null;
  } catch (error) {
    const status = error.response?.status;
    if (status === 401) {
      await refreshUspsToken();
      try {
        const response = await makeRequest();
        if (response.status === 200 && response.data?.address?.ZIPCode) return response.data;
      } catch { return null; }
    } else if (status === 429) {
      console.warn('USPS rate limit (429) — backing off 1s...');
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const response = await makeRequest();
        if (response.status === 200 && response.data?.address?.ZIPCode) return response.data;
      } catch { return null; }
    } else {
      console.error(`USPS error [${status}] for "${streetAddress}, ${city}, ${state}":`, error.response?.data || error.message);
    }
    return null;
  }
}

// ─── Google Maps Fallback ─────────────────────────────────────────────────────
async function getZipFromGoogle(streetAddress, city, state) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.warn('No GOOGLE_MAPS_API_KEY set — skipping Google fallback');
    return null;
  }
  try {
    const fullAddress = `${streetAddress}, ${city}, ${state}, USA`;
    const response = await axiosInstance.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: fullAddress, key: GOOGLE_MAPS_API_KEY },
    });
    if (response.data.status !== 'OK') return null;
    const components = response.data.results[0]?.address_components || [];
    const zipComponent = components.find((c) => c.types.includes('postal_code'));
    const zipSuffix    = components.find((c) => c.types.includes('postal_code_suffix'));
    if (!zipComponent) return null;
    return zipSuffix ? `${zipComponent.long_name}${zipSuffix.long_name}` : zipComponent.long_name;
  } catch (error) {
    console.error('Google Maps fallback error:', error.message);
    return null;
  }
}

// ─── Core: Process a Single Address ──────────────────────────────────────────
async function processAddress(streetAddress, city, state) {
  const cacheKey = getCacheKey(streetAddress, city, state);

  // 1. Runtime cache
  if (addressCache.has(cacheKey)) return addressCache.get(cacheKey);

  // 2. File cache
  const fileHit = checkAddressInMemory(streetAddress, city, state);
  if (fileHit) {
    const zip = fileHit.ZIPCode + fileHit.ZIPPlus4;
    addressCache.set(cacheKey, zip);
    return zip;
  }

  // 3. USPS
  const uspsResult = await validateUspsZipCode(streetAddress, city, state);
  if (uspsResult?.address?.ZIPCode) {
    const zip = (uspsResult.address.ZIPCode || '') + (uspsResult.address.ZIPPlus4 || '');
    addressCache.set(cacheKey, zip);
    queueAddressWrite({
      streetAddress: uspsResult.address.streetAddress || streetAddress,
      city:          uspsResult.address.city          || city,
      state:         uspsResult.address.state         || state,
      ZIPCode:       uspsResult.address.ZIPCode,
      ZIPPlus4:      uspsResult.address.ZIPPlus4 || '',
    });
    return zip;
  }

  // 4. Google fallback
  const googleZip = await getZipFromGoogle(streetAddress, city, state);
  if (googleZip) {
    addressCache.set(cacheKey, googleZip);
    queueAddressWrite({
      streetAddress, city, state,
      ZIPCode:  googleZip.substring(0, 5),
      ZIPPlus4: googleZip.length > 5 ? googleZip.substring(5) : '',
    });
    return googleZip;
  }

  return '';
}

// ─── Initialize ───────────────────────────────────────────────────────────────
async function initAddressHelper() {
  console.log('Loading address file cache into memory...');
  await loadAddressFile();
  console.log(`Address file loaded — ${fileAddressMap?.size || 0} cached entries.`);
  if (!isTokenValid()) {
    console.log('Fetching initial USPS token...');
    await refreshUspsToken();
  }
}

module.exports = { processAddress, initAddressHelper, flushAddressWrites, validateAndCleanAddress };