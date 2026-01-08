const { v4: uuidv4 } = require("uuid");
const { User, Template, TemplatePermission } = require("../models");
const jwt = require("jsonwebtoken");
const { SECRET_KEY, ENVIRONMENT } = require("../config/env");
const bcrypt = require("bcrypt");
const sequelize = require("../config/database");
const { Op } = require("sequelize");
const { createLog } = require("../utils/auditLogger");


const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
};

const generateToken = async (userId, userRole) => {
    return jwt.sign({id: userId, role: userRole}, SECRET_KEY, {expiresIn: "5h"});
};

const getUserName = async (userId) => {
    const user =  await User.findByPk(userId);
    return user ? user.username : "Unknown User";
}


const createUser = async (req, res) => {
    const transaction = await sequelize.transaction();
    const { username, password, role, permissions, hasDecisionTreeAccess=true } = req.body;
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
            username: username.includes("@smartaid") ? username : `${username}@smartaid`,
            passwordHash,
            role,
            hasDecisionTreeAccess
        }, { transaction });

        if (Array.isArray(permissions) && permissions.length > 0) {
            const permissionRecords = permissions.map(perm => ({
                templateId: perm.templateId,
                userId: newUser.id,
                accessLevel: perm.accessLevel || 'read',
            }));
            await TemplatePermission.bulkCreate(permissionRecords, { transaction });
        }
        await transaction.commit();
        await createLog({ action: "USER_CREATED", username: newUser.username, performedBy: req.userRole, details: `User ${newUser.username} was created.` });
        res.status(201).json({ userId: newUser.id.toString() });
    } catch (error) {
        await createLog({ action: "USER_CREATION_FAILED", username: username || "Unknown", performedBy: req.userRole || "Unknown", details: `Failed to create user. Error: ${error.message}` });
        await transaction.rollback();
        console.error("Error creating user:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

const updateUser = async (req, res) => {
    const transaction = await sequelize.transaction();
    const { id, username, role, isActive, permissions, hasDecisionTreeAccess } = req.body;
    try {
        if (!id || !username || !role) {
            await transaction.rollback();
            return res.status(400).json({ message: "User ID, username, and role are required." });
        }
        const user = await User.findByPk(id);
        if (!user) {
            await transaction.rollback();
            return res.status(404).json({ message: "User not found." });
        }
        user.username = username.includes("@smartaid") ? username : `${username}@smartaid`;
        user.role = role;
        user.isActive = isActive;
        user.hasDecisionTreeAccess = hasDecisionTreeAccess;
        await user.save({ transaction });
        if (Array.isArray(permissions)) {
            await TemplatePermission.destroy({ where: { userId: id }, transaction });
            const permissionRecords = permissions.map(perm => ({
                templateId: perm.templateId,
                userId: id,
                accessLevel: perm.accessLevel || 'read',
            }));
            await TemplatePermission.bulkCreate(permissionRecords, { transaction });
        }
        await transaction.commit();
        await createLog({ action: "USER_UPDATED", username: user.username, performedBy: req.userRole, details: `User ${user.username} was updated.` });
        res.status(200).json({ message: "User updated successfully." });
    } catch (error) {
        await createLog({ action: "USER_UPDATE_FAILED", username: "Unknown", performedBy: req.userRole || "Unknown", details: `Failed to update userId: ${req.body.id}. Error: ${error.message}` });
        await transaction.rollback();
        console.error("Error updating user:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}


const updatePassword = async (req, res) => {
    const { userRole } = req;
    const { userId, newPassword } = req.body;
    try {
        if (!userId || !newPassword) {
            return res.status(400).json({ message: "User ID and new password are required." });
        }
        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }
        const passwordHash = await hashPassword(newPassword);
        user.passwordHash = passwordHash;
        await user.save();
        await createLog({ action: "PASSWORD_UPDATED", username: user.username, performedBy: userRole, details: `Password for user ${user.username} was updated.` });
        res.status(200).json({ message: "Password updated successfully." });
    } catch (error) {
        await createLog({ action: "PASSWORD_UPDATE_FAILED", username: "Unknown", performedBy: userRole || "Unknown", details: `Failed to update password for userId: ${userId}. Error: ${error.message}` });
        console.error("Error updating password:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

const deleteUser = async (req, res) => {
    const { userRole } = req;
    const { id } = req.query;
    try {
        if (!id) {
            return res.status(400).json({ message: "User ID is required." });
        }
        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }
        await user.destroy();
        await createLog({ action: "USER_DELETED", username: user.username, performedBy: userRole, details: `User ${user.username} was deleted.` });
        res.status(200).json({ message: "User deleted successfully." });
    } catch (error) {
        console.error("Error deleting user:", error);
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
        if (!user.isActive) {
            return res.status(403).json({ message: "User account is inactive" });
        }
        const token = await generateToken(user.id, user.role);
        await createLog({ action: "USER_LOGIN", username: user.username, performedBy: user.role, details: `User ${user.username} logged in.` });
        res.cookie("token", token, {
            httpOnly: true,
            secure: ENVIRONMENT === "prod" ? true : false,
            sameSite: ENVIRONMENT === "prod" ? "none" : "lax",
            maxAge: 60 * 60 * 5000
        });
        res.status(200).json({ id: user.id, username: user.username, role: user.role });
    } catch (error) {
        await createLog({ action: "USER_LOGIN_FAILED", username: username || "Unknown", performedBy: "Unknown", details: `Failed login attempt for username: ${username}. Error: ${error.message}` });
        console.error("Error during login:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

const logout = async (req, res) => {
    res.clearCookie("token", {
        httpOnly: true,
        secure: ENVIRONMENT === "prod" ? true : false,
        sameSite: ENVIRONMENT === "prod" ? "none" : "lax",
    });
    res.status(200).json({ message: "Logged out successfully" });
}


const getMyInfo = async (req, res) => {
    const userId  = req.userId;
    try {
        const user = await User.findByPk(userId, {
            attributes: ['id', 'username', 'role'],
        });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        await createLog({ action: "USER_INFO_RETRIEVED", username: user.username, performedBy: user.role, details: `User ${user.username} retrieved their info.` });
        res.status(200).json(user);
    } catch (error) {
        await createLog({ action: "USER_INFO_RETRIEVAL_FAILED", username: "Unknown", performedBy: "Unknown", details: `Failed to retrieve user info for userId: ${userId}. Error: ${error.message}` });
        console.error("Error fetching user info:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

const getUsersInfo = async (req, res) => {
    try {
        const requestingUserId = req.userId;
        const users = await User.findAll({
            where: { id: { [Op.ne]: requestingUserId } },
            include: [
                {
                    model: TemplatePermission,
                    as: 'templatePermissions',
                    include: [
                        {
                            model: Template,
                            attributes: ['id', 'name'],
                        }
                    ],
                },
            ],
        });
        const systemUsers = users.map((user) => ({
            id: user.id,
            username: user.username,
            role: user.role,
            createdAt: user.createdAt,
            isActive: user.isActive,
            permissions: user.templatePermissions.map((perm) => ({
                templateId: perm.templateId,
                templateName: perm.Template?.name || '',
                permission: perm.accessLevel ?? 'none',
            })),
            hasDecisionTreeAccess: user.hasDecisionTreeAccess,
        }));
        res.status(200).json(systemUsers);
    } catch (error) {
        console.error("Error fetching users info:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

const getDecisionTreeAccess = async (req, res) => {
    try {
        const { userId } = req;
        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        res.status(200).json({ hasDecisionTreeAccess: user.hasDecisionTreeAccess });
    } catch (error) {
        console.error("Error fetching decision tree access:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

module.exports = {
    createUser,
    login,
    getMyInfo,
    getUsersInfo,
    updateUser,
    updatePassword,
    deleteUser,
    logout,
    getUserName,
    getDecisionTreeAccess
};