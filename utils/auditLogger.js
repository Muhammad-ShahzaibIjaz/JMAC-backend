const { Log, OperationProgressLog } = require("../models");

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

async function logStep({ sessionId, templateId, sheetId, stepNumber, message,
                         status = 'INFO', meta = null, triggeredBy, emit, operationType }) {
  const row = await OperationProgressLog.create({
    sessionId, templateId, sheetId,
    kind: 'STEP',
    operationType,   // ← use the passed value
    stepNumber, message, status, meta, triggeredBy,
  });

  if (emit) emit({ stepNumber, message, status, meta, timestamp: row.createdAt });
  return row;
}

module.exports = { createLog, logStep };