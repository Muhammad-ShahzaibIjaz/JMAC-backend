const sequelize = require('../config/database');
const { PellRule } = require('../models');


const createPellRule = async (req, res) => {
    const { name, pellSource, criteria, targetHeader, templateId } = req.body;

    try {

        if (!name || !pellSource || !criteria || !targetHeader || !templateId) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check for existing PellRule with the same name and templateId
        const existingPellRule = await PellRule.findOne({ where: { name, templateId } });
        if (existingPellRule) {
            return res.status(409).json({ error: 'PellRule with the same name and templateId already exists' });
        }
        const newPellRule = await PellRule.create({
            name,
            pellSource,
            criteria,
            targetHeader,
            templateId
        });
        res.status(201).json({id: newPellRule.id, pellName: name, pellSource: pellSource, criteria, targetHeader: targetHeader});
    } catch (error) {
        console.error('Error creating PellRule:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


const getPellRules = async (req, res) => {
    const { templateId } = req.query;

    try {
        const pellRules = await PellRule.findAll({ where: { templateId } });
        res.status(200).json(pellRules);
    } catch (error) {
        console.error('Error fetching PellRules:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getPellRuleById = async (req, res) => {
    const { id } = req.params;

    try {
        const pellRule = await PellRule.findByPk(id);
        if (!pellRule) {
            return res.status(404).json({ error: 'PellRule not found' });
        }
        res.status(200).json(pellRule);
    } catch (error) {
        console.error('Error fetching PellRule:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


const deletePellRule = async (req, res) => {
    const { id } = req.query;
    try {
        const pellRule = await PellRule.findByPk(id);
        if (!pellRule) {
            return res.status(404).json({ error: 'PellRule not found' });
        }
        await pellRule.destroy();
        res.status(200).json({ message: 'PellRule deleted successfully' });
    } catch (error) {
        console.error('Error deleting PellRule:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    createPellRule,
    getPellRules,
    getPellRuleById,
    deletePellRule
}