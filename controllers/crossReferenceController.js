const Header = require('../models/Header');
const CrossReference = require('../models/CrossReference');
const CrossReferenceMapping = require('../models/CrossReferenceMappingAttributes');
const Template = require('../models/Template');
const sequelize = require('../config/database');
const { DataTypes, Op } = require('sequelize');
const { applyReferenceOnData } = require('./dataController');


const addCrossReference = async (req, res) => {
    const { name, templateId, inputHeaderId, outputHeaderId } = req.body;
    try {
        if (!name || !templateId || !inputHeaderId || !outputHeaderId) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        const referenceExists = await sequelize.transaction(async (t) => {
            const existingReference = await CrossReference.findOne({
                where: {
                    name,
                    templateId,
                    inputHeaderId,
                    outputHeaderId
                },
                transaction: t
            });
            return existingReference !== null;
        });

        if (referenceExists) {
            return res.status(409).json({ error: 'Cross-reference already exists' });
        }

        const newReference = await CrossReference.create({
            name,
            templateId,
            inputHeaderId,
            outputHeaderId
        });

        return res.status(201).json(newReference.id);
    } catch (error) {
        console.error('Error adding cross-reference:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}


const getCrossReferences = async (req, res) => {
  const { templateId } = req.query;
  try {
    if (!templateId) {
      return res.status(400).json({ error: 'Template ID is required' });
    }

    const crossReferences = await CrossReference.findAll({
      where: { templateId },
      include: [
        {
          model: Header,
          as: 'inputHeader',
          attributes: ['name'],
        },
        {
          model: Header,
          as: 'outputHeader',
          attributes: ['name'],
        },
        {
          model: CrossReferenceMapping,
          as: 'mappings',
          attributes: ['inputValue', 'outputValue'],
        },
      ],
    });

    const formattedReferences = crossReferences.map((ref) => ({
      id: ref.id,
      name: ref.name,
      inputHeader: ref.inputHeader ? ref.inputHeader.name : '',
      outputHeader: ref.outputHeader ? ref.outputHeader.name : '',
      mappings: ref.mappings.map((mapping) => ({
        inputValue: mapping.inputValue,
        outputValue: mapping.outputValue,
      })),
    }));

    return res.status(200).json(formattedReferences);
  } catch (error) {
    console.error('Error fetching cross-references:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getCrossReferencesWithoutMapping = async (req, res) => {
  const { templateId } = req.query;
  try {
    if (!templateId) {
      return res.status(400).json({ error: 'Template ID is required' });
    }

    const crossReferences = await CrossReference.findAll({
      where: { templateId },
      include: [
        {
          model: Header,
          as: 'inputHeader',
          attributes: ['name'],
        },
        {
          model: Header,
          as: 'outputHeader',
          attributes: ['name'],
        },
      ],
    });

    const formattedReferences = crossReferences.map((ref) => ({
      id: ref.id,
      name: ref.name,
      inputHeader: ref.inputHeader ? ref.inputHeader.name : '',
      outputHeader: ref.outputHeader ? ref.outputHeader.name : '',
    }));

    return res.status(200).json(formattedReferences);
  } catch (error) {
    console.error('Error fetching cross-references-without mapping:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


const deleteCrossReference = async (req, res) => {
    const { id } = req.query;
    try {
        const crossReference = await CrossReference.findByPk(id);
        if (!crossReference) {
            return res.status(404).json({ error: 'Cross-reference not found' });
        }
        await crossReference.destroy();
        return res.status(204).send();
    } catch (error) {
        console.error('Error deleting cross-reference:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};


const applyReference = async (req, res) => {
  const { id } = req.query;
  try {
    if (!id) {
      return res.status(400).json({ error: 'Reference ID is required' });
    }

    const crossReferences = await CrossReference.findOne({
      where: { id },
      include: [
        {
          model: Header,
          as: 'inputHeader',
          attributes: ['id'],
        },
        {
          model: Header,
          as: 'outputHeader',
          attributes: ['id'],
        },
        {
          model: CrossReferenceMapping,
          as: 'mappings',
          attributes: ['inputValue', 'outputValue'],
        },
      ],
    });

    
    if (!crossReferences) {
        return res.status(404).json({ error: 'Cross-reference not found' });
    }
    
    const inputHeaderId = crossReferences.inputHeader.id;
    const outputHeaderId = crossReferences.outputHeader.id;
    const mappings = crossReferences.mappings.map((mapping) => ({
        inputValue: mapping.inputValue,
        outputValue: mapping.outputValue,
    }));
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return res.status(422).json({ error: 'There is no References Rules to apply' });
    }
    await applyReferenceOnData(inputHeaderId, outputHeaderId, mappings);
    return res.status(200).json({ message: 'Reference applied successfully' });
  } catch (error) {
    console.error('Error cross-references:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
    addCrossReference,
    getCrossReferences,
    deleteCrossReference,
    getCrossReferencesWithoutMapping,
    applyReference
};