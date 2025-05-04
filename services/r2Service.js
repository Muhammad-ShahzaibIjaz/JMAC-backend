const { uploadFile, checkFileName, deleteFile } = require("../config/r2");

const uploadFileToR2 = async (file) => {
  const filePath = await uploadFile(file);
  return { filePath, fileName: file.originalname };
};

const deleteFileToR2 = async (file) => {
    const status = await deleteFile(file);
    return status;
}

module.exports = { uploadFileToR2, checkFileName, deleteFileToR2 };