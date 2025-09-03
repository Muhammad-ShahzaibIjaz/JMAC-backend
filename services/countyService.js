const ExcelJS = require('exceljs');
const path = require('path');

async function buildZipCountyMap(zipSet) {
  try {
    const filePath = path.join(__dirname, '..', 'utils', 'county_finder.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    const zipCountyMap = new Map();

    worksheet.eachRow((row) => {
      const rawZip = row.getCell(1).text.trim();
      const normalizedZip = rawZip.slice(0, 5);
      const county = row.getCell(2).text.trim();

      if (normalizedZip && county && zipSet.has(normalizedZip)) {
        zipCountyMap.set(normalizedZip, county);
      }
    });

    return zipCountyMap;
  } catch (error) {
    console.error('Error building ZIP-County map:', error);
    return new Map();
  }
}

module.exports = { buildZipCountyMap };