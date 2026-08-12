const OvertimeModel     = require('../model/overtime.model');
const UserModel         = require('../model/user.model');
const NotificationModel = require('../model/notification.model');
const { sendOvertimeStatusEmail } = require('../services/email.service');

async function submitOvertime(req, res) {
    try {
        const userId = req.user.userId;
        const { onBehalf = '', requestedFor, date, extraHours, reason } = req.body;

        if (!requestedFor?.trim() || !date || !reason?.trim()) {
            return res.status(400).json({ message: 'All required fields must be filled' });
        }
        const hours = Number(extraHours);
        if (isNaN(hours) || hours < 0.5) {
            return res.status(400).json({ message: 'Extra hours must be at least 0.5' });
        }

        const user = await UserModel.findById(userId).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const existing = await OvertimeModel.findOne({ userId, date, status: 'Pending' });
        if (existing) {
            return res.status(409).json({
                message: 'A pending overtime request already exists for this date',
            });
        }

        const overtime = await OvertimeModel.create({
            userId,
            employee    : user.userName,
            email       : user.email,
            onBehalf    : onBehalf.trim(),
            requestedFor: requestedFor.trim(),
            date,
            extraHours  : hours,
            reason      : reason.trim(),
        });

        return res.status(201).json({
            message : 'Overtime request submitted successfully',
            overtime,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function getMyOvertimes(req, res) {
    try {
        const userId   = req.user.userId;
        const overtimes = await OvertimeModel.find({ userId }).sort({ createdAt: -1 });
        return res.status(200).json({ overtimes });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function getAllOvertimes(req, res) {
    try {
        const overtimes = await OvertimeModel.find().sort({ createdAt: -1 });
        return res.status(200).json({ overtimes });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function reviewOvertime(req, res) {
    try {
        const { id }     = req.params;
        const { status } = req.body;

        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ message: 'Status must be Approved or Rejected' });
        }

        const overtime = await OvertimeModel.findById(id);
        if (!overtime) {
            return res.status(404).json({ message: 'Overtime request not found' });
        }
        if (overtime.status !== 'Pending') {
            return res.status(409).json({ message: 'This request has already been reviewed' });
        }

        const admin   = await UserModel.findById(req.user.userId).select('userName');
        const updated = await OvertimeModel.findByIdAndUpdate(
            id,
            {
                status,
                reviewedBy: admin?.userName || 'Admin',
                reviewedAt: new Date(),
            },
            { new: true }
        );

        NotificationModel.create({
            userId    : overtime.userId,
            overtimeId: overtime._id,
            type      : status === 'Approved' ? 'overtime_approved' : 'overtime_rejected',
            title     : `Overtime Request ${status}`,
            message   : `Your overtime request for ${overtime.date} (${overtime.extraHours}h) has been ${status.toLowerCase()}.`,
        }).catch(err => console.error('Notification create failed:', err.message));

        sendOvertimeStatusEmail({
            to          : overtime.email,
            employeeName: overtime.employee,
            date        : overtime.date,
            extraHours  : overtime.extraHours,
            reason      : overtime.reason,
            status,
        }).catch(err => console.error('[Email] Overtime status email failed:', err.message));

        return res.status(200).json({
            message : `Overtime ${status.toLowerCase()} successfully`,
            overtime: updated,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

module.exports = { submitOvertime, getMyOvertimes, getAllOvertimes, reviewOvertime };
