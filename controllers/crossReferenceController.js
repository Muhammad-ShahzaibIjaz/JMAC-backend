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
    const { name, templateId, inputHeaderIds, outputHeaderIds, dependentReferenceId = null } = req.body;
    try {
        if (!name || !templateId || !inputHeaderIds || !outputHeaderIds) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        const referenceExists = await sequelize.transaction(async (t) => {
            const existingReference = await CrossReference.findOne({
                where: {
                    name,
                    templateId,
                    inputHeaderIds,
                    outputHeaderIds
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
            inputHeaderIds,
            outputHeaderIds,
            dependentReferenceId
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
          model: CrossReferenceMapping,
          as: 'mappings',
          attributes: ['inputValue', 'outputValue'],
        },
      ],
    });

    // Collect all header IDs from all references
    const allHeaderIds = [
      ...new Set(
        crossReferences.flatMap((ref) => [
          ...(ref.inputHeaderIds || []),
          ...(ref.outputHeaderIds || []),
        ])
      ),
    ];

    // Fetch all headers in one go
    const headers = await Header.findAll({
      where: { id: { [Op.in]: allHeaderIds } },
      attributes: ['id', 'name'],
    });

    const headerMap = Object.fromEntries(
      headers.map((h) => [h.id, h.name])
    );


    const formattedReferences = crossReferences.map((ref) => ({
      id: ref.id,
      name: ref.name,
      inputHeaders: (ref.inputHeaderIds || []).map((id) => headerMap[id] || ''),
      outputHeaders: (ref.outputHeaderIds || []).map((id) => headerMap[id] || ''),
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
    });

    // Collect all header IDs from all references
    const allHeaderIds = [
      ...new Set(
        crossReferences.flatMap((ref) => [
          ...(ref.inputHeaderIds || []),
          ...(ref.outputHeaderIds || []),
        ])
      ),
    ];

    // Fetch all headers in one go
    const headers = await Header.findAll({
      where: { id: { [Op.in]: allHeaderIds } },
      attributes: ['id', 'name'],
    });

    const headerMap = Object.fromEntries(
      headers.map((h) => [h.id, h.name])
    );

    const formattedReferences = crossReferences.map((ref) => ({
      id: ref.id,
      name: ref.name,
      inputHeaders: (ref.inputHeaderIds || []).map((id) => headerMap[id] || ''),
      outputHeaders: (ref.outputHeaderIds || []).map((id) => headerMap[id] || ''),
      dependentReferenceId: ref.dependentReferenceId ? ref.dependentReferenceId : null
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
    await CrossReference.update(
      { dependentReferenceId: null },
      { where: { dependentReferenceId: id } }
    );
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
          model: CrossReferenceMapping,
          as: 'mappings',
          attributes: ['inputValue', 'outputValue'],
        },
      ],
    });
    
    if (!crossReferences) {
        return res.status(404).json({ error: 'Cross-reference not found' });
    }
    
    const inputHeaderIds = crossReferences.inputHeaderIds || [];
    const inputHeaderNames = await Header.findAll({
      where: { id: { [Op.in]: inputHeaderIds } },
      attributes: ['id', 'name'],
    });
    const outputHeaderIds = crossReferences.outputHeaderIds || [];
    const mappings = crossReferences.mappings.map((mapping) => ({
        inputValue: mapping.inputValue,
        outputValue: mapping.outputValue,
    }));
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return res.status(422).json({ error: 'There is no References Rules to apply' });
    }
    const allUnmapped = [];
    for (let i = 0; i < inputHeaderIds.length; i++) {
      const unmapped = await applyReferenceOnData(inputHeaderIds[i], outputHeaderIds[i], mappings);
      if (unmapped.length > 0) {
        allUnmapped.push({
          headerName: inputHeaderNames[i].name,
          unmappedValues: unmapped,
        });
      }
    }
    return res.status(200).json(allUnmapped);
  } catch (error) {
    console.error('Error cross-references:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

const updateCrossReferenceWithMapping = async (req, res) => {
  const { id, name, inputHeaderIds, outputHeaderIds, mappings, dependentReferenceId = null } = req.body;
  try{
    if (!id || !name || !inputHeaderIds || !outputHeaderIds || !mappings || !Array.isArray(mappings)) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const crossReference = await CrossReference.findByPk(id);
    if (!crossReference) {
      return res.status(404).json({ error: 'Cross-reference not found' });
    }
    crossReference.name = name;
    crossReference.inputHeaderIds = inputHeaderIds;
    crossReference.outputHeaderIds = outputHeaderIds;
    if (dependentReferenceId !== null) {
      crossReference.dependentReferenceId = dependentReferenceId;
    }
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
    const { templateId, fileName, headerInName, headerOutName } = req.body;

    if (!templateId || !fileName || !headerInName) {
      return res.status(400).json({ error: 'templateId, fileName, headerInName are required' });
    }

    const filePath = path.join('uploads', templateId, fileName);

    const fileObj = {
      path: filePath,
      originalname: fileName,
    };

    const processedFiles = await headerProcessor([fileObj]);

    if (!processedFiles || processedFiles.length === 0) {
      return res.status(422).json({ error: 'No content found in the file' });
    }

    const fileData = processedFiles[0];
    const referenceRows = [];

    for (const sheet of fileData.sheets) {
      const headers = sheet.headers;
      const rows = sheet.data;

      const headerInIndex = headers.findIndex(h => h.trim().toLowerCase() === headerInName.trim().toLowerCase());
      const headerOutIndex = headerOutName
        ? headers.findIndex(h => h.trim().toLowerCase() === headerOutName.trim().toLowerCase())
        : -1;

      if (headerInIndex === -1) {
        console.warn(`Header "${headerInName}" not found in sheet "${sheet.sheetName}"`);
        continue;
      }

      for (const row of rows) {
        const inputValue = row[headerInIndex]?.toString().trim();
        const outputValue = headerOutIndex !== -1 ? row[headerOutIndex]?.toString().trim() : "";

        if (inputValue) {
          referenceRows.push({ inputValue, outputValue });
        }
      }
    }

    // Remove duplicates based on inputValue
    const uniqueRows = Array.from(
      new Map(referenceRows.map(row => [row.inputValue, row])).values()
    );

    if (uniqueRows.length === 0) {
      return res.status(422).json({ error: `No values found for header "${headerInName}"` });
    }

    return res.status(200).json(uniqueRows);

  } catch (error) {
    console.error('Error processing header mapping:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


const getReferenceHeader = async (req, res) => {
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

    const allHeaders = processedFiles.flatMap(file =>
      file.sheets.flatMap(sheet => sheet.headers || [])
    );

    const uniqueHeaders = [...new Set(allHeaders.map(h => h.trim()))];

    return res.status(200).json({ headers: uniqueHeaders });

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
    parseAndGetReferenceMapping,
    getReferenceHeader
};