// ipedsConnectionPool.js
const odbc = require('odbc');
const { DB_PATH, DB_CONNECTION_VALUE } = require("./env");

console.log('DB_PATH:', DB_PATH);
console.log('DB_CONNECTION_VALUE:', DB_CONNECTION_VALUE);

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
            const connectionString = `${DB_CONNECTION_VALUE};DBQ=${DB_PATH}`;

            // Debug: log the full connection string
            console.log('Connection string:', connectionString);

            
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