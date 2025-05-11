const File = require('../models/File');
const { headerProcessor } = require('../services/excelService');
const sequelize = require('../config/database');
const fs = require('fs');
const path = require('path');

async function deleteFile(req, res) {
  try {
    const { templateId, fileName } = req.query;

    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }
    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }

    const filePath = path.join('uploads', templateId, fileName);

    await sequelize.transaction(async (transaction) => {
      const fileRecord = await File.findOne({
        where: {
          templateId,
          filename: fileName,
        },
        transaction,
      });

      if (!fileRecord) {
        throw new Error(`File record not found for ${fileName} with templateId ${templateId}`);
      }

      await fileRecord.destroy({ transaction });

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted file: ${filePath}`);
      } else {
        console.warn(`Physical file not found: ${filePath}`);
      }
    });

    res.status(200).json({ message: `File ${fileName} deleted successfully` });
  } catch (error) {
    console.error(`Error deleting file: ${error.message}`);
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
}


async function deleteFiles(req, res) {
  try {
    const { templateId, fileNames } = req.body;

    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }
    if (!Array.isArray(fileNames) || fileNames.length === 0) {
      return res.status(400).json({ error: 'fileNames must be a non-empty array' });
    }

    await sequelize.transaction(async (transaction) => {
      const deletedFiles = [];
      const notFoundFiles = [];

      for (const fileName of fileNames) {
        const filePath = path.join('uploads', templateId, fileName);

        const fileRecord = await File.findOne({
          where: {
            templateId,
            filename: fileName,
          },
          transaction,
        });

        if (!fileRecord) {
          notFoundFiles.push(fileName);
          continue;
        }

        await fileRecord.destroy({ transaction });

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`Deleted file: ${filePath}`);
        } else {
          console.warn(`Physical file not found: ${filePath}`);
        }

        deletedFiles.push(fileName);
      }

      if (notFoundFiles.length > 0) {
        throw new Error(`Some files not found: ${notFoundFiles.join(', ')}`);
      }
    });

    res.status(200).json({ 
      message: `Files deleted successfully`,
      deletedCount: fileNames.length
    });
  } catch (error) {
    console.error(`Error deleting files: ${error.message}`);
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
}


async function processFiles(files) {
  if (!files || files.length === 0) {
    throw new Error('No files uploaded');
  }

  const processedFiles = await headerProcessor(files);
  if (!Array.isArray(processedFiles) || processedFiles.length === 0) {
    throw new Error('No valid data processed from files');
  }

  // Validate processedFiles structure
  processedFiles.forEach((file, fileIndex) => {
    if (!file.id || !file.fileName || !file.sheets || !Array.isArray(file.sheets)) {
      throw new Error(`Invalid structure in file ${file.fileName || fileIndex + 1}`);
    }
    file.sheets.forEach((sheet, sheetIndex) => {
      if (!sheet.sheetName || !sheet.headers || !Array.isArray(sheet.headers) || !sheet.data || !Array.isArray(sheet.data)) {
        throw new Error(`Invalid sheet ${sheet.sheetName || sheetIndex + 1} in file ${file.fileName}`);
      }
      if (sheet.headers.length === 0) {
        throw new Error(`No headers in sheet ${sheet.sheetName || sheetIndex + 1} of file ${file.fileName}`);
      }
      sheet.data.forEach((row, rowIndex) => {
        if (!Array.isArray(row)) {
          throw new Error(`Invalid row ${rowIndex + 1} in sheet ${sheet.sheetName || sheetIndex + 1} of file ${file.fileName}`);
        }
        if (row.length !== sheet.headers.length) {
          console.warn(`Row ${rowIndex + 1} in sheet ${sheet.sheetName} of file ${file.fileName} has mismatched length`);
        }
      });
    });
  });

  return processedFiles;
}




module.exports = { deleteFile, deleteFiles, processFiles };