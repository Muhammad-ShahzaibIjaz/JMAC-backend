const Header = require('../models/Header');
const CrossReference = require('../models/CrossReference');
const CrossReferenceMapping = require('../models/CrossReferenceMappingAttributes');
const Template = require('../models/Template');
const sequelize = require('../config/database');
const File = require('../models/File');
const { DataTypes, Op } = require('sequelize');
const { applyReferenceOnData } = require('./dataController');
const { updateReferenceMappings } = require('./referenceMappingController');
const path = require("path");
const { headerProcessor }  = require('../services/excelService');


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

const updateCrossReferenceWithMapping = async (req, res) => {
  const { id, name, inputHeaderId, outputHeaderId, mappings } = req.body;
  try{
    if (!id || !name || !inputHeaderId || !outputHeaderId || !mappings || !Array.isArray(mappings)) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const crossReference = await CrossReference.findByPk(id);
    if (!crossReference) {
      return res.status(404).json({ error: 'Cross-reference not found' });
    }
    crossReference.name = name;
    crossReference.inputHeaderId = inputHeaderId;
    crossReference.outputHeaderId = outputHeaderId;
    await crossReference.save();
    await updateReferenceMappings(crossReference.id, mappings);
    return res.status(200).json({ message: 'Cross-reference updated successfully' });
  } catch (error) {
    console.error('Error updating cross-reference:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

const parseAndGetReferenceMapping = async (req, res) => {
  try {
    const { templateId } = req.body;

    if (!req.files?.files || req.files.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }

    const fileNames = req.files.files.map(file => file.filename);
    const filesMeta = fileNames.map(fileName => ({
      path: path.join('uploads', templateId, fileName),
      originalname: fileName,
    }));

    for (const file of filesMeta) {
      try {
        await File.create({
          filename: file.originalname,
          templateId,
        });
      } catch (createError) {
        console.error(`Failed to create File record for ${file.originalname}: ${createError.message}`);
      }
    }

    const processedFiles = await headerProcessor(req.files.files);

    if (!processedFiles || processedFiles.length === 0) {
      return res.status(422).json({ error: 'No content found in the uploaded files' });
    }

    const referenceMappings = [];

    for (const file of processedFiles) {
      for (const sheet of file.sheets) {
        const headers = sheet.headers;
        const rows = sheet.data;

        if (headers.length < 2) {
          console.warn(`Sheet "${sheet.sheetName}" in file "${file.fileName}" has less than 2 columns. Skipping.`);
          continue;
        }

        for (const row of rows) {
          if (row.length < 2) continue;

          referenceMappings.push({
            inputValue: row[0],
            outputValue: row[1],
          });
        }
      }
    }

    if (referenceMappings.length === 0) {
      return res.status(422).json({ error: 'No valid mappings found in the uploaded files' });
    }

    return res.status(200).json(referenceMappings);

  } catch (error) {
    console.error('Error processing files:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};




module.exports = {
    addCrossReference,
    getCrossReferences,
    deleteCrossReference,
    getCrossReferencesWithoutMapping,
    applyReference,
    updateCrossReferenceWithMapping,
    parseAndGetReferenceMapping
};