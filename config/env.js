const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

module.exports = {
  PORT: process.env.PORT || 3001,
  DB_HOST: process.env.DB_HOST || "localhost",
  DB_USER: process.env.DB_USER || "postgres",
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME || "JMac",
  DB_PORT: process.env.DB_PORT || 5432,
  WORKER_URL: process.env.WORKER_URL,
  USER_ID: "default-user",
  FOLDER_NAME: "uploads",
  GEO_API_KEY: process.env.GEO_API_KEY || "",
  SECRET_KEY: process.env.SECRET_KEY
};