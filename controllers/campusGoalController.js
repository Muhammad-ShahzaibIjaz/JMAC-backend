const { OperationLog, SheetDataSnapshot, CampusGoal } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');

const createCampusGoal = async (req, res) => {
    const { templateId, goalName, populationGoals = {}, goalType='view', totalPopulationMappings = [] } = req.body;
    const username = await getUserName(req.userId);
    try {
        if (!templateId || !goalName) {
            return res.status(400).json({ message: 'templateId, goalName are required.' });
        }

        const isExisting = await CampusGoal.findOne({ where: { templateId, goalName } });
        if (isExisting) {
            return res.status(400).json({ message: 'Campus goal with the same name already exists for this template.' });
        }
        const newCampusGoal = await CampusGoal.create({
            id: uuidv4(),
            templateId,
            goalName,
            populationGoals,
            goalType
        });
        await createLog({
            action: 'CREATE_CAMPUS_GOAL',
            username,
            performedBy: req.userRole,
            details: `Created campus goal '${goalName}' for template ID: ${templateId}`,
        });
        res.status(201).json(newCampusGoal);
    } catch (error) {
        await createLog({
            action: 'CREATE_CAMPUS_GOAL_FAILED',
            username,
            performedBy: req.userRole,
            details: `Failed to create campus goal '${goalName}' for template ID: ${templateId}. Error: ${error.message}`,
        });
        console.error('Error creating campus goal:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}


const updateCampusGoal = async (req, res) => {
    const { goalId } = req.params;
    const { goalName, populationGoals, totalPopulationMappings=[] } = req.body;
    const username = await getUserName(req.userId);
    try {
        const campusGoal = await CampusGoal.findByPk(goalId);
        if (!campusGoal) {
            return res.status(404).json({ message: 'Campus goal not found.' });
        }
        campusGoal.goalName = goalName || campusGoal.goalName;
        campusGoal.populationGoals = populationGoals || campusGoal.populationGoals;
        campusGoal.totalPopulationMappings = totalPopulationMappings || campusGoal.totalPopulationMappings;
        await campusGoal.save();
        await createLog({
            action: 'UPDATE_CAMPUS_GOAL',
            username,
            performedBy: req.userRole,
            details: `Updated campus goal ID: ${goalId}`,
        });
        res.status(200).json(campusGoal);
    } catch (error) {
        await createLog({
            action: 'UPDATE_CAMPUS_GOAL_FAILED',
            username,
            performedBy: req.userRole,
            details: `Failed to update campus goal ID: ${goalId}. Error: ${error.message}`,
        });
        console.error('Error updating campus goal:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

const deleteCampusGoal = async (req, res) => {
    const { goalId } = req.query;
    const username = await getUserName(req.userId);
    try {
        const campusGoal = await CampusGoal.findByPk(goalId);
        if (!campusGoal) {
            return res.status(404).json({ message: 'Campus goal not found.' });
        }
        await campusGoal.destroy();
        await createLog({
            action: 'DELETE_CAMPUS_GOAL',
            username,
            performedBy: req.userRole,
            details: `Deleted campus goal ID: ${goalId}`,
        });
        res.status(200).json({ message: 'Campus goal deleted successfully.' });
    } catch (error) {
        await createLog({
            action: 'DELETE_CAMPUS_GOAL_FAILED',
            username,
            performedBy: req.userRole,
            details: `Failed to delete campus goal ID: ${goalId}. Error: ${error.message}`,
        });
        console.error('Error deleting campus goal:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

const getCampusGoalsByTemplate = async (req, res) => {
    const { templateId } = req.query;
    try {
        const campusGoals = await CampusGoal.findAll({ where: { templateId } });
        res.status(200).json(campusGoals);
    } catch (error) {
        console.error('Error fetching campus goals:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports = {
    createCampusGoal,
    updateCampusGoal,
    deleteCampusGoal,
    getCampusGoalsByTemplate
};