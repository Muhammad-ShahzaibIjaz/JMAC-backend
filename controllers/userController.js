const { v4: uuidv4 } = require("uuid");
const { User } = require("../models");
const jwt = require("jsonwebtoken");
const { SECRET_KEY } = require("../config/env");
const bcrypt = require("bcrypt");


const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
};

const generateToken = async (userId) => {
    return jwt.sign({id: userId}, SECRET_KEY, {expiresIn: "5h"});
};


const createUser = async (req, res) => {
    const transaction = await sequelize.transaction();
    const { username, password, role} = req.body;
    try {
        if (!username || !password || !role) {
            await transaction.rollback();
            return res.status(400).json({ message: "Username, password, and role are required." });
        }
        const existingUser = await User.findOne({ where: { username, role } });
        if (existingUser) {
            await transaction.rollback();
            return res.status(409).json({ message: "User with this username already exists." });
        }
        const passwordHash = await hashPassword(password);
        const newUser = await User.create({
            id: uuidv4(),
            username,
            passwordHash,
            role,
        }, { transaction });
        const token = await generateToken(newUser.id);
        await transaction.commit();
        res.status(201).json({ userId: newUser.id, id: token, username: newUser.username, role: newUser.role });
    } catch (error) {
        await transaction.rollback();
        console.error("Error creating user:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

const login = async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ where: { username } });
        if (!user) {
            return res.status(401).json({ message: "Invalid username or password" });
        }
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) {
            return res.status(401).json({ message: "Invalid password" });
        }
        const token = await generateToken(user.id);
        res.status(200).json({ id: token, username: user.username, role: user.role });
    } catch (error) {
        console.error("Error during login:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

module.exports = {
    createUser,
    login,
};