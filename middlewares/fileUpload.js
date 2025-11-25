const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const templateId = (req.body.templateId || "").replace(/[^a-zA-Z0-9-]/g, "");
    const sheetId = (req.body.sheetId || "").replace(/[^a-zA-Z0-9-]/g, "");
    if (!templateId) {
      const error = new Error("templateId is required");
      error.statusCode = 400;
      return cb(error);
    }
    
    let uploadDir;

    if (sheetId) {
      uploadDir = path.join("uploads", templateId, sheetId);
    } else {
      uploadDir = path.join("uploads", templateId);
    }

    fs.mkdirSync(uploadDir, { recursive: true });

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const templateId = (req.body.templateId || "").replace(/[^a-zA-Z0-9-]/g, "");
    const sheetId = (req.body.sheetId || "").replace(/[^a-zA-Z0-9-]/g, "");
    let uploadDir;
    if (sheetId) {
      uploadDir = path.join("uploads", templateId, sheetId);
    } else {
      uploadDir = path.join("uploads", templateId);
    }
    const targetFilename = file.originalname;

    if (fs.existsSync(path.join(uploadDir, targetFilename))) {
      const error = new Error(`File '${file.originalname}' already exists for this templateId`);
      error.statusCode = 409;
      return cb(error);
    }

    cb(null, targetFilename);
  },
});

// Configure Multer middleware
const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 10,
    fields: 7,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      // Standard Excel formats
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
      "application/vnd.ms-excel", // .xls
      
      // Macro-enabled formats
      "application/vnd.ms-excel.sheet.macroEnabled.12", // .xlsm
      "application/vnd.ms-excel.template.macroEnabled.12", // .xltm
      "application/vnd.ms-excel.addin.macroEnabled.12", // .xlam
      
      // Binary format
      "application/vnd.ms-excel.sheet.binary.macroEnabled.12", // .xlsb
      
      // Template formats
      "application/vnd.openxmlformats-officedocument.spreadsheetml.template", // .xltx
      
      // CSV formats
      "text/csv",
      "application/csv",
      "text/x-csv",
      "text/comma-separated-values",
      
      // Fallback for some Excel files
      "application/octet-stream"
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      const error = new Error("Invalid file type. Only Excel and CSV files are allowed.");
      error.statusCode = 400;
      cb(error);
    }
  },
}).fields([
  { name: "templateId", maxCount: 1 },
  { name: "files", maxCount: 10 },
  { name: "headerOrientation", maxCount: 1 },
  { name: "headerPosition", maxCount: 1 },
  { name: "isRowSkipped", maxCount: 1 },
  { name: "sheetId", maxCount: 1 },
  { name: "isOriginal", maxCount: 1 },
]);

module.exports = upload;