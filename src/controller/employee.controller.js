const userModel = require('../model/user.model');
const bcrypt = require('bcrypt');
const { syncEmployeeToSnow } = require('../services/servicenow.service');
const { resolveUniqueUserName } = require('../utils/username');

const VALID_DEPARTMENTS = ['ServiceNow', 'Web Development', 'App Development', 'AI Content Creation'];

async function createEmployee(req, res) {
    try {
        const { firstName, lastName, email, password, role, department } = req.body;

        if (!firstName || !lastName || !email || !password || !role || !department) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        if (!VALID_DEPARTMENTS.includes(department)) {
            return res.status(400).json({ message: 'Invalid department' });
        }

        const existingUser = await userModel.findOne({ email });
        if (existingUser) {
            return res.status(409).json({ message: 'Email already exists' });
        }

        const userName     = await resolveUniqueUserName(firstName, lastName, userModel);
        const hashPassword = await bcrypt.hash(password, 10);

        const user = await userModel.create({
            firstName: firstName.trim(),
            lastName:  lastName.trim(),
            userName,
            email,
            password:  hashPassword,
            role,
            department,
        });

        syncEmployeeToSnow({ firstName: firstName.trim(), lastName: lastName.trim(), userName, email, department, role })
            .then(sysId => {
                if (sysId) return userModel.findByIdAndUpdate(user._id, { serviceNowSysId: sysId });
            })
            .catch(err => console.error('[ServiceNow] Employee sync failed:', err.message));

        res.status(201).json({ message: "User created successfully" });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function getAllEmployees(req, res) {
    try {
        const fetchedData = await userModel.find().select("-password");
        res.status(200).json({ message: "Employees fetched successfully", employees: fetchedData });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
}

async function getSingleEmployee(req, res) {
    try {
        const { id } = req.params;
        const user = await userModel.findById(id).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.status(200).json({ message: 'user fetched successfully', user });
    } catch (error) {
        res.status(500).json({ message: "Internal server error" });
    }
}

async function updateEmployee(req, res) {
    try {
        const { id } = req.params;
        const { firstName, lastName, email, role, department } = req.body;

        if (!firstName || !lastName || !email || !role) {
            return res.status(400).json({ message: "All fields are required" });
        }
        if (department !== undefined && department !== null && !VALID_DEPARTMENTS.includes(department)) {
            return res.status(400).json({ message: 'Invalid department' });
        }

        const existingUser = await userModel.findById(id);
        if (!existingUser) return res.status(404).json({ message: "User not found" });

        const emailExists = await userModel.findOne({ email });
        if (emailExists && emailExists._id.toString() !== id) {
            return res.status(409).json({ message: "Email already exists" });
        }

        const userName = await resolveUniqueUserName(firstName, lastName, userModel, id);

        const updateFields = { firstName: firstName.trim(), lastName: lastName.trim(), userName, email, role };
        if (department !== undefined && department !== null) updateFields.department = department;

        const updatedUser = await userModel
            .findByIdAndUpdate(id, updateFields, { new: true })
            .select("-password");

        return res.status(200).json({ message: "User updated successfully", user: updatedUser });
    } catch (error) {
        return res.status(500).json({ message: "Internal server error" });
    }
}

async function deletedUser(req, res) {
    try {
        const { id } = req.params;
        const deleteEmployee = await userModel.findByIdAndDelete(id);
        if (!deleteEmployee) return res.status(404).json({ message: 'User not found' });
        res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
}

async function getEmployeeNames(req, res) {
    try {
        const users = await userModel.find().select('firstName lastName userName email department role');
        res.status(200).json({
            employees: users.map(u => ({
                _id       : u._id,
                firstName : u.firstName,
                lastName  : u.lastName,
                userName  : u.userName,
                email     : u.email,
                department: u.department,
                role      : u.role,
            })),
        });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports = { createEmployee, getAllEmployees, getSingleEmployee, updateEmployee, deletedUser, getEmployeeNames };
