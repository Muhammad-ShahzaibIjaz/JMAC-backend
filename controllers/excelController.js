const { headerProcessor }  = require('../services/excelService');
const { deleteFileToR2 } = require('../services/r2Service');




async function handleHeaderProcessing(req, res) {
  try {
    if (!req.files || req.files.length == 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const processedFiles = await headerProcessor(req.files);
    res.json(processedFiles)
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteUploadedFile(req, res) {
  try {
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({ error: 'Missing file name' });
    }

    const status = await deleteFileToR2(fileName);

    if (status) {
      return res.status(200).json({ message: `File ${fileName} deleted successfully` });
    } else {
      return res.status(500).json({ error: `Failed to delete file ${fileName}` });
    }
  } catch (error) {
    console.error(`Error deleting file ${req.body.fileName}:`, error);
    return res.status(500).json({ error: `Failed to delete file: ${error.message}` });
  }
}


async function deleteUploadedFiles(req, res) {
  try {
    const { fileNames } = req.body;

    if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid file names' });
    }

    const results = await Promise.all(
      fileNames.map(async (fileName) => {
        try {
          const status = await deleteFileToR2(fileName);
          return { fileName, success: status };
        } catch (error) {
          return { fileName, success: false, error: error.message };
        }
      })
    );

    const successful = results.filter(r => r.success).map(r => r.fileName);
    const failed = results.filter(r => !r.success);

    if (successful.length === fileNames.length) {
      return res.status(200).json({ 
        message: `Files ${successful.join(', ')} deleted successfully`,
        deletedFiles: successful
      });
    } else {
      return res.status(207).json({
        message: 'Partial success in deleting files',
        deletedFiles: successful,
        failedFiles: failed.map(f => ({
          fileName: f.fileName,
          error: f.error
        }))
      });
    }
  } catch (error) {
    console.error('Error deleting files:', error);
    return res.status(500).json({ error: `Failed to process file deletion: ${error.message}` });
  }
}



module.exports = { handleHeaderProcessing, deleteUploadedFile, deleteUploadedFiles }