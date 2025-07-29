const XLSX = require('xlsx');
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

function isRowEmpty(row) {
  if (!row || !Array.isArray(row)) return true;
  return row.every((cell) => cell === null || cell === undefined || cell === "");
}

// function processDataRows(jsonData, maxConsecutiveEmptyRows = 10) {
//   if (!jsonData || jsonData.length < 1) {
//     return { data: [], rowsSkipped: 0 };
//   }
  
//   const headers = jsonData[0] || [];
//   const dataRows = jsonData.slice(1) || [];
//   const cleanedRows = [];
//   let consecutiveEmptyRows = 0;

//   for (const row of dataRows) {
//     if (isRowEmpty(row)) {
//       consecutiveEmptyRows++;
//       if (consecutiveEmptyRows >= maxConsecutiveEmptyRows) break;
//       continue;
//     }
//     consecutiveEmptyRows = 0;
//     cleanedRows.push(row);
//   }
  
//   const processedData = headers.length > 0 ? [headers, ...cleanedRows] : cleanedRows;
//   return { data: processedData };
// }

function findFirstNonEmptyRow(jsonData, startFrom = 0) {
  for (let i = startFrom; i < jsonData.length; i++) {
    if (!isRowEmpty(jsonData[i])) {
      return i;
    }
  }
  return -1;
}

function processDataRows(jsonData, headerOrientation='horizontal', headerPosition=null, isRowSkipped=false ,maxConsecutiveEmptyRows=10) {
  if (!jsonData || !Array.isArray(jsonData) || jsonData.length < 1) {
    return { headers: [], data: [] };
  }

  let headers = [];
  let data = [];

  if (headerOrientation === 'horizontal') {
    // Handle horizontal headers (normal row)
    const headerRowIndex = headerPosition !== null ? headerPosition : findFirstNonEmptyRow(jsonData);
    
    if (headerRowIndex === -1 || headerRowIndex >= jsonData.length || !Array.isArray(jsonData[headerRowIndex])) {
      return { headers: [], data: [] };
    }

    const startRowIndex = isRowSkipped ? headerRowIndex + 1 : headerRowIndex;

    headers = jsonData[startRowIndex].filter(cell => cell !== null && cell !== undefined);
    
    // Process data rows
    let consecutiveEmptyRows = 0;
    for (let i = startRowIndex + 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!Array.isArray(row) || isRowEmpty(row)) {
        consecutiveEmptyRows++;
        if (consecutiveEmptyRows >= maxConsecutiveEmptyRows) break;
        continue;
      }
      consecutiveEmptyRows = 0;
      data.push(row);
    }
  } else {
    // Handle vertical headers (column)
    if (!jsonData[0] || !Array.isArray(jsonData[0])) {
      return { headers: [], data: [] };
    }
    // Handle vertical headers (column)
    const headerColIndex = headerPosition !== null ? headerPosition : (() => {
      let firstNonEmptyCol = 0;
      while (firstNonEmptyCol < jsonData[0].length && 
             jsonData.every(row => isRowEmpty([row[firstNonEmptyCol]]))) {
        firstNonEmptyCol++;
      }
      return firstNonEmptyCol < jsonData[0].length ? firstNonEmptyCol : -1;
    })();

    if (headerColIndex === -1 || headerColIndex >= jsonData[0].length) {
      return { headers: [], data: [] };
    }
 
    headers = jsonData.slice(isRowSkipped ? 1 : 0).map(row => row[headerColIndex]).filter(h => h !== null && h !== undefined);
    
    // Process data columns
    for (let i = headerColIndex + 1; i < jsonData[0].length; i++) {
      const column = jsonData.map(row => row[i]);
      if (!isRowEmpty(column)) {
        data.push(column);
      }
    }
  }

  return { 
    headers,
    data
  };
}

// async function headerProcessor(files) {

//   const processedFiles = [];

