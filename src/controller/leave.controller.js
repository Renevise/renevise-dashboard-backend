const LeaveModel         = require('../model/leave.model');
const UserModel          = require('../model/user.model');
const NotificationModel  = require('../model/notification.model');
const { sendLeaveStatusEmail } = require('../services/email.service');

const INITIAL_LEAVE_BALANCE = 12;

function calcLeaveStats(leaves, targetYear, targetMonth) {
    const pad      = n => String(n).padStart(2, '0');
    const now      = new Date();
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    let yearlyUsed  = 0;
    let monthlyUsed = 0;
    for (const l of leaves.filter(l => l.status === 'Approved')) {
        const from  = new Date(l.fromDate  + 'T00:00:00');
        const until = new Date(l.untilDate + 'T00:00:00');
        const cur   = new Date(from);
        while (cur <= until) {
            const curStr = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
            if (curStr <= todayStr) {         
                const y = cur.getFullYear();
                const m = cur.getMonth() + 1;
                if (y === targetYear) {
                    yearlyUsed++;
                    if (m === targetMonth) monthlyUsed++;
                }
            }
            cur.setDate(cur.getDate() + 1);
        }
    }
    return { yearlyUsed, monthlyUsed };
}

async function applyLeave(req, res) {
    try {
        const userId = req.user.userId;
        const { leaveType, fromDate, untilDate, reason } = req.body;

        if (!leaveType || !fromDate || !untilDate || !reason?.trim()) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        if (untilDate < fromDate) {
            return res.status(400).json({ message: 'Until date must be on or after from date' });
        }

        const user = await UserModel.findById(userId).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const duplicate = await LeaveModel.findOne({ userId, fromDate, untilDate, status: 'Pending' });
        if (duplicate) {
            return res.status(409).json({ message: 'A pending leave request already exists for these dates' });
        }

        const days = Math.round(
            (new Date(untilDate) - new Date(fromDate)) / 86400000
        ) + 1;

        const leave = await LeaveModel.create({
            userId,
            employee : user.userName,
            email    : user.email,
            leaveType,
            fromDate,
            untilDate,
            days,
            reason: reason.trim(),
        });

        return res.status(201).json({ message: 'Leave request submitted successfully', leave });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function getMyLeaves(req, res) {
    try {
        const userId = req.user.userId;
        const leaves = await LeaveModel.find({ userId }).sort({ createdAt: -1 });

        const now          = new Date();
        const currentYear  = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        const { yearlyUsed, monthlyUsed } = calcLeaveStats(leaves, currentYear, currentMonth);
        const balance = Math.max(0, INITIAL_LEAVE_BALANCE - yearlyUsed);

        return res.status(200).json({
            leaves,
            balance,
            yearlyTotal : INITIAL_LEAVE_BALANCE,
            yearlyUsed,
            monthlyUsed,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function getAllLeaves(req, res) {
    try {
        const leaves = await LeaveModel.find().sort({ createdAt: -1 });
        return res.status(200).json({ leaves });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function reviewLeave(req, res) {
    try {
        const { id }     = req.params;
        const { status } = req.body;

        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ message: 'Status must be Approved or Rejected' });
        }

        const leave = await LeaveModel.findById(id);
        if (!leave) return res.status(404).json({ message: 'Leave request not found' });
        if (leave.status !== 'Pending') {
            return res.status(409).json({ message: 'This request has already been reviewed' });
        }

        const admin   = await UserModel.findById(req.user.userId).select('userName');
        const updated = await LeaveModel.findByIdAndUpdate(
            id,
            { status, reviewedBy: admin?.userName || 'Admin', reviewedAt: new Date() },
            { new: true }
        );

        sendLeaveStatusEmail({
            to          : leave.email,
            employeeName: leave.employee,
            leaveType   : leave.leaveType,
            fromDate    : leave.fromDate,
            untilDate   : leave.untilDate,
            days        : leave.days,
            status,
        }).catch(err => console.error('Email send failed:', err.message));

        NotificationModel.create({
            userId : leave.userId,
            leaveId: leave._id,
            type   : status === 'Approved' ? 'leave_approved' : 'leave_rejected',
            title  : `Leave Request ${status}`,
            message: `Your ${leave.leaveType} leave from ${leave.fromDate} to ${leave.untilDate} (${leave.days} day${leave.days !== 1 ? 's' : ''}) has been ${status.toLowerCase()}.`,
        }).catch(err => console.error('Notification create failed:', err.message));

        return res.status(200).json({
            message: `Leave ${status.toLowerCase()} successfully`,
            leave: updated,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

module.exports = { applyLeave, getMyLeaves, getAllLeaves, reviewLeave };
