const File = require('../models/File');
const Template = require('../models/Template');
const SheetData = require('../models/SheetData');
const Header = require('../models/Header');
const sequelize = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { headerProcessor, getFileSheet, selectedHeaderProcessor }  = require('../services/excelService');
const { Op } = require('sequelize');
const fs = require("fs");
const path = require("path");


async function deleteFile(req, res) {
  try {
    const { fileId } = req.params;

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const result = await sequelize.transaction(async (t) => {
      const originalFile = await File.findOne({
        where: { id: fileId, isOriginal: true },
        transaction: t,
      });

      if (!originalFile) {
        return { deleted: false, message: 'Original file not found' };
      }

      const deletedCount = await File.destroy({
        where: { filePath: originalFile.filePath },
        transaction: t,
      });

      return {
        deleted: true,
        message: `Successfully deleted ${deletedCount} file(s) and associated data`,
      };
    });

    if (!result.deleted) {
      return res.status(404).json({ error: result.message });
    }

    res.json(result);
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: error.message });
  }
}

async function deleteMultipleFiles(req, res) {
  try {
    const { fileIds } = req.body;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds must be a non-empty array' });
    }

    const result = await sequelize.transaction(async (t) => {
      const deletedFiles = [];

      for (const fileId of fileIds) {
        const originalFile = await File.findOne({
          where: { id: fileId, isOriginal: true },
          transaction: t,
        });

        if (originalFile) {
          const deletedCount = await File.destroy({
            where: { filePath: originalFile.filePath },
            transaction: t,
          });

          deletedFiles.push({
            fileId,
            deleted: true,
            message: `Successfully deleted ${deletedCount} file(s)`,
          });
        } else {
          deletedFiles.push({
            fileId,
            deleted: false,
            message: 'Original file not found',
          });
        }
      }

      return deletedFiles;
    });

    const allDeleted = result.every((r) => r.deleted);
    const statusCode = allDeleted ? 200 : 207;

    res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error deleting multiple files:', error);
    res.status(500).json({ error: error.message });
  }
}

async function deleteOriginalFile(req, res) {
  try {
    const { fileId } = req.params;

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    const result = await sequelize.transaction(async (t) => {
      const deletedCount = await File.destroy({
        where: { id: fileId, isOriginal: true },
        transaction: t,
      });

      if (deletedCount === 0) {
        return { deleted: false, message: 'Original file not found' };
      }

      return {
        deleted: true,
        message: `Successfully deleted original file and associated data`,
      };
    });

    if (!result.deleted) {
      return res.status(404).json({ error: result.message });
    }

    res.json(result);
  } catch (error) {
    console.error('Error deleting original file:', error);
    res.status(500).json({ error: error.message });
  }
}

async function deleteMultipleOriginalFiles(req, res) {
  try {
    const { fileIds } = req.body;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds must be a non-empty array' });
    }

    const result = await sequelize.transaction(async (t) => {
      const deletedFiles = [];

      for (const fileId of fileIds) {
        const deletedCount = await File.destroy({
          where: { id: fileId, isOriginal: true },
          transaction: t,
        });

        if (deletedCount > 0) {
          deletedFiles.push({
            fileId,
            deleted: true,
            message: `Successfully deleted original file`,
          });
        } else {
          deletedFiles.push({
            fileId,
            deleted: false,
            message: 'Original file not found',
          });
        }
      }

      return deletedFiles;
    });

    const allDeleted = result.every((r) => r.deleted);
    const statusCode = allDeleted ? 200 : 207;

    res.status(statusCode).json(result);
  } catch (error) {
    console.error('Error deleting multiple original files:', error);
    res.status(500).json({ error: error.message });
  }
}


async function validateTemplate(templateId) {
  if (!templateId || templateId.trim().length === 0) {
    throw new Error('Template ID is required and must be non-empty');
  }
  const template = await Template.findByPk(templateId);
  if (!template) {
    throw new Error('Template does not exist');
  }
  return template;
}



async function fetchExistingHeaders(templateId) {
  if (!templateId) {
    throw new Error("templateId is required");
  }

  const existingHeaders = await Header.findAll({
    where: {
      templateId,
    },
    attributes: ["id", "name", "criticalityLevel", "columnType"],
  });

  return existingHeaders.map((header) => ({
    id: header.id,
    name: header.name,
    criticalityLevel: header.criticalityLevel,
    columnType: header.columnType,
  }));
}



