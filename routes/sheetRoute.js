const express = require("express");
const router = express.Router();
const sheetController = require("../controllers/sheetController");

router.post("/sheet", sheetController.createSheet);
router.get("/sheets/:templateId", sheetController.getSheetsByTemplate);

module.exports = router;
