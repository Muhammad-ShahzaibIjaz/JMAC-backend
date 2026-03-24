// ipedsConnectionPool.js
const odbc = require('odbc');
const { DB_PATH } = require("./env");

class IPEDSPool {
    constructor() {
        this.pool = [];
        this.maxPoolSize = 5;
        this.currentConnections = 0;
    }

    async getConnection() {
        // Return existing connection from pool if available
        if (this.pool.length > 0) {
            return this.pool.pop();
        }

        // Create new connection if under max limit
        if (this.currentConnections < this.maxPoolSize) {
            this.currentConnections++;
            const connectionString = `DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=${DB_PATH};`;
            const connection = await odbc.connect(connectionString);
            return connection;
        }

        // Wait for a connection to become available
        return new Promise((resolve) => {
            const checkInterval = setInterval(async () => {
                if (this.pool.length > 0) {
                    clearInterval(checkInterval);
                    resolve(this.pool.pop());
                }
            }, 100);
        });
    }

    releaseConnection(connection) {
        if (this.pool.length < this.maxPoolSize) {
            this.pool.push(connection);
        } else {
            // Close connection if pool is full
            connection.close().catch(console.error);
            this.currentConnections--;
        }
    }

    async closeAll() {
        const closePromises = this.pool.map(conn => conn.close());
        await Promise.all(closePromises);
        this.pool = [];
        this.currentConnections = 0;
    }
}

module.exports = new IPEDSPool();