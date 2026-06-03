const { Op, QueryTypes } = require('sequelize');
const sequelize = require('../config/database');
const { OperationProgressLog } = require('../models');

const KEEP_LAST_N = 30;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // runs every 1 hour

let cleanupTimer = null;
let isRunning = false; // guard: prevents overlap if a run takes longer than the interval

async function runCleanup() {
  // If a previous run is still going, skip this tick entirely
  if (isRunning) {
    console.log('[ProgressLogCleanup] Skipping — previous run still in progress.');
    return;
  }

  isRunning = true;
  console.log('[ProgressLogCleanup] Starting cleanup...');

  try {
    // Step 1: Find all unique (templateId, sheetId) pairs that have SESSION rows
    const pairs = await sequelize.query(
      `
      SELECT DISTINCT "templateId", "sheetId"
      FROM "OperationProgressLog"
      WHERE kind = 'SESSION'
      `,
      { type: QueryTypes.SELECT }
    );

    if (pairs.length === 0) {
      console.log('[ProgressLogCleanup] No session logs found. Nothing to clean.');
      return;
    }

    let totalDeletedSessions = 0;
    let totalDeletedSteps = 0;

    for (const { templateId, sheetId } of pairs) {
      // Step 2: Count SESSION rows for this pair
      const sessionCount = await OperationProgressLog.count({
        where: { templateId, sheetId, kind: 'SESSION' },
      });

      if (sessionCount <= KEEP_LAST_N) continue;

      // Step 3: Get the IDs of sessions to DELETE (everything except the latest 50)
      const sessionsToDelete = await sequelize.query(
        `
        SELECT id FROM "OperationProgressLog"
        WHERE "templateId" = :templateId
          AND "sheetId"    = :sheetId
          AND kind         = 'SESSION'
        ORDER BY "createdAt" DESC
        OFFSET :keepCount
        `,
        {
          replacements: { templateId, sheetId, keepCount: KEEP_LAST_N },
          type: QueryTypes.SELECT,
        }
      );

      if (sessionsToDelete.length === 0) continue;

      const sessionIds = sessionsToDelete.map(r => r.id);

      // Step 4: Delete STEP rows that belong to these sessions first (FK safety)
      const deletedSteps = await OperationProgressLog.destroy({
        where: {
          sessionId: { [Op.in]: sessionIds },
          kind: 'STEP',
        },
      });

      // Step 5: Delete the SESSION rows themselves
      const deletedSessions = await OperationProgressLog.destroy({
        where: {
          id: { [Op.in]: sessionIds },
          kind: 'SESSION',
        },
      });

      totalDeletedSessions += deletedSessions;
      totalDeletedSteps += deletedSteps;

      console.log(
        `[ProgressLogCleanup] templateId=${templateId} sheetId=${sheetId} — deleted ${deletedSessions} session(s) and ${deletedSteps} step(s).`
      );
    }

    console.log(
      `[ProgressLogCleanup] Done. Total deleted — sessions: ${totalDeletedSessions}, steps: ${totalDeletedSteps}.`
    );
  } catch (error) {
    // Log the error but never crash the process — this is a background job
    console.error('[ProgressLogCleanup] Error during cleanup:', error.message);
  } finally {
    isRunning = false;
  }
}

function startCleanupService() {
  if (cleanupTimer) {
    console.warn('[ProgressLogCleanup] Service is already running.');
    return;
  }

  console.log(
    `[ProgressLogCleanup] Service started. Runs every ${CLEANUP_INTERVAL_MS / 60000} minute(s), keeps last ${KEEP_LAST_N} sessions per template+sheet.`
  );

  // Run once immediately on startup, then on the interval
  runCleanup();
  cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);

  // Prevent the timer from keeping the Node process alive if everything else stops
  if (cleanupTimer.unref) cleanupTimer.unref();
}

function stopCleanupService() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log('[ProgressLogCleanup] Service stopped.');
  }
}

async function resolveOrphanedSessions() {
  try {
    const [count] = await OperationProgressLog.update(
      {
        status: 'FAILED',
        message: 'Server restarted while operation was in progress.',
      },
      {
        where: { kind: 'SESSION', status: 'RUNNING' },
      }
    );
    if (count > 0) {
      console.log(`[Startup] Marked ${count} orphaned RUNNING session(s) as FAILED.`);
    }
  } catch (error) {
    console.error('[Startup] Failed to resolve orphaned sessions:', error.message);
  }
}

module.exports = { startCleanupService, stopCleanupService, resolveOrphanedSessions };