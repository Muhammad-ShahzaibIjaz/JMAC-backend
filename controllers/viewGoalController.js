const { ViewGoal } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');

const createViewGoal = async (req, res) => {
    const { templateId, goalYear, populationGoals = {} } = req.body;
    const username = await getUserName(req.userId);
    try {
        if (!templateId || !goalYear) {
            return res.status(400).json({ message: 'templateId, goalYear are required.' });
        }

        const isExisting = await ViewGoal.findOne({ where: { templateId, goalYear } });
        if (isExisting) {
            return res.status(400).json({ message: 'View goal with the same year already exists for this template.' });
        }
        const newViewGoal = await ViewGoal.create({
            id: uuidv4(),
            templateId,
            goalYear,
            populationGoals
        });
        await createLog({
            action: 'CREATE_VIEW_GOAL',
            username,
            performedBy: req.userRole,
            details: `Created view goal '${goalYear}' for template ID: ${templateId}`,
        });
        res.status(201).json(newViewGoal);
    } catch (error) {
        await createLog({
            action: 'CREATE_VIEW_GOAL_FAILED',
            username,
            performedBy: req.userRole,
            details: `Failed to create view goal '${goalYear}' for template ID: ${templateId}. Error: ${error.message}`,
        });
        console.error('Error creating view goal:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}


const updateViewGoal = async (req, res) => {
    const { goalId } = req.params;
    const { populationGoals } = req.body;
    const username = await getUserName(req.userId);
    try {
        const viewGoal = await ViewGoal.findByPk(goalId);
        if (!viewGoal) {
            return res.status(404).json({ message: 'View goal not found.' });
        }
        viewGoal.populationGoals = populationGoals || viewGoal.populationGoals;
        await viewGoal.save();
        await createLog({
            action: 'UPDATE_VIEW_GOAL',
            username,
            performedBy: req.userRole,
            details: `Updated view goal ID: ${goalId}`,
        });
        res.status(200).json(viewGoal);
    } catch (error) {
        await createLog({
            action: 'UPDATE_VIEW_GOAL_FAILED',
            username,
            performedBy: req.userRole,
            details: `Failed to update view goal ID: ${goalId}. Error: ${error.message}`,
        });
        console.error('Error updating view goal:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

const deleteViewGoal = async (req, res) => {
    const { goalId } = req.query;
    const username = await getUserName(req.userId);
    try {
        const viewGoal = await ViewGoal.findByPk(goalId);
        if (!viewGoal) {
            return res.status(404).json({ message: 'View goal not found.' });
        }
        await viewGoal.destroy();
        await createLog({
            action: 'DELETE_VIEW_GOAL',
            username,
            performedBy: req.userRole,
            details: `Deleted view goal ID: ${goalId}`,
        });
        res.status(200).json({ message: 'View goal deleted successfully.' });
    } catch (error) {
        await createLog({
            action: 'DELETE_VIEW_GOAL_FAILED',
            username,
            performedBy: req.userRole,
            details: `Failed to delete view goal ID: ${goalId}. Error: ${error.message}`,
        });
        console.error('Error deleting view goal:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

const getViewGoalsByTemplate = async (req, res) => {
    const { templateId } = req.query;
    try {
        const viewGoals = await ViewGoal.findAll({ where: { templateId } });
        res.status(200).json(viewGoals);
    } catch (error) {
        console.error('Error fetching view goals:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports = {
    createViewGoal,
    updateViewGoal,
    deleteViewGoal,
    getViewGoalsByTemplate
};