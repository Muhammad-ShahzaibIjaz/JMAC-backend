const { default: axios } = require('axios');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
require('dotenv').config({ path: path.join(__dirname, '../.env') });


const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const AUTH_URL = "https://apis.usps.com/oauth2/v3/token";
const ADDRESS_API_URL = "https://apis.usps.com/addresses/v3/address";

// Token management
let TOKEN_INFO = {
    access_token: process.env.ACCESS_TOKEN || "",
    expires_at: 0
};

let HEADERS = {
    "Authorization": `Bearer ${TOKEN_INFO.access_token}`,
    "Content-Type": "application/json"
};

function isTokenValid() {
    if (!TOKEN_INFO.access_token) return false;
    return Date.now() < TOKEN_INFO.expires_at;
}

async function refreshUspsToken() {
    try {
        const authData = new URLSearchParams();
        authData.append('grant_type', 'client_credentials');
        authData.append('client_id', CLIENT_ID);
        authData.append('client_secret', CLIENT_SECRET);

        console.log('Sending token refresh request');
        const response = await axios.post(AUTH_URL, authData.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const tokenData = response.data;
        console.log('Token refresh response received');
        
        TOKEN_INFO.access_token = tokenData.access_token;
        TOKEN_INFO.expires_at = Date.now() + (tokenData.expires_in * 1000) - 60000; // minus 60 seconds
        
        // Update headers
        HEADERS.Authorization = `Bearer ${TOKEN_INFO.access_token}`;
        
        // Update .env file
        process.env.ACCESS_TOKEN = TOKEN_INFO.access_token;

        console.log('Bearer token refreshed successfully');
        return TOKEN_INFO.access_token;
    } catch (error) {
        console.error('Error refreshing USPS token:', error.response?.data || error.message);
        throw error;
    }
}

function normalizeAddress(streetAddress) {
    let normalized = streetAddress.toUpperCase().trim();
    normalized = normalized.replace(/\s+/g, ' ');
    
    const abbreviations = {
        'ROAD': 'RD',
        'STREET': 'ST',
        'AVENUE': 'AVE',
        'LANE': 'LN',
        'BOULEVARD': 'BLVD',
        'NORTHEAST': 'NE',
        'SOUTHEAST': 'SE',
        'NORTHWEST': 'NW',
        'SOUTHWEST': 'SW'
    };
    
    for (const [full, abbr] of Object.entries(abbreviations)) {
        normalized = normalized.replace(new RegExp(full, 'g'), abbr);
    }
    
    return normalized;
}

function checkAddressInFile(streetAddress, city, state) {
    return new Promise((resolve) => {
        const normalizedAddress = normalizeAddress(streetAddress);
        const results = [];
        const filePath = path.join(__dirname, 'addresses.txt');
        
        if (!fs.existsSync(filePath)) {
            console.log('addresses.txt not found');
            resolve(null);
            return;
        }

        fs.createReadStream(filePath)
            .pipe(csv({
                headers: ['StreetAddress', 'City', 'State', 'ZIPCode', 'ZIPPlus4'],
                skipLines: 0
            }))
            .on('data', (data) => {
                if (normalizeAddress(data.StreetAddress) === normalizedAddress &&
                    data.City.toUpperCase() === city.toUpperCase() &&
                    data.State.toUpperCase() === state.toUpperCase()) {
                    
                    // Check if all required fields are present
                    if (data.StreetAddress && data.City && data.State && data.ZIPCode) {
                        results.push({
                            address: {
                                streetAddress: data.StreetAddress,
                                city: data.City,
                                state: data.State,
                                ZIPCode: data.ZIPCode,
                                ZIPPlus4: data.ZIPPlus4 || ''
                            }
                        });
                    }
                }
            })
            .on('end', () => {
                resolve(results.length > 0 ? results[0] : null);
            })
            .on('error', (error) => {
                console.error('Error reading addresses.txt:', error);
                resolve(null);
            });
    });
}

async function validateUspsAddress(streetAddress, city, state) {
    const normalizedAddress = normalizeAddress(streetAddress);
    const params = {
        streetAddress: normalizedAddress,
        city: city.toUpperCase(),
        state: state.toUpperCase()
    };

    try {
        if (!isTokenValid()) {
            console.log('Token expired or invalid, refreshing...');
            await refreshUspsToken();
        }

        let response = await axios.get(ADDRESS_API_URL, { params, headers: HEADERS });
        console.log(`API URL: ${response.request.res.responseUrl}`);

        if (response.status === 200) {
            return response.data;
        }
    } catch (error) {
        if (error.response?.status === 401) {
            console.log('Received 401, refreshing token and retrying...');
            await refreshUspsToken();
            
            // Retry the request with new token
            try {
                response = await axios.get(ADDRESS_API_URL, { params, headers: HEADERS });
                if (response.status === 200) {
                    return response.data;
                }
            } catch (retryError) {
                console.error('Error retrying address validation:', retryError.response?.data || retryError.message);
                return null;
            }
        } else {
            console.error('Error validating address:', error.response?.data || error.message);
            return null;
        }
    }
}

async function saveAddressToFile(addressData) {
    try {
        const streetAddress = addressData.address.streetAddress;
        const city = addressData.address.city;
        const state = addressData.address.state;
        const normalizedAddress = normalizeAddress(streetAddress);

        // Check if address already exists
        const existingData = await checkAddressInFile(streetAddress, city, state);
        
        // Prepare new row data
        const newRow = {
            StreetAddress: addressData.address.streetAddress || '',
            City: addressData.address.city || '',
            State: addressData.address.state || '',
            ZIPCode: addressData.address.ZIPCode || '',
            ZIPPlus4: addressData.address.ZIPPlus4 || ''
        };

        const filePath = path.join(__dirname, 'addresses.txt');
        const csvWriter = createCsvWriter({
            path: filePath,
            header: [
                {id: 'StreetAddress', title: 'StreetAddress'},
                {id: 'City', title: 'City'},
                {id: 'State', title: 'State'},
                {id: 'ZIPCode', title: 'ZIPCode'},
                {id: 'ZIPPlus4', title: 'ZIPPlus4'}
            ],
            append: true
        });

        if (existingData) {
            // Address exists, check if data is different
            const existingRow = {
                StreetAddress: existingData.address.streetAddress || '',
                City: existingData.address.city || '',
                State: existingData.address.state || '',
                ZIPCode: existingData.address.ZIPCode || '',
                ZIPPlus4: existingData.address.ZIPPlus4 || ''
            };

            if (JSON.stringify(newRow) === JSON.stringify(existingRow)) {
                console.log(`Address already exists with identical data: ${streetAddress}, ${city}, ${state}`);
                return;
            }

            // Read all records, update the specific one, and write back
            const allRecords = [];
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                const lines = data.split('\n');
                const headers = lines[0].split(',');
                
                for (let i = 1; i < lines.length; i++) {
                    if (!lines[i].trim()) continue;
                    
                    const values = lines[i].split(',');
                    const record = {};
                    
                    for (let j = 0; j < headers.length; j++) {
                        record[headers[j].trim()] = values[j] ? values[j].trim() : '';
                    }
                    
                    // Check if this is the record to update
                    if (normalizeAddress(record.StreetAddress) === normalizedAddress &&
                        record.City.toUpperCase() === city.toUpperCase() &&
                        record.State.toUpperCase() === state.toUpperCase()) {
                        allRecords.push(newRow);
                    } else {
                        allRecords.push(record);
                    }
                }
            }

            // Write all records back to file
            const updatedCsvWriter = createCsvWriter({
                path: filePath,
                header: [
                    {id: 'StreetAddress', title: 'StreetAddress'},
                    {id: 'City', title: 'City'},
                    {id: 'State', title: 'State'},
                    {id: 'ZIPCode', title: 'ZIPCode'},
                    {id: 'ZIPPlus4', title: 'ZIPPlus4'}
                ]
            });
            
            await updatedCsvWriter.writeRecords(allRecords);
            console.log(`Updated address in addresses.txt: ${streetAddress}, ${city}, ${state}`);
        } else {
            // Address doesn't exist, append it
            if (!fs.existsSync(filePath)) {
                await csvWriter.writeRecords([newRow]); // This will create file with header
            } else {
                // Append to existing file
                await csvWriter.writeRecords([newRow]);
            }
            console.log(`Appended new address to addresses.txt: ${streetAddress}, ${city}, ${state}`);
        }
    } catch (error) {
        console.error('Error saving address to addresses.txt:', error);
        throw error;
    }
}

async function processAddress(address, city, state) {
  try {

    if (!address || !city || !state) {
      throw new Error('Address, City, and State are required fields.');
    }

    const checkedAddress = await checkAddressInFile(address, city, state);
    if (checkedAddress) {
      return checkedAddress.address.ZIPCode + checkedAddress.address.ZIPPlus4;
    }

    const validatedAddress = await validateUspsAddress(address, city, state);
    if (validatedAddress) {
      saveAddressToFile(validatedAddress);
      return (validatedAddress.address.ZIPCode || '') + (validatedAddress.address.ZIPPlus4 || '');
    }
    return "";
  } catch (error) {
    console.error('Error processing address:', error.message);
    throw error;
  }
}

module.exports = { processAddress };