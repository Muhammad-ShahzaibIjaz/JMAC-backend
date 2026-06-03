const { Op } = require('sequelize');
const OperationProgressLog = require('../models/OperationProgressLog');



async function getSessionLog(req, res) {
  const { sessionId } = req.params;

  try {
    const [session, steps] = await Promise.all([
      // The SESSION row
      OperationProgressLog.findOne({
        where: { id: sessionId, kind: 'SESSION' },
        attributes: ['id', 'status', 'message', 'createdAt', 'triggeredBy', 'templateId', 'sheetId'],
      }),
      // All STEP rows for this session
      OperationProgressLog.findAll({
        where: { sessionId, kind: 'STEP' },
        attributes: ['stepNumber', 'message', 'status', 'meta', 'createdAt'],
        order: [['stepNumber', 'ASC']],
        raw: true,
      }),
    ]);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json({ session, steps });
  } catch (err) {
    console.error('Error fetching session log:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


async function getHistory(req, res) {
  const { templateId, sheetId, limit = 30 } = req.query;

  if (!templateId || !sheetId) {
    return res.status(400).json({ error: 'templateId and sheetId are required' });
  }

  try {
    const sessions = await OperationProgressLog.findAll({
      where: { templateId, sheetId, kind: 'SESSION' },
      attributes: ['id', 'status', 'message', 'createdAt', 'triggeredBy', 'operationType'],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      raw: true,
    });

    return res.json({ sessions });
  } catch (err) {
    console.error('Error fetching history:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getSessionLog,
  getHistory,
};