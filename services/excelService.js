const XLSX = require('xlsx');
const { v4: uuidv4 } = require("uuid");
const { uploadFileToR2 } = require('./r2Service');
const { WORKER_URL } = require("../config/env");

function isRowEmpty(row) {
  if (!row || !Array.isArray(row)) return true;
  return row.every((cell) => cell === null || cell === undefined || cell === "");
}

function processDataRows(jsonData, maxConsecutiveEmptyRows = 10) {
  if (!jsonData || jsonData.length < 1) {
    return { data: [], rowsSkipped: 0 };
  }
  
  const headers = jsonData[0] || [];
  const dataRows = jsonData.slice(1) || [];
  const cleanedRows = [];
  let consecutiveEmptyRows = 0;
  let rowsSkipped = 0;

  for (const row of dataRows) {
    if (isRowEmpty(row)) {
      consecutiveEmptyRows++;
      rowsSkipped++;
      if (consecutiveEmptyRows >= maxConsecutiveEmptyRows) break;
      continue;
    }
    consecutiveEmptyRows = 0;
    cleanedRows.push(row);
  }
  
  const processedData = headers.length > 0 ? [headers, ...cleanedRows] : cleanedRows;
  return { data: processedData, rowsSkipped };
}

async function headerProcessor(files) {
  if (!files || files.length === 0) {
    throw new Error("No files provided for processing");
  }

  const processedFiles = [];

  for (const file of files) {
    if (!file.buffer) {
      throw new Error(`File buffer is undefined for ${file.originalname}`);
    }

    let filePath;
    try {
      const { filePath: uploadedPath } = await uploadFileToR2(file);
      filePath = uploadedPath;

      let workbook;
      if (file.originalname.endsWith('.csv')) {
        const csvData = file.buffer.toString('utf8');
        workbook = XLSX.read(csvData, { type: 'string', raw: true });
      } else {
        workbook = XLSX.read(file.buffer, { type: 'buffer' });
      }

      const sheets = workbook.SheetNames.map((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        const { data: processedData, rowsSkipped } = processDataRows(jsonData);
        const headers = processedData[0] || [];
        
        return {
          sheetName,
          headers,
          data: headers.length > 0 ? processedData.slice(1) : [],
          rowsSkipped: rowsSkipped || 0 // Ensure rowsSkipped is always defined
        };
      }).filter(sheet => sheet.headers.length > 0);

      if (sheets.length === 0) {
        throw new Error(`No valid sheets with headers found in ${file.originalname}`);
      }

      processedFiles.push({
        id: uuidv4(),
        filePath: WORKER_URL + filePath,
        uploadedFilePath: filePath,
        fileName: file.originalname,
        sheets,
        rowsSkipped: sheets.reduce((sum, sheet) => sum + (sheet.rowsSkipped || 0), 0)
      });
    } catch (error) {
      throw new Error(`Failed to process file ${file.originalname}: ${error.message}`);
    }
  }

  return processedFiles;
}

module.exports = { headerProcessor }