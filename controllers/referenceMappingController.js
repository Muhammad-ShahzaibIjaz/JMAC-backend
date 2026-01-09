const Header = require('../models/Header');
const CrossReference = require('../models/CrossReference');
const CrossReferenceMapping = require('../models/CrossReferenceMappingAttributes');
const Template = require('../models/Template');
const sequelize = require('../config/database');
const { DataTypes, Op } = require('sequelize');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');


const addReferenceMapping = async (req, res) => {
    const username = await getUserName(req.userId);
    const { crossReferenceId, mappings } = req.body;
    try {
        if (!crossReferenceId || !mappings || !Array.isArray(mappings)) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        const crossReference = await CrossReference.findByPk(crossReferenceId);
        if (!crossReference) {
            return res.status(404).json({ error: 'Cross-reference not found' });
        }
        const existingMappings = await CrossReferenceMapping.findAll({
            where: { crossReferenceId },
            attributes: ['inputValue', 'outputValue']
        });
        const existingMappingSet = new Set(existingMappings.map(m => `${m.inputValue}-${m.outputValue}`));
        const newMappings = mappings.filter(mapping => {
            const mappingKey = `${mapping.inputValue}-${mapping.outputValue}`;
            return !existingMappingSet.has(mappingKey);
        });
        if (newMappings.length === 0) {
            return res.status(409).json({ error: 'No new mappings to add' });
        }
        const createdMappings = await CrossReferenceMapping.bulkCreate(
            newMappings.map(mapping => ({
                crossReferenceId,
                inputValue: mapping.inputValue,
                outputValue: mapping.outputValue
            })),
            { returning: true }
        );
        await createLog({ action: 'ADD_REFERENCE_MAPPINGS', username, performedBy: req.userId, details: `Added ${createdMappings.length} mappings to Cross-Reference ID: ${crossReferenceId}` });
        return res.status(201).json("success");
    } catch (error) {
        await createLog({ action: 'ADD_REFERENCE_MAPPINGS_FAILED', username, performedBy: req.userId, details: `Failed to add mappings to Cross-Reference ID: ${crossReferenceId}: ${error.message}` });
        console.error('Error adding cross-reference mappings:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}


const updateReferenceMappings = async (crossReferenceId, mappings) => {
    try {
        await sequelize.transaction(async (t) => {
            await CrossReferenceMapping.destroy({
                where: { crossReferenceId },
                transaction: t
            });
            await CrossReferenceMapping.bulkCreate(
                mappings.map(mapping => ({
                    crossReferenceId,
                    inputValue: mapping.inputValue,
                    outputValue: mapping.outputValue
                })),
                { transaction: t }
            );
        });
    } catch (error) {
        console.error('Error updating reference mappings:', error);
        throw error;
    }
}

module.exports = {
    addReferenceMapping,
    updateReferenceMappings
};