//   for (const file of files) {
//     if (!file.path) {
//       throw new Error(`File path is undefined for ${file.originalname}`);
//     }

//     try {
//       // Read file from disk
//       let workbook;
//       if (file.originalname.endsWith(".csv")) {
//         const csvData = fs.readFileSync(file.path, "utf8");
//         workbook = XLSX.read(csvData, { type: "string", raw: true });
//       } else {
//         workbook = XLSX.readFile(file.path); // Reads .xlsx/.xls directly from disk
//       }

//       const sheets = workbook.SheetNames.map((sheetName) => {
//         const worksheet = workbook.Sheets[sheetName];
//         const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

//         const { data: processedData } = processDataRows(jsonData);
//         const headers = processedData[0] || [];

//         return {
//           sheetName,
//           headers,
//           data: headers.length > 0 ? processedData.slice(1) : [],
//         };
//       }).filter((sheet) => sheet.headers.length > 0);

//       if (sheets.length === 0) {
//         throw new Error(`No valid sheets with headers found in ${file.originalname}`);
//       }

//       processedFiles.push({
//         id: uuidv4(),
//         fileName: file.originalname,
//         sheets,
//       });
//     } catch (error) {
//       throw new Error(`Failed to process file ${file.originalname}: ${error.message}`);
//     }
//   }

//   return processedFiles;
// }

async function headerProcessor(files, headerOrientation='horizontal', headerPosition=0, isRowSkipped=false) {

  const processedFiles = [];

  for (const file of files) {
    if (!file.path) {
      throw new Error(`File path is undefined for ${file.originalname}`);
    }

    try {
      // Read file from disk
      let workbook;
      if (file.originalname.endsWith(".csv")) {
        const csvData = fs.readFileSync(file.path, "utf8");
        workbook = XLSX.read(csvData, { type: "string", raw: true });
      } else {
        workbook = XLSX.readFile(file.path);
      }

      if(!workbook || !workbook.SheetNames || !workbook.SheetNames.length) {
        throw new Error(`No valid sheets found in ${file.originalname}`);
      }

      const sheets = workbook.SheetNames.map((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
          return null;
        }
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null, raw: false});

        const { headers, data } = processDataRows(jsonData, headerOrientation, headerPosition, isRowSkipped);
        return {
          sheetName,
          headers,
          data: headers.length > 0 ? data : [],
        };
      }).filter((sheet) => sheet.headers.length > 0);

      if (sheets.length === 0) {
        throw new Error(`No valid sheets with headers found in ${file.originalname}`);
      }
      processedFiles.push({
        id: uuidv4(),
        fileName: file.originalname,
        sheets,
      });
    } catch (error) {
      throw new Error(`Failed to process file ${file.originalname}: ${error.message}`);
    }
  }

  return processedFiles;
}


async function selectedHeaderProcessor(files, selectedSheetsData) {
  if (!files || files.length === 0) {
    throw new Error('No files provided for processing');
  }

  if (!Array.isArray(selectedSheetsData)) {
    throw new Error('Selected sheets data must be an array');
  }

  const processedFiles = [];

  for (const file of files) {
    if (!file.buffer) {
      throw new Error(`File buffer is undefined for ${file.originalname}`);
    }

    // Find the selected sheets for this file
    const fileSelection = selectedSheetsData.find(
      (selection) => selection.fileName === file.originalname
    );

    if (!fileSelection || !Array.isArray(fileSelection.sheets) || fileSelection.sheets.length === 0) {
      continue; // Skip files with no selected sheets
    }

    let filePath;
    try {
      filePath = generateUniqueFileName(file.originalname);

      let workbook;
      if (file.originalname.endsWith('.csv')) {
        const csvData = file.buffer.toString('utf8');
        workbook = XLSX.read(csvData, { type: 'string', raw: true });
      } else {
        workbook = XLSX.read(file.buffer, { type: 'buffer' });
      }

      const sheets = workbook.SheetNames.filter((sheetName) =>
        fileSelection.sheets.includes(sheetName)
      ).map((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        const { data: processedData, rowsSkipped } = processDataRows(jsonData);
        const headers = processedData[0] || [];

        return {
          sheetName,
          headers,
          data: headers.length > 0 ? processedData.slice(1) : [],
          rowsSkipped: rowsSkipped || 0,
        };
      }).filter((sheet) => sheet.headers.length > 0);

      if (sheets.length === 0) {
        throw new Error(`No valid selected sheets with headers found in ${file.originalname}`);
      }

      processedFiles.push({
        id: uuidv4(),
        filePath: filePath,
        fileName: file.originalname,
        sheets,
        rowsSkipped: sheets.reduce((sum, sheet) => sum + (sheet.rowsSkipped || 0), 0),
      });
    } catch (error) {
      throw new Error(`Failed to process file ${file.originalname}: ${error.message}`);
    }
  }

  if (processedFiles.length === 0) {
    throw new Error('No files with valid selected sheets were processed');
  }

  return processedFiles;
}


