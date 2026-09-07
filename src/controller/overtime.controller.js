const OvertimeModel     = require('../model/overtime.model');
const UserModel         = require('../model/user.model');
const NotificationModel = require('../model/notification.model');
const { sendOvertimeStatusEmail, sendOvertimeRequestAdminEmail } = require('../services/email.service');
const { syncEmployeeToSnow, syncOvertimeToSnow } = require('../services/servicenow.service');

async function submitOvertime(req, res) {
    try {
        const userId = req.user.userId;
        const { onBehalf = '', requestedForId, date, extraHours, reason } = req.body;

        if (!date || !reason?.trim()) {
            return res.status(400).json({ message: 'All required fields must be filled' });
        }
        const hours = Number(extraHours);
        if (isNaN(hours) || hours < 0.5) {
            return res.status(400).json({ message: 'Extra hours must be at least 0.5' });
        }

        const submitter = await UserModel.findById(userId).select('-password');
        if (!submitter) return res.status(404).json({ message: 'User not found' });

        let targetUser;
        let resolvedRequestedForId;

        if (onBehalf === 'Yes') {
            if (!requestedForId) {
                return res.status(400).json({ message: 'Please select the employee this request is for' });
            }
            targetUser = await UserModel.findById(requestedForId).select('-password');
            if (!targetUser) {
                return res.status(404).json({ message: 'Selected user does not exist' });
            }
            resolvedRequestedForId = targetUser._id;
        } else {
            targetUser             = submitter;
            resolvedRequestedForId = submitter._id;
        }

        const existing = await OvertimeModel.findOne({ userId, date, status: 'Pending' });
        if (existing) {
            return res.status(409).json({
                message: 'A pending overtime request already exists for this date',
            });
        }

        const overtime = await OvertimeModel.create({
            userId,
            employee       : submitter.userName,
            email          : submitter.email,
            onBehalf       : onBehalf.trim(),
            requestedFor   : targetUser.userName,
            requestedForId : resolvedRequestedForId,
            date,
            extraHours     : hours,
            reason         : reason.trim(),
        });

        UserModel.find({ role: 'admin' }).select('email userName')
            .then(admins => {
                if (!admins.length) {
                    console.warn('[Email] No admins found for overtime request notification');
                    return;
                }
                return Promise.all(
                    admins.map(admin =>
                        sendOvertimeRequestAdminEmail({
                            to           : admin.email,
                            adminName    : admin.userName,
                            employeeName : submitter.userName,
                            employeeEmail: submitter.email,
                            date,
                            extraHours   : hours,
                            reason       : reason.trim(),
                            onBehalf     : onBehalf.trim(),
                            requestedFor : targetUser.userName,
                            adminId      : admin._id.toString(),
                            requestId    : overtime._id.toString(),
                        }).catch(err => console.error(`[Email] Overtime admin notify failed for ${admin.email}:`, err.message))
                    )
                );
            })
            .catch(err => console.error('[Email] Admin fetch for overtime request notify failed:', err.message));

        const _overtimeId  = overtime._id;
        const _overtimeDoc = overtime;
        syncEmployeeToSnow({
            firstName:  submitter.firstName  ?? null,
            lastName:   submitter.lastName   ?? null,
            userName:   submitter.userName,
            email:      submitter.email,
            department: submitter.department ?? null,
            role:       submitter.role       ?? 'employee',
        })
            .catch(err => {
                console.warn(`[OvertimeSync] Stage1 employee auto-register failed (non-blocking): ${err.message}`);
            })
            .then(() => {
                console.log(`[OvertimeSync] Stage2 — calling syncOvertimeToSnow for overtime ${_overtimeId}`);
                return syncOvertimeToSnow({ overtime: _overtimeDoc, snowOvertimeId: null });
            })
            .then(sysId => {
                console.log(`[OvertimeSync] Stage2 result — sys_id: ${sysId ?? 'null (sync failed or employee not in SN)'}`);
                if (sysId) {
                    console.log(`[OvertimeSync] Stage3 — updating MongoDB snowOvertimeId for overtime ${_overtimeId}`);
                    return OvertimeModel.findByIdAndUpdate(_overtimeId, { snowOvertimeId: sysId })
                        .then(() => console.log(`[OvertimeSync] Stage3 ✓ snowOvertimeId saved: ${sysId}`))
                        .catch(err => console.error(`[OvertimeSync] Stage3 ✗ MongoDB update failed: ${err.message}`));
                }
                console.warn(`[OvertimeSync] Stage3 skipped — no sys_id returned; snowOvertimeId remains null`);
            })
            .catch(err => console.error(`[OvertimeSync] Overtime create sync pipeline failed: ${err.message}`));

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
        if (overtime.status === 'Expired') {
            return res.status(410).json({ message: 'This request has expired and can no longer be reviewed' });
        }
        if (overtime.status !== 'Pending') {
            return res.status(409).json({ message: 'This request has already been reviewed' });
        }

        const admin   = await UserModel.findById(req.user.userId).select('userName');
        const updated = await OvertimeModel.findOneAndUpdate(
            { _id: id, status: 'Pending' },
            { status, reviewedBy: admin?.userName || 'Admin', reviewedAt: new Date() },
            { new: true }
        );
        if (!updated) {
            const current = await OvertimeModel.findById(id);
            if (current?.status === 'Expired') {
                return res.status(410).json({ message: 'This request has expired and can no longer be reviewed' });
            }
            return res.status(409).json({ message: 'This request was just actioned by another session. Please refresh.' });
        }

        const _existingSnowId = updated.snowOvertimeId ?? null;
        const _updatedDoc     = updated;
        console.log(`[OvertimeSync] reviewOvertime — calling syncOvertimeToSnow for overtime ${updated._id} snowOvertimeId=${_existingSnowId ?? 'none'}`);
        syncOvertimeToSnow({ overtime: _updatedDoc, snowOvertimeId: _existingSnowId })
            .then(sysId => {
                console.log(`[OvertimeSync] reviewOvertime sync result — sys_id: ${sysId ?? 'null'}`);
                if (sysId && !_existingSnowId) {
                    return OvertimeModel.findByIdAndUpdate(_updatedDoc._id, { snowOvertimeId: sysId })
                        .then(() => console.log(`[OvertimeSync] ✓ snowOvertimeId saved after review: ${sysId}`))
                        .catch(err => console.error(`[OvertimeSync] ✗ MongoDB snowOvertimeId update failed after review: ${err.message}`));
                }
            })
            .catch(err => console.error(`[OvertimeSync] Overtime review sync failed: ${err.message}`));

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
