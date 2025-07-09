const ExcelJS = require('exceljs');

async function generateExcelFile({ headers, totalRows, totalErrorRows, errorRows }) {
  const workbook = new ExcelJS.Workbook();
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

  // Find max rowIndex
  const maxRowIndex = Math.max(...headers.flatMap(h => h.data.map(d => d.rowIndex)), 0);

  // Add data rows
  for (let rowIndex = 1; rowIndex <= maxRowIndex; rowIndex++) {
    const rowData = headers.map(header => {
      const data = header.data.find(d => d.rowIndex === rowIndex);
      return data ? data.value || '' : '';
    });
    const row = sheet1.addRow(rowData);
    headers.forEach((header, colIndex) => {
      const data = header.data.find(d => d.rowIndex === rowIndex);
      if (data && data.valid === false) {
        const cell = row.getCell(colIndex + 1);
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
  }

  // Set column widths
  sheet1.columns = headers.map(header => ({
    width: Math.max(header.name.length, 15),
  }));

  // Add Sheet 2: Errors
  const sheet2 = workbook.addWorksheet('Errors');
  sheet2.addRows([
    ['Summary'],
    ['Total Rows', totalRows],
    ['Rows with Errors', totalErrorRows],
    [],
    ['Error Details'],
    ['Row Number', 'Issues'],
  ]);

  const sortedErrorRows = Array.from(errorRows.entries()).sort((a, b) => a[0] - b[0]);
  sortedErrorRows.forEach(([rowIndex, headerNames]) => {
    const issueText = headerNames.length > 1
      ? `Issues in ${headerNames.join(', ')}`
      : `Issue in ${headerNames[0]}`;
    sheet2.addRow([rowIndex, issueText]);
  });

  sheet2.columns = [
    { width: 12 },
    { width: 50 },
  ];

  // Write to buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

module.exports = {generateExcelFile};