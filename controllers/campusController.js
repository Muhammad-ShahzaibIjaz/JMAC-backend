const { Campus, Note, CustomField } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');


const createCampus = async (req, res) => {
  const {
    campusName,
    address = "",
    city = "",
    state = "",
    zipCode = "",
    campusMainNumber = "",
    presidentEmail = "",
    undergradStudents = 0,
    gradStudents = 0,
    presidentName = "",
    schoolType,
    customFields = [],
  } = req.body;

  const username = await getUserName(req.userId);

  try {
    if (!campusName) {
      return res.status(400).json({ message: "campusName is required." });
    }

    const newCampus = await Campus.create({
      id: uuidv4(),
      campusName,
      address,
      city,
      state,
      zipCode,
      campusMainNumber,
      presidentEmail,
      undergradStudents,
      gradStudents,
      presidentName,
      schoolType,
    });


    let createdCustomFields = [];
    if (customFields.length) {
      createdCustomFields = await Promise.all(
        customFields.map(field =>
          CustomField.create({ label: field.label, value: field.value, type: field.type, campusId: newCampus.id })
        )
      );
    }


    await createLog({
      action: "CREATE_CAMPUS",
      username,
      performedBy: req.userRole,
      details: `Created campus '${campusName}' with ID: ${newCampus.id}`,
    });

    // Merge everything into one object
    const responseObject = {
      ...newCampus.toJSON(),
      notes: [],
      customFields: createdCustomFields,
    };

    res.status(201).json(responseObject);
  } catch (error) {
    await createLog({
      action: "CREATE_CAMPUS_FAILED",
      username,
      performedBy: req.userRole,
      details: `Failed to create campus '${campusName}'`,
    });
    res.status(500).json({ message: "Error creating campus." });
  }
};

const createNote = async (req, res) => {
  const { campusId } = req.params;
  const { content } = req.body;
  const username = await getUserName(req.userId);

  try {
    const newNote = await Note.create({
      id: uuidv4(),
      content,
      campusId,
    });

    await createLog({
      action: "CREATE_NOTE",
      username,
      performedBy: req.userRole,
      details: `Created note for campus ID: ${campusId}`,
    });

    res.status(201).json(newNote);
  } catch (error) {
    await createLog({
      action: "CREATE_NOTE_FAILED",
      username,
      performedBy: req.userRole,
      details: `Failed to create note for campus ID: ${campusId}`,
    });
    res.status(500).json({ message: "Error creating note." });
  }
};

const deleteNote = async (req, res) => {
  const { noteId } = req.params;
  const username = await getUserName(req.userId);
    try {
        const note = await Note.findByPk(noteId);
        if (!note) {
            return res.status(404).json({ message: 'Note not found.' });
        }
        await note.destroy();
        await createLog({
            action: 'DELETE_NOTE',
            username,
            performedBy: req.userRole,
            details: `Deleted note ID: ${noteId}`,
        });
        res.status(200).json({ message: 'Note deleted successfully.' });
    } catch (error) {
        await createLog({
            action: 'DELETE_NOTE_FAILED',
            username,
            performedBy: req.userRole,
            details: `Failed to delete note ID: ${noteId}. Error: ${error.message}`,
        });
        res.status(500).json({ message: 'Error deleting note.' });
    }
}

