const CorrectionModel   = require('../model/attendance-correction.model');
const UserModel         = require('../model/user.model');
const NotificationModel = require('../model/notification.model');
const { sendCorrectionStatusEmail, sendCorrectionRequestAdminEmail } = require('../services/email.service');

async function submitCorrection(req, res) {
    try {
        const userId = req.user.userId;
        const { date, clockIn, clockOut, reason } = req.body;

        if (!date || !clockIn || !clockOut || !reason?.trim()) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        if (clockIn === clockOut) {
            return res.status(400).json({ message: 'Clock out time cannot be the same as clock in time' });
        }

        const user = await UserModel.findById(userId).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const existing = await CorrectionModel.findOne({ userId, date, status: 'Pending' });
        if (existing) {
            return res.status(409).json({
                message: 'A pending correction request already exists for this date',
            });
        }

        const correction = await CorrectionModel.create({
            userId,
            employee: user.userName,
            email   : user.email,
            date,
            clockIn,
            clockOut,
            reason  : reason.trim(),
        });

        UserModel.find({ role: 'admin' }).select('email userName')
            .then(admins => {
                if (!admins.length) {
                    console.warn('[Email] No admins found for correction request notification');
                    return;
                }
                admins.forEach(admin => {
                    NotificationModel.create({
                        userId      : admin._id,
                        correctionId: correction._id,
                        type        : 'correction_submitted',
                        title       : 'New Correction Request',
                        message     : `${user.userName} submitted an attendance correction for ${date} (${clockIn} – ${clockOut}).`,
                    }).catch(err => console.error('[Notification] Admin correction notify failed:', err.message));
                });
                return Promise.all(
                    admins.map(admin =>
                        sendCorrectionRequestAdminEmail({
                            to           : admin.email,
                            adminName    : admin.userName,
                            employeeName : user.userName,
                            employeeEmail: user.email,
                            date,
                            clockIn,
                            clockOut,
                            reason       : reason.trim(),
                            adminId      : admin._id.toString(),
                            requestId    : correction._id.toString(),
                        }).catch(err => console.error(`[Email] Correction admin notify failed for ${admin.email}:`, err.message))
                    )
                );
            })
            .catch(err => console.error('[Email] Admin fetch for correction request notify failed:', err.message));

        return res.status(201).json({
            message   : 'Correction request submitted successfully',
            correction,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function getMyCorrections(req, res) {
    try {
        const userId     = req.user.userId;
        const corrections = await CorrectionModel.find({ userId }).sort({ createdAt: -1 });
        return res.status(200).json({ corrections });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function getAllCorrections(req, res) {
    try {
        const corrections = await CorrectionModel.find().sort({ createdAt: -1 });
        return res.status(200).json({ corrections });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function reviewCorrection(req, res) {
    try {
        const { id }     = req.params;
        const { status } = req.body;

        if (!['Approved', 'Rejected'].includes(status)) {
            return res.status(400).json({ message: 'Status must be Approved or Rejected' });
        }

        const correction = await CorrectionModel.findById(id);
        if (!correction) {
            return res.status(404).json({ message: 'Correction request not found' });
        }
        if (correction.status === 'Expired') {
            return res.status(410).json({ message: 'This request has expired and can no longer be reviewed' });
        }
        if (correction.status !== 'Pending') {
            return res.status(409).json({ message: 'This request has already been reviewed' });
        }

        const admin   = await UserModel.findById(req.user.userId).select('userName');
        const updated = await CorrectionModel.findOneAndUpdate(
            { _id: id, status: 'Pending' },
            { status, reviewedBy: admin?.userName || 'Admin', reviewedAt: new Date() },
            { new: true }
        );
        if (!updated) {
            const current = await CorrectionModel.findById(id);
            if (current?.status === 'Expired') {
                return res.status(410).json({ message: 'This request has expired and can no longer be reviewed' });
            }
            return res.status(409).json({ message: 'This request was just actioned by another session. Please refresh.' });
        }

        NotificationModel.create({
            userId      : correction.userId,
            correctionId: correction._id,
            type        : status === 'Approved' ? 'correction_approved' : 'correction_rejected',
            title       : `Attendance Correction ${status}`,
            message     : `Your attendance correction for ${correction.date} (${correction.clockIn} – ${correction.clockOut}) has been ${status.toLowerCase()}.`,
        }).catch(err => console.error('Notification create failed:', err.message));

        sendCorrectionStatusEmail({
            to          : correction.email,
            employeeName: correction.employee,
            date        : correction.date,
            clockIn     : correction.clockIn,
            clockOut    : correction.clockOut,
            reason      : correction.reason,
            status,
        }).catch(err => console.error('[Email] Correction status email failed:', err.message));

        return res.status(200).json({
            message   : `Correction ${status.toLowerCase()} successfully`,
            correction: updated,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

module.exports = { submitCorrection, getMyCorrections, getAllCorrections, reviewCorrection };
