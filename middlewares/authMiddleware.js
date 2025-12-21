const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../config/env');
const { User } = require('../models');

const verifyToken = (req, res, next) => {
    const token = req.cookies?.token;
    if (!token) {
        return res.status(401).json({ message: 'No token provided' });
    }
    try{
        const decoded = jwt.verify(token, SECRET_KEY);
        req.userId = decoded.id;
        req.userRole = decoded.role;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired' });
        }
        return res.status(401).json({ message: 'Unauthorized' });
    }
};

const verifyAdmin = (req, res, next) => {
    try {
        const role = req.userRole;
        if (!role) {
            return res.status(401).json({ message: 'Unauthorized: No role found' });
        } else if (role !== 'Admin') {
            return res.status(403).json({ message: 'Forbidden: Access Denied' });
        }
        next();
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error: Role verification failed.' });
    }
}

const verifyUserActive = async (req, res, next) => {
    try {
        const userId = req.userId;
        const user = await User.findByPk(userId);
        if (!user) {
            res.status(404).json({ message: 'User not found' });
        } else if (!user.isActive) {
            res.status(403).json({ message: 'User account is blocked' });
        }
        next();
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error: User status verification failed.' });
    }
}


module.exports = { verifyToken, verifyAdmin, verifyUserActive };