async function saveFileAndData(processedFiles, templateId, transaction) {
  const allSheets = [];
  for (const processedFile of processedFiles) {
    if (!processedFile.fileName || !processedFile.sheets) {
      throw new Error(`Invalid processed file: ${JSON.stringify(processedFile)}`);
    }
    await File.create(
      {
        id: uuidv4(),
        filename: processedFile.fileName,
        templateId,
      },
      { transaction }
    );

    for (const sheet of processedFile.sheets) {
      if (!sheet.headers || !sheet.data) {
        throw new Error(`Invalid sheet in ${processedFile.fileName}: ${JSON.stringify(sheet)}`);
      }
      allSheets.push({
        fileName: processedFile.fileName,
        sheetName: sheet.sheetName,
        headers: sheet.headers,
        data: sheet.data,
      });
    }
  }


  const headerCounts = new Map();
  for (const sheet of allSheets) {
    for (const header of sheet.headers) {
      const lowerHeader = header.toLowerCase();
      headerCounts.set(lowerHeader, (headerCounts.get(lowerHeader) || 0) + 1);
    }
  }

  const commonHeader = [...headerCounts.entries()]
    .filter(([_, count]) => count === allSheets.length)
    .map(([header]) => header)[0];

  if (!commonHeader) {
    throw new Error("No common header found across all sheets");
  }


  const mergedHeaders = [];
  const headerSet = new Set();
  for (const sheet of allSheets) {
    for (const header of sheet.headers) {
      const lowerHeader = header.toLowerCase();
      if (!headerSet.has(lowerHeader)) {
        headerSet.add(lowerHeader);
        mergedHeaders.push(header);
      }
    }
  }

  const newDataQuality = new Map();
  for (const sheet of allSheets) {
    const idIndex = sheet.headers.findIndex((h) => h.toLowerCase() === commonHeader);
    for (const header of sheet.headers) {
      if (header.toLowerCase() === commonHeader) continue;
      const colIndex = sheet.headers.indexOf(header);
      const rowCount = sheet.data.length;
      const nonNullCount = sheet.data.filter((row) => row[colIndex] != null).length;

      if (!newDataQuality.has(header)) {
        newDataQuality.set(header, { rowCount: 0, nonNullCount: 0 });
      }
      const current = newDataQuality.get(header);
      if (
        rowCount > current.rowCount ||
        (rowCount === current.rowCount && nonNullCount > current.nonNullCount)
      ) {
        current.rowCount = rowCount;
        current.nonNullCount = nonNullCount;
      }
    }
  }

  const dataById = new Map();
  for (const sheet of allSheets) {
    const idIndex = sheet.headers.findIndex((h) => h.toLowerCase() === commonHeader);
    const otherHeaders = sheet.headers.filter((h) => h.toLowerCase() !== commonHeader);

    for (const row of sheet.data) {
      const id = row[idIndex];
      if (id == null) continue;
      if (!dataById.has(id)) {
        dataById.set(id, {});
      }
      const rowData = dataById.get(id);

      otherHeaders.forEach((header) => {
        const value = row[sheet.headers.indexOf(header)];
        if (!rowData[header] || (value != null && sheet.data.length > (rowData._rowCount || 0))) {
          rowData[header] = value;
          rowData._rowCount = sheet.data.length;
        }
      });
    }
  }

  const mergedData = [];
  for (const [id, rowData] of dataById) {
    const row = mergedHeaders.map((header) => {
      if (header.toLowerCase() === commonHeader) return id;
      return rowData[header] != null ? rowData[header].toString() : null;
    });
    mergedData.push(row);
  }

  const savedHeaders = [];
  for (const headerName of mergedHeaders) {
    const lowerHeaderName = headerName.toLowerCase();

    let header = await Header.findOne({
      where: {
        name: { [Op.iLike]: lowerHeaderName },
        templateId,
      },
      transaction,
    });

    if (!header) {
      header = await Header.create(
        {
          id: uuidv4(),
          name: headerName,
          criticalityLevel: "3",
          columnType: "text",
          templateId,
        },
        { transaction }
      );
    }

    const existingData = await SheetData.findAll({
      where: { headerId: header.id },
      transaction,
    });
    const existingRowCount = existingData.length;
    const existingNonNullCount = existingData.filter((d) => d.value != null).length;

    const newQuality = newDataQuality.get(headerName) || { rowCount: 0, nonNullCount: 0 };
    const shouldUpdate =
      existingRowCount === 0 ||
      newQuality.rowCount > existingRowCount ||
      (newQuality.rowCount === existingRowCount && newQuality.nonNullCount > existingNonNullCount);

    if (shouldUpdate) {
      await SheetData.destroy({
        where: { headerId: header.id },
        transaction,
      });
      console.log(`Updated data for header: ${headerName}`);
    } else {
      console.log(`Keeping existing data for header: ${headerName}`);
    }

    savedHeaders.push({ header, shouldUpdate });
  }

  for (let rowIndex = 0; rowIndex < mergedData.length; rowIndex++) {
    const row = mergedData[rowIndex];
    for (let colIndex = 0; colIndex < row.length && colIndex < savedHeaders.length; colIndex++) {
      if (!savedHeaders[colIndex].shouldUpdate) continue;
      const value = row[colIndex] != null ? row[colIndex].toString() : null;
      await SheetData.create(
        {
          id: uuidv4(),
          rowIndex: rowIndex + 1,
          value,
          headerId: savedHeaders[colIndex].header.id,
        },
        { transaction }
      );
    }
  }

  return { savedHeaders: savedHeaders.map((h) => h.header) };
}


