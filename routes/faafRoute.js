const express = require("express");
const fs = require("fs");
const router = express.Router();
const FILE_PATH = "./counts.json";


// Helper: read counts from file
function readCounts() {
    if (!fs.existsSync(FILE_PATH)) {
        return { yes: 0, no: 0 };
    }
    const data = fs.readFileSync(FILE_PATH);
    return JSON.parse(data);
}

// Helper: write counts to file
function writeCounts(counts) {
    fs.writeFileSync(FILE_PATH, JSON.stringify(counts, null, 2));
}

// Route: handle clicks
router.post("/click", (req, res) => {
    const { choice } = req.body;
    let counts = readCounts();
    
    if (choice === "yes" || choice === "no") {
        counts[choice] += 1;
        writeCounts(counts);
    }
    
    res.json({ counts });
});

// Route: get current counts
router.get("/click", (req, res) => {
    const counts = readCounts();
    res.json({ counts });
});

module.exports = router;