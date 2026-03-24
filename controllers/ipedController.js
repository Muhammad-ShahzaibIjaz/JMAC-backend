const { Campus, Note, CustomField } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');
const { getAllInstitutionNames } = require('../services/ipedsSearch');


const getAllInstNames = async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit) : null;
        const offset = req.query.offset ? parseInt(req.query.offset) : 0;
        const institutions = await getAllInstitutionNames(limit, offset);
        res.json(institutions);
    } catch (error) {
        console.error('Failed to get institution names:', error.message);
        res.status(500).json({ message: 'Failed to get institution names.' });
    }
}


module.exports = {
    getAllInstNames
};