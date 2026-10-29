const ClientOffModel    = require('../model/client-off.model');
const UserModel         = require('../model/user.model');
const NotificationModel = require('../model/notification.model');
const { sendClientOffStatusEmail, sendClientOffRequestAdminEmail } = require('../services/email.service');

async function submitClientOff(req, res) {
    try {
        const userId = req.user.userId;
        const { date, reason } = req.body;

        if (!date)           return res.status(400).json({ message: 'Date is required' });
        if (!reason?.trim()) return res.status(400).json({ message: 'Reason is required' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
        }

        const [year, month, day] = date.split('-').map(Number);
        const parsed = new Date(year, month - 1, day);
        if (
            parsed.getFullYear() !== year ||
            parsed.getMonth() + 1 !== month ||
            parsed.getDate() !== day
        ) {
            return res.status(400).json({ message: 'Invalid date' });
        }

        const user = await UserModel.findById(userId).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const dupPending = await ClientOffModel.findOne({ userId, date, status: 'Pending' });
        if (dupPending) {
            return res.status(409).json({ message: 'A pending Client Off request already exists for this date' });
        }

        const dupApproved = await ClientOffModel.findOne({ userId, date, status: 'Approved' });
        if (dupApproved) {
            return res.status(409).json({ message: 'An approved Client Off already exists for this date' });
        }

        const record = await ClientOffModel.create({
            userId,
            employeeName : user.userName,
            employeeEmail: user.email,
            department   : user.department || 'N/A',
            date,
            reason       : reason.trim(),
        });

        UserModel.find({ role: 'admin' }).select('email userName')
            .then(admins => {
                if (!admins.length) {
                    console.warn('[Email] No admins found for client off request notification');
                    return;
                }
                return Promise.all(
                    admins.map(admin =>
                        sendClientOffRequestAdminEmail({
                            to           : admin.email,
                            adminName    : admin.userName,
                            employeeName : user.userName,
                            employeeEmail: user.email,
                            department   : user.department || 'N/A',
                            date,
                            reason       : reason.trim(),
                            adminId      : admin._id.toString(),
                            requestId    : record._id.toString(),
                        }).catch(err => console.error('[Email] Client Off admin notify failed:', err.message))
                    )
                );
            })
            .catch(err => console.error('[Email] Admin fetch for client off request notify failed:', err.message));

        return res.status(201).json({
            message  : 'Client Off request submitted successfully',
            clientOff: record,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function getMyClientOffs(req, res) {
    try {
        const userId = req.user.userId;
        const records = await ClientOffModel.find({ userId }).sort({ createdAt: -1 });
        return res.status(200).json({ clientOffs: records });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function getAllClientOffs(req, res) {
    try {
        const records = await ClientOffModel.find().sort({ createdAt: -1 });
        return res.status(200).json({ clientOffs: records });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function reviewClientOff(req, res) {
    try {
        const { id }     = req.params;
        const { status } = req.body;

        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ message: 'Status must be Approved or Rejected' });
        }

        const record = await ClientOffModel.findById(id);
        if (!record) return res.status(404).json({ message: 'Client Off request not found' });
        if (record.status === 'Expired') {
            return res.status(410).json({ message: 'This request has expired and can no longer be reviewed' });
        }
        if (record.status !== 'Pending') {
            return res.status(409).json({ message: 'This request has already been reviewed' });
        }

        const admin   = await UserModel.findById(req.user.userId).select('userName');
        const updated = await ClientOffModel.findOneAndUpdate(
            { _id: id, status: 'Pending' },
            { status, reviewedBy: admin?.userName || 'Admin', reviewedAt: new Date() },
            { new: true }
        );
        if (!updated) {
            const current = await ClientOffModel.findById(id);
            if (current?.status === 'Expired') {
                return res.status(410).json({ message: 'This request has expired and can no longer be reviewed' });
            }
            return res.status(409).json({ message: 'This request was just actioned by another session. Please refresh.' });
        }

        sendClientOffStatusEmail({
            to          : record.employeeEmail,
            employeeName: record.employeeName,
            date        : record.date,
            reason      : record.reason,
            status,
        }).catch(err => console.error('[ClientOff] Email failed:', err.message));

        NotificationModel.create({
            userId     : record.userId,
            clientOffId: record._id,
            type       : status === 'Approved' ? 'client_off_approved' : 'client_off_rejected',
            title      : `Client Off Request ${status}`,
            message    : `Your Client Off request for ${record.date} has been ${status.toLowerCase()}.`,
        }).catch(err => console.error('[ClientOff] Notification create failed:', err.message));

        return res.status(200).json({
            message  : `Client Off ${status.toLowerCase()} successfully`,
            clientOff: updated,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports = { submitClientOff, getMyClientOffs, getAllClientOffs, reviewClientOff };
