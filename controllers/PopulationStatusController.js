const sequelize = require('../config/database');
const { DataTypes, Op, QueryTypes } = require('sequelize');
const { PopulationStatus, PopulationSubmission } = require('../models');


const savePopulationStatus = async (req, res) => {
    const { templateId, statusName, selectedStatuses, targetHeader } = req.body;
    try {

        if (!templateId || !selectedStatuses || !targetHeader) {
            return res.status(400).json({ error: 'templateId, selectedStatuses, and targetHeader are required' });
        }

        const isPopulationStatusExists = await PopulationStatus.findOne({
            where: {
                templateId,
                targetHeader,
                statusName
            }
        });

        if (isPopulationStatusExists) {
            return res.status(409).json({ error: 'A PopulationStatus with the same name already exists' });
        }

        const populationStatus = await PopulationStatus.create({
            templateId,
            statusName,
            selectedStatuses,
            targetHeader
        });
        res.status(201).json({id: populationStatus.id, statusName: populationStatus.statusName, selectedStatuses: populationStatus.selectedStatuses, targetHeader: populationStatus.targetHeader});
    } catch (error) {
        console.error('Error saving population status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


const getPopulationStatusByTemplateId = async (req, res) => {
    const { templateId } = req.params;
    try {
        if (!templateId) {
            return res.status(400).json({ error: 'templateId is required' });
        }
        const populationStatus = await PopulationStatus.findAll({
            where: { templateId },
            attributes: ['id', 'statusName', 'selectedStatuses', 'targetHeader']
        });
        res.status(200).json(populationStatus);
    } catch (error) {
        console.error('Error fetching population status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const savePopulationSubmissionDate = async (req, res) => {
  const { templateId, submissionDate, selectedSheets } = req.body;

  try {
    if (!templateId || !submissionDate || !selectedSheets) {
      return res.status(400).json({ error: 'templateId, submissionDate, and selectedSheets are required' });
    }

    // Check for exact match
    const isSubmissionExists = await PopulationSubmission.findOne({
      where: { templateId, submissionDate }
    });

    if (isSubmissionExists) {
      return res.status(409).json({ error: 'A PopulationSubmission with the same date already exists' });
    }

    // Check for any submission within 6 days before this one
    const sixDaysAgo = new Date(submissionDate);
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

    const recentSubmission = await PopulationSubmission.findOne({
      where: {
        templateId,
        submissionDate: {
          [Op.between]: [sixDaysAgo.toISOString().slice(0, 10), submissionDate]
        }
      }
    });

    if (recentSubmission) {
      return res.status(409).json({ error: 'A submission exists within 6 days before this date' });
    }

    // Save new submission
    const populationSubmission = await PopulationSubmission.create({
      templateId,
      submissionDate,
      selectedSheets
    });

    res.status(201).json({id: populationSubmission.id, submissionDate: populationSubmission.submissionDate, selectedSheets: populationSubmission.selectedSheets});
  } catch (error) {
    console.error('Error saving population submission date:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getPopulationSubmissionsByTemplateId = async (req, res) => {
    const { templateId } = req.params;
    try {
        if (!templateId) {
            return res.status(400).json({ error: 'templateId is required' });
        }
        const submissions = await PopulationSubmission.findAll({
            where: { templateId },
            attributes: ['id', 'submissionDate', 'selectedSheets'],
            order: [['submissionDate', 'DESC']]
        });
        res.status(200).json(submissions);
    } catch (error) {
        console.error('Error fetching population submissions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

const updatePopulationSubmissionDate = async (req, res) => {
    const { id, submissionDate, selectedSheets } = req.body;
    try {
        if (!id || !submissionDate || !selectedSheets) {
            return res.status(400).json({ error: 'id, submissionDate, and selectedSheets are required' });
        }
        const submission = await PopulationSubmission.findByPk(id);
        if (!submission) {
            return res.status(404).json({ error: 'PopulationSubmission not found' });
        }
        submission.submissionDate = submissionDate;
        submission.selectedSheets = selectedSheets;
        await submission.save();
        res.status(200).json(true);
    } catch (error) {
        console.error('Error updating population submission date:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}


const updatePopulationStatus = async (req, res) => {
    const { id, statusName, selectedStatuses, targetHeader } = req.body;
    try {
        if (!id || !selectedStatuses || !targetHeader) {
            return res.status(400).json({ error: 'id, selectedStatuses, and targetHeader are required' });
        }
        const populationStatus = await PopulationStatus.findByPk(id);
        if (!populationStatus) {
            return res.status(404).json({ error: 'PopulationStatus not found' });
        }
        populationStatus.statusName = statusName;
        populationStatus.selectedStatuses = selectedStatuses;
        populationStatus.targetHeader = targetHeader;
        await populationStatus.save();
        res.status(200).json(true);
    } catch (error) {
        console.error('Error updating population status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const deletePopulationSubmission = async (req, res) => {
    const { id } = req.params;

    try {
        if (!id) {
            return res.status(400).json({ error: 'id is required' });
        }

        const submission = await PopulationSubmission.findByPk(id);
        if (!submission) {
            return res.status(404).json({ error: 'PopulationSubmission not found' });
        }

        await submission.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting population submission:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}


const deletePopulationStatus = async (req, res) => {
    const { id } = req.params;

    try {
        if (!id) {
            return res.status(400).json({ error: 'id is required' });
        }

        const populationStatus = await PopulationStatus.findByPk(id);
        if (!populationStatus) {
            return res.status(404).json({ error: 'PopulationStatus not found' });
        }

        await populationStatus.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting population status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = {
    savePopulationStatus,
    savePopulationSubmissionDate,
    updatePopulationSubmissionDate,
    getPopulationSubmissionsByTemplateId,
    deletePopulationSubmission,
    getPopulationStatusByTemplateId,
    updatePopulationStatus,
    deletePopulationStatus
};