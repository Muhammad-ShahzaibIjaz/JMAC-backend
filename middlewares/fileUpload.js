const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure disk storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const templateId = (req.body.templateId || "").replace(/[^a-zA-Z0-9-]/g, "");
    if (!templateId) {
      const error = new Error("templateId is required");
      error.statusCode = 400;
      return cb(error);
    }

    const uploadDir = path.join("uploads", templateId);

    fs.mkdirSync(uploadDir, { recursive: true });

    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const templateId = (req.body.templateId || "").replace(/[^a-zA-Z0-9-]/g, "");
    const uploadDir = path.join("uploads", templateId);
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
    fields: 1,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
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
]);

module.exports = upload;