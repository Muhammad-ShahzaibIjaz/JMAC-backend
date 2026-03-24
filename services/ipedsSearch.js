// ipedsSearch.js
const ipedsPool = require('../config/ipedsConnectionPool');

async function getAllInstitutionNames(limit = null, offset = 0) {
    let connection = null;
    
    try {
        connection = await ipedsPool.getConnection();
        
        let query = `SELECT UNITID, INSTNM FROM HD2024 ORDER BY INSTNM`;
        
        if (limit) {
            query = `SELECT TOP ${limit} UNITID, INSTNM FROM HD2024 ORDER BY INSTNM`;
            
            if (offset > 0) {
                // Note: Access doesn't support LIMIT with offset like this
                // You might need to adjust this query for Access syntax
                query = `
                    SELECT UNITID, INSTNM FROM HD2024 
                    WHERE UNITID NOT IN (
                        SELECT TOP ${offset} UNITID FROM HD2024 ORDER BY INSTNM
                    ) 
                    ORDER BY INSTNM
                `;
            }
        }
        
        const results = await connection.query(query);
        
        return results.map(result => ({
            unitid: result.UNITID,
            instnm: result.INSTNM,
        }));
        
    } catch (error) {
        console.error('Error fetching institution names:', error.message);
        throw error;
    } finally {
        if (connection) {
            ipedsPool.releaseConnection(connection);
        }
    }
}

module.exports = { getAllInstitutionNames };