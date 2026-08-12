const userModel = require('../model/user.model')
const bcrypt = require('bcrypt')



const VALID_DEPARTMENTS = ['ServiceNow', 'Web Development', 'App Development', 'AI Content Creation'];

async function createEmployee(req, res) {
    try {
        const { userName, email, password, role, department } = req.body

        if (!userName || !email || !password || !role || !department) {
            return res.status(400).json({ message: 'All fields are required' })
        }
        if (!VALID_DEPARTMENTS.includes(department)) {
            return res.status(400).json({ message: 'Invalid department' })
        }
        const existingUser = await userModel.findOne({ email })

        if (existingUser) {
            return res.status(409).json({ message: 'Email already exists' })
        }

        const hashPassword = await bcrypt.hash(password, 10)

        const user = await userModel.create({
            userName, email, password: hashPassword, role, department
        })

        res.status(201).json({ message: "User created successfully" })
    } catch (error) {

        return res.status(500).json({ message: 'Internal server errorInternal server error', error: error.message })
    }
}
async function getAllEmployees(req, res) {
    try {
        const fetchedData = await userModel.find().select("-password");

        res.status(200).json({
            message: "Employees fetched successfully",
            employees: fetchedData,
        });
    } catch (error) {
        res.status(500).json({
            message: "Internal server error",
            error: error.message,
        });
    }
}

async function getSingleEmployee(req, res) {
    try {


        const { id } = req.params

        const getSingleUser = await userModel.findById(id).select('-password')


        if (!getSingleUser) {
            return res.status(404).json({ message: 'User not found' })
        }

        res.status(200).json({ message: 'user fetched successfully', user: getSingleUser })


    } catch (error) {

        res.status(500).json({ message: "Internal server error", error: error.message })

    }



}
async function updateEmployee(req, res) {
    try {
        const { id } = req.params;
        const { userName, email, role, department } = req.body;

        if (!userName || !email || !role) {
            return res.status(400).json({
                message: "All fields are required",
            });
        }
        if (department !== undefined && department !== null && !VALID_DEPARTMENTS.includes(department)) {
            return res.status(400).json({ message: 'Invalid department' });
        }

        const existingUser = await userModel.findById(id);

        if (!existingUser) {
            return res.status(404).json({
                message: "User not found",
            });
        }

        const emailExists = await userModel.findOne({ email });

        if (emailExists && emailExists._id.toString() !== id) {
            return res.status(409).json({
                message: "Email already exists",
            });
        }

        const updateFields = { userName, email, role };
        if (department !== undefined && department !== null) updateFields.department = department;

        const updatedUser = await userModel
            .findByIdAndUpdate(
                id,
                updateFields,
                {
                    new: true,
                }
            )
            .select("-password");

        return res.status(200).json({
            message: "User updated successfully",
            user: updatedUser,
        });
    } catch (error) {
        return res.status(500).json({
            message: "Internal server error",
            error: error.message,
        });
    }
}
async function deletedUser(req, res) {
    try {
        const { id } = req.params

        const deleteEmployee = await userModel.findByIdAndDelete(id)

        if(!deleteEmployee){
            return res.status(404).json({message:'User not found'})
        }

        res.status(200).json({message:'User deleted successfully'})

    } catch (error) {
        res.status(500).json({ message: 'Internal server error' ,error:error.message})

    }



}

module.exports = { createEmployee, getAllEmployees, getSingleEmployee, updateEmployee ,deletedUser}