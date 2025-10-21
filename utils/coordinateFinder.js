const fs = require('fs').promises;
const path = require('path');
const { default: axios } = require('axios');

const CACHE_FILE = path.join(__dirname, 'geocodeCache.json');
const API_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

let cache = {};
let cacheWritePending = false;

// Load cache safely
async function loadCache() {
    try {
        const data = await fs.readFile(CACHE_FILE, 'utf8');
        cache = JSON.parse(data);
    } catch (err) {
        console.log('No cache file found or invalid, starting fresh');
        cache = {};
    }
}

// Save cache with debouncing and async writing
async function saveCache() {
    if (cacheWritePending) return;
    
    cacheWritePending = true;
    try {
        await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (err) {
        console.error('Failed to write cache file:', err.message);
    } finally {
        cacheWritePending = false;
    }
}

function normalizeKey(address, city, state) {
    return `${address}, ${city}, ${state}`.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Enhanced geocoding with rate limiting and error handling
async function geocodeStudent(student, attempt = 1) {
    const key = normalizeKey(student.address, student.city, student.state);
    
    // Check cache first
    if (cache[key]) {
        // Only return if cache has valid coordinates
        if (cache[key].latitude !== null && cache[key].longitude !== null) {
            return { ...student, ...cache[key] };
        }
        return null; // Skip if cached result was invalid
    }

    try {
        // Add delay to avoid rate limiting (100ms between requests)
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const response = await axios.get(API_URL, {
            params: {
                address: key,
                benchmark: 'Public_AR_Current',
                format: 'json'
            },
            timeout: 10000, // Increased timeout
        });

        const matches = response.data.result.addressMatches;
        
        if (Array.isArray(matches) && matches.length > 0) {
            const { coordinates } = matches[0];
            const enriched = { 
                latitude: coordinates.y, 
                longitude: coordinates.x 
            };
            
            // Update cache with valid result
            cache[key] = enriched;
            
            // Schedule cache save (non-blocking)
            setTimeout(saveCache, 0);
            
            return { ...student, ...enriched };
        } else {
            console.warn(`No results for: ${key}`);
            // Cache negative results to avoid retrying
            cache[key] = { latitude: null, longitude: null };
            setTimeout(saveCache, 0);
            return null; // Skip this student
        }
        
    } catch (err) {
        console.error(`Geocode failed for ${key} (attempt ${attempt}):`, err.message);
        
        // Retry logic with exponential backoff
        if (attempt < 3) {
            const backoffTime = attempt * 2000; // 2s, 4s
            await new Promise(resolve => setTimeout(resolve, backoffTime));
            return geocodeStudent(student, attempt + 1);
        }
        
        // Cache failure to avoid retrying
        cache[key] = { latitude: null, longitude: null };
        setTimeout(saveCache, 0);
        return null; // Skip this student
    }
}

// Process students in batches to avoid memory issues
async function geocodeStudents(studentArray, batchSize = 50) {
    await loadCache(); // Ensure cache is loaded
    
    const results = [];
    
    for (let i = 0; i < studentArray.length; i += batchSize) {
        const batch = studentArray.slice(i, i + batchSize);
        const batchPromises = batch.map(student => 
            geocodeStudent(student).catch(err => {
                console.error(`Error processing student:`, err.message);
                return null; // Skip failed students
            })
        );
        
        const batchResults = await Promise.all(batchPromises);
        
        // Only add students with valid coordinates (not null)
        const validResults = batchResults.filter(student => 
            student !== null && 
            student.latitude !== null && 
            student.longitude !== null
        );
        
        results.push(...validResults);
        
        // Force garbage collection hint (if running with --expose-gc)
        if (global.gc) {
            global.gc();
        }
    }
    return results; // Only returns students with valid coordinates
}

// Initialize cache on startup
loadCache().catch(console.error);

module.exports = { geocodeStudents };