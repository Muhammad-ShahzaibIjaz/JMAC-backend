const { Log } = require("../models");

async function getLogs(req, res) {
  const { limit = 50, pageNo = 1 } = req.query;

  try {
    const offset = (pageNo - 1) * limit;

    const { rows, count } = await Log.findAndCountAll({
      limit: Number(limit),
      offset: Number(offset),
      order: [["createdAt", "DESC"]],
    });

    const logs = rows.map((log) => ({
      id: log.id,
      action: log.action,
      username: log.username,
      performedBy: log.performedBy,
      details: log.details,
      timestamp: log.createdAt,
    }));

    res.json({
      data: logs,
      pagination: {
        totalRecords: count,
        totalPages: Math.ceil(count / limit),
        currentPage: Number(pageNo),
        pageSize: Number(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { getLogs };