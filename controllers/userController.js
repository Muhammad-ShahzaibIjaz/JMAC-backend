const { v4: uuidv4 } = require("uuid");
const { User, Permission } = require("../models");
const jwt = require("jsonwebtoken");
const { SECRET_KEY, ENVIRONMENT } = require("../config/env");
const bcrypt = require("bcrypt");
const sequelize = require("../config/database");


const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
};

const generateToken = async (userId, userRole) => {
    return jwt.sign({id: userId, role: userRole}, SECRET_KEY, {expiresIn: "5h"});
};


const generateRolePermissions = async (role, userId, transaction) => {
    if (role === "Admin" || role === "Creator") {
        const permissions = ["read", "write", "delete"];
        const permissionPromises = permissions.map(action => 
            Permission.create({
                id: uuidv4(),
                action,
                userId: userId
            }, { transaction })
        );
        await Promise.all(permissionPromises);
    } else if (role === "Consultant" || role === "Campus") {
        await Permission.create({
            id: uuidv4(),
            action: "read",
            userId: userId
        }, { transaction });
    }
}


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
        await generateRolePermissions(role, newUser.id, transaction);
        const token = await generateToken(newUser.id, newUser.role);
        await transaction.commit();
        res.cookie("token", token, {
            httpOnly: true,
            secure: ENVIRONMENT === "prod" ? true : false,
            sameSite: ENVIRONMENT === "prod" ? "none" : "lax",
            maxAge: 60 * 60 * 5000
        });
        res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role });
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
        const token = await generateToken(user.id, user.role);
        res.cookie("token", token, {
            httpOnly: true,
            secure: ENVIRONMENT === "prod" ? true : false,
            sameSite: ENVIRONMENT === "prod" ? "none" : "lax",
            maxAge: 60 * 60 * 5000
        });
        res.status(200).json({ id: user.id, username: user.username, role: user.role });
    } catch (error) {
        console.error("Error during login:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};


const getMyInfo = async (req, res) => {
    const userId  = req.userId;
    try {
        const user = await User.findByPk(userId, {
            attributes: ['id', 'username', 'role'],
        });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        res.status(200).json(user);
    } catch (error) {
        console.error("Error fetching user info:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

module.exports = {
    createUser,
    login,
    getMyInfo,
};