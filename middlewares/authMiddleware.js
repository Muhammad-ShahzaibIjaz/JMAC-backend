const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../config/env');

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


module.exports = { verifyToken };