async function uploadAndGetHeaders(req, res) {
  try {
    const { templateId } = req.body;
    const processedFiles = await headerProcessor(req.files.files);
    
    await sequelize.transaction(async (t) => {
      await saveFileAndData(processedFiles, templateId, t);
    });
    const headers = await fetchExistingHeaders(templateId);
    res.status(201).json({
      templateId,
      headers,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function processAndSaveSelectedSheets(req, res) {
  try{

    const { templateId, sheetSelectionData } = req.body;

    if (!templateId) {
      throw new Error("templateId is required");
    }
    if (!sheetSelectionData || !Array.isArray(sheetSelectionData)) {
      throw new Error("sheetSelectionData must be an array");
    }

    for (const selection of sheetSelectionData) {
      if (!selection.fileName || !selection.sheets || !Array.isArray(selection.sheets)) {
        throw new Error(`Invalid sheetSelectionData: ${JSON.stringify(selection)}`);
      }
      for (const sheet of selection.sheets) {
        if (!sheet.sheetName || typeof sheet.totalHeaders !== "number") {
          throw new Error(`Invalid sheet in ${selection.fileName}: ${JSON.stringify(sheet)}`);
        }
      }
    }

    const files = [];
    for (const selection of sheetSelectionData) {
      const filePath = path.join("uploads", templateId, selection.fileName);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      files.push({
        id: uuidv4(),
        path: filePath,
        originalname: selection.fileName,
      });
    }

    let processedFiles;
    try {
      processedFiles = await headerProcessor(files);
    } catch (error) {
      throw new Error(`Failed to process files: ${error.message}`);
    }

    const filteredProcessedFiles = [];
    for (const selection of sheetSelectionData) {
      const processedFile = processedFiles.find((pf) => pf.fileName === selection.fileName);
      if (!processedFile) {
        throw new Error(`Processed file not found for ${selection.fileName}`);
      }

      const selectedSheets = processedFile.sheets.filter((sheet) =>
        selection.sheets.some((s) => s.sheetName === sheet.sheetName)
      );

      for (const sheet of selectedSheets) {
        const selectionSheet = selection.sheets.find((s) => s.sheetName === sheet.sheetName);
        if (selectionSheet.totalHeaders !== sheet.headers.length) {
          throw new Error(
            `Header count mismatch for ${sheet.sheetName} in ${selection.fileName}: expected ${selectionSheet.totalHeaders}, got ${sheet.headers.length}`
          );
        }
      }

      if (selectedSheets.length > 0) {
        filteredProcessedFiles.push({
          ...processedFile,
          sheets: selectedSheets,
        });
      }
    }

    if (filteredProcessedFiles.length === 0) {
      throw new Error("No valid sheets selected for processing");
    }

    await sequelize.transaction(async (t) => {
      await saveFileAndData(filteredProcessedFiles, templateId, t);
    });
    const headers = await fetchExistingHeaders(templateId);
    res.status(201).json({
      templateId,
      headers,
    }); 

  } catch(error) {
    res.status(500).json({error: error.message});
  }
}




async function getFileSheets(req, res) {
  try{
    if (!req.files.files || req.files.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    const data = await getFileSheet(req.files.files);
    res.status(200).json(data)
  } catch(error) {
    res.status(500).json({ error: error.message })
  }

}



module.exports = {
  deleteFile,
  deleteMultipleFiles,
  deleteOriginalFile,
  deleteMultipleOriginalFiles,
  uploadAndGetHeaders,
  getFileSheets,
  processAndSaveSelectedSheets
};