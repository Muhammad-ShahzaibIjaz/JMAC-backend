const { Campus } = require('../models');
const { v4: uuidv4 } = require('uuid');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');


const createCampus = async (req, res) => {
    const { campusName, address="", city="", state="", zipCode="", phoneNumber="", email="", numberOfStudents=50, principalName="", schoolType } = req.body;
    const username = await getUserName(req.userId);
    try {
        if (!campusName) {
            return res.status(400).json({ message: 'campusName is required.' });
        }
        const newCampus = await Campus.create({
            id: uuidv4(),
            campusName,
            address,
            city,
            state,
            zipCode,
            phoneNumber,
            email,
            numberOfStudents,
            principalName,
            schoolType
        });
        await createLog({
            action: 'CREATE_CAMPUS',
            username,
            performedBy: req.userRole,
            details: `Created campus '${campusName}' with ID: ${newCampus.id}`,
        });
        res.status(201).json(newCampus);
    } catch (error) {
        await createLog({
            action: 'CREATE_CAMPUS_FAILED',
            username,
            performedBy: req.userRole,
            details: `Failed to create campus '${campusName}'`,
        });
        res.status(500).json({ message: 'Error creating campus.' });
    }
};


const updateCampus = async (req, res) => {
    const { campusId } = req.params;
    const { campusName, address, city, state, zipCode, phoneNumber, email, numberOfStudents, principalName, schoolType } = req.body;
    const username = await getUserName(req.userId);
    try {
        const campus = await Campus.findByPk(campusId);
        if (!campus) {
            return res.status(404).json({ message: 'Campus not found.' });
        }
        campus.campusName = campusName || campus.campusName;
        campus.address = address || campus.address;
        campus.city = city || campus.city;
        campus.state = state || campus.state;
        campus.zipCode = zipCode || campus.zipCode;
        campus.phoneNumber = phoneNumber || campus.phoneNumber;
        campus.email = email || campus.email;
        campus.numberOfStudents = numberOfStudents || campus.numberOfStudents;
        campus.principalName = principalName || campus.principalName;
        campus.schoolType = schoolType || campus.schoolType;
        await campus.save();
        await createLog({
            action: 'UPDATE_CAMPUS',
            username,
            performedBy: req.userRole,
            details: `Updated campus ID: ${campusId}`,
        });
        res.status(200).json(campus);
    } catch (error) {
        await createLog({
            action: 'UPDATE_CAMPUS_FAILED',
            username,
            performedBy: req.userRole,
            details: `Failed to update campus ID: ${campusId}. Error: ${error.message}`,
        });
        res.status(500).json({ message: 'Error updating campus.' });
    }
}

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
        const campus = await Campus.findByPk(campusId);
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
        const campuses = await Campus.findAll();
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
    getAllCampuses
};