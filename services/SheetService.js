const ExcelJS = require('exceljs');

const fs = require('fs');
const path = require('path');

async function generateExcelFile({ headers, maxRowIndex, totalErrorRows, errorRows, rowBuckets, templateName }) {
  const currentDate = new Date().toISOString().split('T')[0];
  const filePath = path.join(__dirname, '..', 'exports', `${templateName}_${currentDate}.xlsx`);

  // Ensure export directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath });
  const sheet1 = workbook.addWorksheet('Data');

  // Add headers
  const headerRow = sheet1.addRow(headers.map(h => h.name));
  headers.forEach((header, colIndex) => {
    if (header.data.some(d => d.valid === false)) {
      const cell = headerRow.getCell(colIndex + 1);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFF0000' },
      };
      cell.font = {
        color: { argb: 'FFFFFFFF' },
      };
    }
  });
  headerRow.commit();

  // Add data rows
  for (let rowIndex = 1; rowIndex <= maxRowIndex; rowIndex++) {
    const rowData = headers.map(header => {
      const cellData = rowBuckets.get(rowIndex)?.get(header.id);
      let value = cellData ? cellData.value || '' : '';
      value = typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '') : value;
      if (header.columnType === 'Date' && value) {
        const parsedDate = new Date(value);
        return isNaN(parsedDate.getTime()) ? '' : parsedDate;
      }
      return value;
    });

    const row = sheet1.addRow(rowData);
    headers.forEach((header, colIndex) => {
      const cellData = rowBuckets.get(rowIndex)?.get(header.id);
      if (cellData && cellData.valid === false) {
        const cell = row.getCell(colIndex + 1);
        if (header.columnType === 'Date') {
          const parsedDate = new Date(cellData.value);
          if (!isNaN(parsedDate.getTime())) {
            cell.value = parsedDate;
            cell.numFmt = 'mm-dd-yyyy';
          } else {
            cell.value = '';
          }
        }
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFF0000' },
        };
        cell.font = {
          color: { argb: 'FFFFFFFF' },
        };
      }
    });
    row.commit();
  }

  // Add Sheet 2: Errors
  const sheet2 = workbook.addWorksheet('Errors');
  sheet2.addRow(['Summary']).commit();
  sheet2.addRow(['Total Rows', maxRowIndex]).commit();
  sheet2.addRow(['Rows with Errors', totalErrorRows]).commit();
  sheet2.addRow([]).commit();
  sheet2.addRow(['Error Details']).commit();
  sheet2.addRow(['Row Number', 'Issues']).commit();

  const sortedErrorRows = Array.from(errorRows.entries()).sort((a, b) => a[0] - b[0]);
  sortedErrorRows.forEach(([rowIndex, headerNames]) => {
    const issueText = headerNames.length > 1
      ? `Issues in ${headerNames.join(', ')}`
      : `Issue in ${headerNames[0]}`;
    sheet2.addRow([rowIndex, issueText]).commit();
  });

  await workbook.commit();
  return filePath;
}

async function generateHeaderMappingExcel(mappingTable) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Header Mapping');

  // Add rows to sheet
  sheet.addRows(mappingTable);

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFB0C4DE' }, // light steel blue
    };
  });

  // Set column widths
  sheet.columns = [
    { width: 30 },
    { width: 30 },
  ];

  // Return buffer
  return await workbook.xlsx.writeBuffer();
}


async function generateMultiYearExcelFile(data) {
  const workbook = new ExcelJS.Workbook();

  // Sort years descending so latest year comes first
  const sortedYears = Object.keys(data).sort((a, b) => b - a);

  for (const year of sortedYears) {
    const { headers, rows } = data[year];
    const sheet = workbook.addWorksheet(`${year}`);

    // Add header row
    sheet.addRow(headers);

    // Add data rows
    for (const row of rows) {
      const rowData = headers.map(h => {
        let value = row[h] ?? '';
        value = typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '') : value;
        const parsedDate = new Date(value);
        if (h.toLowerCase().includes('date') && !isNaN(parsedDate.getTime())) {
          return parsedDate;
        }
        return value;
      });
      sheet.addRow(rowData);
    }

    // Format date columns
    headers.forEach((h, i) => {
      if (h.toLowerCase().includes('date')) {
        sheet.getColumn(i + 1).numFmt = 'mm-dd-yyyy';
      }
    });

    // Set column widths
    sheet.columns = headers.map(h => ({
      width: Math.max(h.length, 15),
    }));
  }

  // Return buffer
  return await workbook.xlsx.writeBuffer();
}

module.exports = { generateExcelFile, generateHeaderMappingExcel, generateMultiYearExcelFile };