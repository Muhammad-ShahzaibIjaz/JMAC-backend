const { Sequelize } = require("sequelize");
const { DB_NAME, DB_USER, DB_PASSWORD, DB_HOST } = require("./env");

const sequelize = new Sequelize(
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  {
    host: DB_HOST,
    dialect: "postgres",
    logging: false,
    pool: {
      max: 20,
      min: 5,
      acquire: 30000,
      idle: 30000,
    },
    dialectOptions: {
      statement_timeout: 120000,
      idle_in_transaction_session_timeout: 60000,
    }
  },
);

module.exports = sequelize;
