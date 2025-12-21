const { Log } = require("../models");

async function createLog({ action, username, performedBy, details = null }) {
  try {
    const logEntry = await Log.create({
      action,
      username,
      performedBy,
      details,
    });
    return logEntry;
  } catch (error) {
    console.error("Error creating log:", error);
    throw error;
  }
}

module.exports = { createLog };