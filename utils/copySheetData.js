const copyFrom = require('pg-copy-streams').from;
const { format } = require('@fast-csv/format');
const pool = require('../config/nativePg');

async function copySheetData(sheetDataPayload) {
  const client = await pool.connect();
  try {
    const stream = client.query(copyFrom(`
      COPY "SheetData" ("id", "rowIndex", "value", "headerId", "sheetId", "createdAt", "updatedAt")
      FROM STDIN WITH (FORMAT csv)
    `));

    const csvStream = format({ headers: false, quoteColumns: true });
    csvStream.pipe(stream);
    
    const now = new Date().toISOString();
    for (const row of sheetDataPayload) {
      csvStream.write([
        row.id ?? '',
        row.rowIndex ?? '',
        row.value ?? '',
        row.headerId ?? '',
        row.sheetId ?? '',
        now,
        now,
      ]);
    }

    csvStream.end();

    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    console.log('✅ COPY completed');
  } catch (err) {
    console.error('❌ COPY failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = copySheetData;