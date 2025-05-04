const axios = require("axios");
const { USER_ID, FOLDER_NAME, WORKER_URL } = require("./env");

const checkFileName = (sendingFileName, savedFileName) => {
  const match = savedFileName.match(/\/([^/]+)$/);
  const actualFileName = match[1].substring(match[1].indexOf('_') + 1);
  return sendingFileName === actualFileName;
};

const uploadFile = async (file, userId = USER_ID, folderName = FOLDER_NAME) => {
  const formData = new FormData();
  const blob = new Blob([file.buffer], { type: file.mimetype });
  formData.append("file", blob, file.originalname);
  formData.append("userId", userId);
  formData.append("folderName", folderName);

  try {
    const response = await axios.post(`${WORKER_URL}upload`, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    if (response.status === 200) {
      console.log("File uploaded successfully:", response.data.filePath);
      return response.data.filePath;
    } else {
      console.error("File upload failed:", response.statusText);
      throw new Error("File upload failed.");
    }
  } catch (error) {
    console.error("Error uploading file:", error.message);
    throw new Error("Error uploading file.");
  }
};

const deleteFile = async (filePath) => {
  try {
    const response = await axios.delete(`${WORKER_URL}delete`, {
      data: { filePath },
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.status === 200) {
      console.log("File deleted successfully:", filePath);
      return true;
    } else {
      console.error("Failed to delete file:", response.statusText);
      return false;
    }
  } catch (error) {
    console.error("Error deleting file:", error.message);
    return false;
  }
};

module.exports = { checkFileName, uploadFile, deleteFile };