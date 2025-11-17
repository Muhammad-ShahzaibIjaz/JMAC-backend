const Tree = require('../models/Tree');
const Template = require('../models/Template');
const sequelize = require('../config/database');
const { DataTypes, Op, where, cast, col, fn, literal} = require('sequelize');
const { v4: uuidv4 } = require('uuid');


const createDecisionTree = async (req, res) => {
  const { templateId, name, treeData, baseHeader, sheetId, totalDataCount } = req.body;
    try {
        if (!templateId || !name || !treeData || !baseHeader || !sheetId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const isTreeExists = await Tree.findOne({
            where: {
                templateId,
                name
            }
        });

        if (isTreeExists) {
            return res.status(409).json({ error: 'Decision tree with the same name already exists for this template' });
        }

        const decisionTree = await Tree.create({
            templateId,
            name,
            treeData,
            baseHeader,
            sheetId,
            totalDataCount: totalDataCount || 0
        });

        res.status(201).json({name: decisionTree.name, id: decisionTree.id, templateId: decisionTree.templateId, sheetId: decisionTree.sheetId});
    } catch (error) {
        console.error('Error creating decision tree:', error);
        res.status(500).json({ error: 'Failed to create decision tree' });
    }
};


const getDecisionTreesByTemplate = async (req, res) => {
  const { templateId } = req.params;
    try {
        const decisionTrees = await Tree.findAll({
            where: { templateId }
        });
        const formattedTrees = decisionTrees.map(tree => ({ name: tree.name, id: tree.id, templateId: tree.templateId, sheetId: tree.sheetId }));
        res.status(200).json(formattedTrees);
    } catch (error) {
        console.error('Error fetching decision trees:', error);
        res.status(500).json({ error: 'Failed to fetch decision trees' });
    }
};


const getDecisionTreeById = async (req, res) => {
  const { treeId } = req.params;
    try {
        const decisionTree = await Tree.findByPk(treeId);
        if (!decisionTree) {
            return res.status(404).json({ error: 'Decision tree not found' });
        }
        res.status(200).json(decisionTree);
    } catch (error) {
        console.error('Error fetching decision tree:', error);
        res.status(500).json({ error: 'Failed to fetch decision tree' });
    }
};

const deleteDecisionTree = async (req, res) => {
  const { treeId } = req.params;
    try {
        const deletedCount = await Tree.destroy({
            where: { id: treeId }
        });
        if (deletedCount === 0) {
            return res.status(404).json({ error: 'Decision tree not found' });
        }
        res.status(200).json({ message: 'Decision tree deleted successfully' });
    }
    catch (error) {
        console.error('Error deleting decision tree:', error);
        res.status(500).json({ error: 'Failed to delete decision tree' });
    }
};

const updateDecisionTree = async (req, res) => {
    const { treeId } = req.params;
    const { name, treeData, baseHeader, sheetId, totalDataCount, isActive } = req.body;
    try {
        const decisionTree = await Tree.findByPk(treeId);
        if (!decisionTree) {
            return res.status(404).json({ error: 'Decision tree not found' });
        }
        decisionTree.name = name || decisionTree.name;
        decisionTree.treeData = treeData || decisionTree.treeData;
        decisionTree.baseHeader = baseHeader || decisionTree.baseHeader;
        decisionTree.sheetId = sheetId || decisionTree.sheetId;
        decisionTree.totalDataCount = totalDataCount !== undefined ? totalDataCount : decisionTree.totalDataCount;
        if (isActive !== undefined) {
            decisionTree.isActive = isActive;
        }
        await decisionTree.save();
        res.status(200).json(decisionTree);
    } catch (error) {
        console.error('Error updating decision tree:', error);
        res.status(500).json({ error: 'Failed to update decision tree' });
    }
};


module.exports = {
  createDecisionTree,
  getDecisionTreesByTemplate,
  getDecisionTreeById,
  deleteDecisionTree,
  updateDecisionTree
};