const updateCampus = async (req, res) => {
  const { campusId } = req.params;
  const {
    campusName,
    address,
    city,
    state,
    zipCode,
    campusMainNumber,
    presidentEmail,
    undergradStudents,
    gradStudents,
    presidentName,
    schoolType,
    customFields = [],
  } = req.body;

  const username = await getUserName(req.userId);

  try {
    const campus = await Campus.findByPk(campusId);
    if (!campus) {
      return res.status(404).json({ message: "Campus not found." });
    }

    // Update campus in one go
    await campus.update({
      campusName: campusName ?? campus.campusName,
      address: address ?? campus.address,
      city: city ?? campus.city,
      state: state ?? campus.state,
      zipCode: zipCode ?? campus.zipCode,
      campusMainNumber: campusMainNumber ?? campus.campusMainNumber,
      presidentEmail: presidentEmail ?? campus.presidentEmail,
      undergradStudents:
        undergradStudents !== undefined
          ? undergradStudents
          : campus.undergradStudents,
      gradStudents:
        gradStudents !== undefined ? gradStudents : campus.gradStudents,
      presidentName: presidentName ?? campus.presidentName,
      schoolType: schoolType ?? campus.schoolType,
    });

    // Faster handling of customFields
    if (customFields.length) {
      // Separate updates vs new inserts
      const fieldsToUpdate = customFields.filter(f => f.id);
      const fieldsToCreate = customFields.filter(f => !f.id);

      // Bulk update existing fields
      if (fieldsToUpdate.length) {
        const existingFields = await CustomField.findAll({
          where: { id: fieldsToUpdate.map(f => f.id) },
        });

        await Promise.all(
          existingFields.map(existingField => {
            const updatedData = fieldsToUpdate.find(f => f.id === existingField.id);
            return existingField.update(updatedData);
          })
        );
      }

      // Bulk create new fields
      if (fieldsToCreate.length) {
        const newFields = fieldsToCreate.map(f => ({
          label: f.label,
          value: f.value,
          type: f.type,
          campusId,
        }));
        await CustomField.bulkCreate(newFields);
      }
    }

    await createLog({
      action: "UPDATE_CAMPUS",
      username,
      performedBy: req.userRole,
      details: `Updated campus ID: ${campusId}`,
    });

    // Return campus with updated customFields in one object
    const updatedCampus = {
      ...campus.toJSON(),
      customFields: await CustomField.findAll({ where: { campusId } }),
    };

    res.status(200).json(updatedCampus);
  } catch (error) {
    await createLog({
      action: "UPDATE_CAMPUS_FAILED",
      username,
      performedBy: req.userRole,
      details: `Failed to update campus ID: ${campusId}. Error: ${error.message}`,
    });
    res.status(500).json({ message: "Error updating campus." });
  }
};


const deleteCampus = async (req, res) => {
    const { campusId } = req.query;
    const username = await getUserName(req.userId);
    try {
        const campus = await Campus.findByPk(campusId);
        if (!campus) {
            return res.status(404).json({ message: 'Campus not found.' });
        }
        await campus.destroy();
        await createLog({
            action: 'DELETE_CAMPUS',
            username,
            performedBy: req.userRole,
            details: `Deleted campus ID: ${campusId}`,
        });
        res.status(200).json({ message: 'Campus deleted successfully.' });
    } catch (error) {
        await createLog({
            action: 'DELETE_CAMPUS_FAILED',
            username,
            performedBy: req.userRole,
            details: `Failed to delete campus ID: ${campusId}. Error: ${error.message}`,
        });
        res.status(500).json({ message: 'Error deleting campus.' });
    }
}

const getCampus = async (req, res) => {
    const { campusId } = req.params;
    try {
        const campus = await Campus.findByPk(campusId, {
            include: [
                { model: Note, as: "notes" },
                { model: CustomField, as: "customFields" },
            ],
        });
        if (!campus) {
            return res.status(404).json({ message: 'Campus not found.' });
        }
        res.status(200).json(campus);
    } catch (error) {
        await createLog({
            action: 'GET_CAMPUS_FAILED',
            username: await getUserName(req.userId),
            performedBy: req.userRole,
            details: `Failed to retrieve campus ID: ${campusId}. Error: ${error.message}`,
        });
        res.status(500).json({ message: 'Error retrieving campus.' });
    }
}

const getAllCampuses = async (req, res) => {
    try {
        const campuses = await Campus.findAll({
            include: [
                { model: Note, as: "notes" },
                { model: CustomField, as: "customFields" },
            ],
        });
        res.status(200).json(campuses);
    } catch (error) {        
        await createLog({
            action: 'GET_ALL_CAMPUSES_FAILED',
            username: await getUserName(req.userId),
            performedBy: req.userRole,
            details: `Failed to retrieve all campuses. Error: ${error.message}`,
        });
        res.status(500).json({ message: 'Error retrieving campuses.' });
    }
}

module.exports = {
    createCampus,
    updateCampus,
    deleteCampus,
    getCampus,
    getAllCampuses,
    createNote,
    deleteNote,
};