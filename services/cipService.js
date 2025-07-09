const ExcelJS = require('exceljs');
const path = require('path');

async function getCipTitle(cipCode) {
    try {
        const filePath = path.join(__dirname, '..', 'utils', 'CIPCode2020.xlsx');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        
        const worksheet = workbook.worksheets[0];
        
        let foundRow = null;
        
        worksheet.eachRow((row, rowNumber) => {
            const rowCipCode = row.getCell(2).text;
            if (rowCipCode === cipCode) {
                foundRow = row.getCell(5).text;
                return false;
            }
        });
        
        return foundRow || null;
    } catch (error) {
        console.error('Error reading Excel file:', error);
        return null;
    }
}


module.exports = { getCipTitle }