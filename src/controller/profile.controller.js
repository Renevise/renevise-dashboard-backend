const userModel = require('../model/user.model')
const bcrypt = require('bcrypt')
const path = require('path')
const fs = require('fs')

const ALLOWED_UPDATE_FIELDS = ['firstName', 'lastName', 'phone', 'city', 'designation']
const VALID_DEPARTMENTS = ['ServiceNow', 'Web Development', 'App Development', 'AI Content Creation']

async function getProfile(req, res) {
    try {
        const user = await userModel
            .findById(req.user.userId)
            .select('-password -resetOtp -resetOtpExpiry')

        if (!user) return res.status(404).json({ message: 'User not found' })

        res.status(200).json({ message: 'Profile fetched successfully', user })
    } catch {
        res.status(500).json({ message: 'Internal server error' })
    }
}

async function updateProfile(req, res) {
    try {
        const updates = {}

        for (const field of ALLOWED_UPDATE_FIELDS) {
            if (req.body[field] !== undefined) {
                const val = req.body[field]
                updates[field] = typeof val === 'string' ? val.trim() || null : val
            }
        }

        if ('department' in req.body) {
            const dept = req.body.department
            if (!dept || dept === '') {
                updates.department = null
            } else if (VALID_DEPARTMENTS.includes(dept)) {
                updates.department = dept
            } else {
                return res.status(400).json({ message: 'Invalid department' })
            }
        }

        const user = await userModel
            .findByIdAndUpdate(req.user.userId, updates, { new: true })
            .select('-password -resetOtp -resetOtpExpiry')

        if (!user) return res.status(404).json({ message: 'User not found' })

        res.status(200).json({ message: 'Profile updated successfully', user })
    } catch {
        res.status(500).json({ message: 'Internal server error' })
    }
}

async function changePassword(req, res) {
    try {
        const { oldPassword, newPassword, confirmNewPassword } = req.body

        if (!oldPassword || !newPassword || !confirmNewPassword) {
            return res.status(400).json({ message: 'All password fields are required' })
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ message: 'New password must be at least 8 characters' })
        }

        if (newPassword !== confirmNewPassword) {
            return res.status(400).json({ message: 'New password and confirm password do not match' })
        }

        const user = await userModel.findById(req.user.userId)
        if (!user) return res.status(404).json({ message: 'User not found' })

        const passwordMatch = await bcrypt.compare(oldPassword, user.password)
        if (!passwordMatch) {
            return res.status(400).json({ message: 'Old password is incorrect' })
        }

        const hashed = await bcrypt.hash(newPassword, 10)
        await userModel.findByIdAndUpdate(req.user.userId, { password: hashed })

        res.status(200).json({ message: 'Password changed successfully' })
    } catch {
        res.status(500).json({ message: 'Internal server error' })
    }
}

async function uploadPicture(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No image file provided' })
        }

        const user = await userModel.findById(req.user.userId)
        if (!user) return res.status(404).json({ message: 'User not found' })

        if (user.profilePicture) {
            const oldFilename = path.basename(user.profilePicture)
            const oldFilePath = path.join(__dirname, '../../uploads/profile', oldFilename)
            if (fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath)
            }
        }

        const relativePath = `/uploads/profile/${req.file.filename}`

        const updated = await userModel
            .findByIdAndUpdate(req.user.userId, { profilePicture: relativePath }, { new: true })
            .select('-password -resetOtp -resetOtpExpiry')

        res.status(200).json({ message: 'Profile picture updated successfully', user: updated })
    } catch {
        res.status(500).json({ message: 'Internal server error' })
    }
}

module.exports = { getProfile, updateProfile, changePassword, uploadPicture }
