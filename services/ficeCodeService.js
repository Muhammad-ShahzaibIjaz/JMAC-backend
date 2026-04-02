const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

function extractUniversities() {
    const filePath = path.join(__dirname, '..', 'utils', 'fice_combined.csv');
    return new Promise((resolve, reject) => {
        const results = [];
        
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                results.push({
                    code: row.FICE_CODE?.trim() || '',
                    name: row.UNIVERSITY_NAME?.trim() || ''
                });
            })
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
}

module.exports = { extractUniversities };