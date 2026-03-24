// ipedsSearch.js
const ipedsPool = require('../config/ipedsConnectionPool');

async function getAllInstitutionNames(limit = null, offset = 0) {
    let connection = null;
    
    try {
        connection = await ipedsPool.getConnection();
        
        // ←←← REMOVE ORDER BY ←←←
        const query = `SELECT UNITID, INSTNM FROM HD2024`;
        
        console.log('Executing query:', query);
        const results = await connection.query(query);
        
        let institutions = results.map(result => ({
            unitid: result.UNITID,
            instnm: result.INSTNM || '',   // safe in case of null
        }));

        // Sort in Node.js (very fast for ~7000 rows)
        institutions.sort((a, b) => a.instnm.localeCompare(b.instnm));

        // Apply pagination in memory
        if (limit !== null && limit > 0) {
            institutions = institutions.slice(offset, offset + limit);
        }

        console.log(`Returned ${institutions.length} institutions`);
        return institutions;
        
    } catch (error) {
        console.error('Error fetching institution names:', error.message);
        if (error.message.includes('syntax error')) {
            console.error('This is likely due to MDBTools limitations (ORDER BY not supported via ODBC)');
        }
        throw error;
    } finally {
        if (connection) {
            ipedsPool.releaseConnection(connection);
        }
    }
}

module.exports = { getAllInstitutionNames };