async function getFileSheet(files, headerOrientation, headerPosition) {
  const processedFiles = await headerProcessor(files, headerOrientation, headerPosition);
  const totalFiles = processedFiles.length;
  const totalSheets = processedFiles.reduce((sum, file) => sum + file.sheets.length, 0);
  if (totalFiles === 1 && totalSheets === 1) {
    return {
      sheetSelection: {}
    };
  }

  const sheetSelection = processedFiles.map(file => ({
    fileName: file.fileName,
    sheets: file.sheets.map(sheet => ({
      sheetName: sheet.sheetName,
      totalHeaders: sheet.headers.length
    }))
  }));

  return {
    sheetSelection
  };
}


async function exportHeader(templateName, headers) {
  try {
    const wb = XLSX.utils.book_new();
    const structureData = [headers.map(header => header.name)];
    const structureSheet = XLSX.utils.aoa_to_sheet(structureData);

    headers.forEach((header, colIndex) => {
      const cellAddress = XLSX.utils.encode_cell({ c: colIndex, r: 0 });
      if (!structureSheet[cellAddress]) structureSheet[cellAddress] = { v: header.name };

      switch (header.columnType) {
        case "Date":
          structureSheet[cellAddress].z = "dd-mm-yyyy";
          break;
        case "integer":
          structureSheet[cellAddress].z = "0";
          break;
        case "decimal":
          structureSheet[cellAddress].z = "0.00";
          break;
        case "Y/N":
          structureSheet[cellAddress].z = "1 or Yes or Y for yes and 0 or N or No for no";
          break;
        case "text":
        case "character":
        default:
          structureSheet[cellAddress].z = "@";
          break;
      }
    });

    XLSX.utils.book_append_sheet(wb, structureSheet, "Template Structure");

    const previewHeaders = headers.map(col => col.name);
    const sampleRows = Array(5).fill(0).map((_, rowIndex) =>
      headers.map(col => {
        switch (col.columnType) {
          case "integer":
            if (col.name.toLowerCase().includes("id")) return rowIndex + 1;
            if (col.name.toLowerCase().includes("age")) return 20 + rowIndex * 5;
            if (col.name.toLowerCase().includes("quantity") || col.name.toLowerCase().includes("count"))
              return (rowIndex + 1) * 5;
            if (col.name.toLowerCase().includes("rating")) return Math.min(5, rowIndex + 1);
            return (rowIndex + 1) * 100;
          case "decimal":
            if (col.name.toLowerCase().includes("cgpa") || col.name.toLowerCase().includes("gpa"))
              return (3.5 + rowIndex * 0.1).toFixed(4);
            if (col.name.toLowerCase().includes("price") || col.name.toLowerCase().includes("cost"))
              return (99.99 + rowIndex * 10).toFixed(4);
            if (col.name.toLowerCase().includes("change")) return (0.1 + rowIndex * 0.05).toFixed(4);
            return (rowIndex + 1 + 0.5).toFixed(4);
          case "character":
            if (col.name.toLowerCase().includes("grade")) return String.fromCharCode(65 + rowIndex % 5);
            if (col.name.toLowerCase().includes("flag") || col.name.toLowerCase().includes("status"))
              return rowIndex % 2 === 0 ? "Y" : "N";
            return "X";
          case "text":
            if (col.name.toLowerCase().includes("name")) {
              const names = ["John Smith", "Jane Doe", "Robert Johnson", "Emily Davis", "Michael Wilson"];
              return names[rowIndex % names.length];
            }
            if (col.name.toLowerCase().includes("email")) {
              const emails = [
                "john@example.com",
                "jane@example.com",
                "robert@example.com",
                "emily@example.com",
                "michael@example.com",
              ];
              return emails[rowIndex % emails.length];
            }
            return `Sample ${col.name} ${rowIndex + 1}`;
          case "Date":
            return "25-03-2025";
          case "Y/N":
            return rowIndex % 2 === 0 ? "Yes" : "No";
          default:
            return "";
        }
      })
    );

    const previewData = [previewHeaders, ...sampleRows];
    const previewSheet = XLSX.utils.aoa_to_sheet(previewData);


    headers.forEach((col, colIndex) => {
      if (col.columnType === "number" || col.columnType === "decimal") {
        for (let row = 1; row <= 5; row++) {
          const cellAddress = XLSX.utils.encode_cell({ c: colIndex, r: row });
          if (!previewSheet[cellAddress]) previewSheet[cellAddress] = {};
          previewSheet[cellAddress].z = "0.00";
        }
      } else if (col.columnType === "integer") {
        for (let row = 1; row <= 5; row++) {
          const cellAddress = XLSX.utils.encode_cell({ c: colIndex, r: row });
          if (!previewSheet[cellAddress]) previewSheet[cellAddress] = {};
          previewSheet[cellAddress].z = "0";
        }
      } else if (col.columnType === "Date") {
        for (let row = 1; row <= 5; row++) {
          const cellAddress = XLSX.utils.encode_cell({ c: colIndex, r: row });
          if (!previewSheet[cellAddress]) previewSheet[cellAddress] = {};
          previewSheet[cellAddress].z = "dd-mm-yyyy";
        }
      }
    });
    XLSX.utils.book_append_sheet(wb, previewSheet, "Template Preview");

    const docData = [
      ["Template Documentation"],
      ["Template Name", templateName],
      ["Number of Columns", headers.length.toString()],
      ["Required Columns", headers.filter(col => col.criticalityLevel === '1').length.toString()],
      ["Optional Columns", headers.filter(col => col.criticalityLevel !== '1').length.toString()],
      [""],
      ["Criticality Levels:"],
      ["1", "Critical (Required)"],
      ["2", "Recommended"],
      ["3", "Optional"],
      [""],
      ["Data Types:"],
      ["text", "Text values (strings)"],
      ["integer", "Integer values"],
      ["number", "Float/decimal values"],
      ["decimal", "Decimal values (alias for float)"],
      ["character", "Single character (e.g., A, Y, N)"],
      ["Date", "Date (DD-MM-YYYY)"],
      ["Y/N", "Yes/No values"],
      ["Yes/No", "Yes/No values (alias for Y/N)"],
      ["0/1", "Yes/No values (alias for Y/N)"],
    ];
    const docSheet = XLSX.utils.aoa_to_sheet(docData);
    XLSX.utils.book_append_sheet(wb, docSheet, "Documentation");

    const excelBuffer = XLSX.write(wb, {
      type: 'buffer',
      bookType: 'xlsx',
      cellStyles: true
    });
    return excelBuffer;

  } catch (error) {
    throw new Error(`Failed to generate Excel file: ${error.message}`);
  }
}



module.exports = { headerProcessor, exportHeader, getFileSheet, selectedHeaderProcessor }