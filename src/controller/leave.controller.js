const LeaveModel         = require('../model/leave.model');
const UserModel          = require('../model/user.model');
const NotificationModel  = require('../model/notification.model');
const { sendLeaveStatusEmail } = require('../services/email.service');
const { syncLeaveRequestToSnow, syncEmployeeToSnow } = require('../services/servicenow.service');

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

        const _leaveId  = leave._id;
        const _leaveDoc = leave;
        syncEmployeeToSnow({
            firstName:  user.firstName  ?? null,
            lastName:   user.lastName   ?? null,
            userName:   user.userName,
            email:      user.email,
            department: user.department ?? null,
            role:       user.role       ?? 'employee',
        })
            .catch(err => {
                console.warn(`[LeaveSync] Stage1 employee auto-register failed (non-blocking): ${err.message}`);
            })
            .then(() => {
                console.log(`[LeaveSync] Stage2 — calling syncLeaveRequestToSnow for leave ${_leaveId}`);
                return syncLeaveRequestToSnow({ leave: _leaveDoc, snowLeaveId: null });
            })
            .then(sysId => {
                console.log(`[LeaveSync] Stage2 result — sys_id: ${sysId ?? 'null (sync failed or employee not in SN)'}`);
                if (sysId) {
                    console.log(`[LeaveSync] Stage3 — updating MongoDB snowLeaveId for leave ${_leaveId}`);
                    return LeaveModel.findByIdAndUpdate(_leaveId, { snowLeaveId: sysId })
                        .then(() => console.log(`[LeaveSync] Stage3 ✓ snowLeaveId saved: ${sysId}`))
                        .catch(err => console.error(`[LeaveSync] Stage3 ✗ MongoDB update failed: ${err.message}`));
                }
                console.warn(`[LeaveSync] Stage3 skipped — no sys_id returned; snowLeaveId remains null`);
            })
            .catch(err => console.error(`[LeaveSync] Leave create sync pipeline failed: ${err.message}`));

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

        const _existingSnowId = updated.snowLeaveId ?? null;
        const _updatedDoc     = updated;
        console.log(`[LeaveSync] reviewLeave — calling syncLeaveRequestToSnow for leave ${updated._id} snowLeaveId=${_existingSnowId ?? 'none'}`);
        syncLeaveRequestToSnow({ leave: _updatedDoc, snowLeaveId: _existingSnowId })
            .then(sysId => {
                console.log(`[LeaveSync] reviewLeave sync result — sys_id: ${sysId ?? 'null'}`);
                if (sysId && !_existingSnowId) {
                    return LeaveModel.findByIdAndUpdate(_updatedDoc._id, { snowLeaveId: sysId })
                        .then(() => console.log(`[LeaveSync] ✓ snowLeaveId saved after review: ${sysId}`))
                        .catch(err => console.error(`[LeaveSync] ✗ MongoDB snowLeaveId update failed after review: ${err.message}`));
                }
            })
            .catch(err => console.error(`[LeaveSync] Leave review sync failed: ${err.message}`));

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

async function snowWebhookHandler(req, res) {
    try {
        const { snowSysId, status, approvedBy, approvedOn } = req.body;

        if (!snowSysId) return res.status(400).json({ message: 'snowSysId is required' });
        if (!status)    return res.status(400).json({ message: 'status is required' });

        const statusMap = { approved: 'Approved', rejected: 'Rejected', pending: 'Pending' };
        const mongoStatus = statusMap[status.toLowerCase()];
        if (!mongoStatus) {
            return res.status(400).json({
                message: `Unknown ServiceNow status: "${status}". Expected: approved | rejected | pending`,
            });
        }

        const leave = await LeaveModel.findOne({ snowLeaveId: snowSysId });
        if (!leave) {
            console.warn(`[SnowWebhook] No MongoDB leave found with snowLeaveId: ${snowSysId}`);
            return res.status(404).json({ message: `No leave linked to ServiceNow sys_id: ${snowSysId}` });
        }

        const sameStatus   = leave.status    === mongoStatus;
        const sameReviewer = (leave.reviewedBy ?? '') === (approvedBy ?? '');
        if (sameStatus && sameReviewer) {
            console.log(`[SnowWebhook] Idempotency skip — leave ${leave._id} already ${mongoStatus}`);
            return res.status(200).json({ message: 'No change needed', leaveId: leave._id });
        }

        const updateFields = { status: mongoStatus };

        if (approvedBy) {
            updateFields.reviewedBy = approvedBy;
        }

        if (approvedOn) {
            const parsed = new Date(approvedOn.replace(' ', 'T') + 'Z');
            if (!isNaN(parsed)) updateFields.reviewedAt = parsed;
        }

        const updated = await LeaveModel.findByIdAndUpdate(leave._id, updateFields, { new: true });

        console.log(
            `[SnowWebhook] ✓ Leave ${updated._id} updated — ` +
            `status: ${updated.status} | reviewedBy: ${updated.reviewedBy ?? 'n/a'} | reviewedAt: ${updated.reviewedAt ?? 'n/a'}`
        );

        return res.status(200).json({
            message   : 'Leave updated from ServiceNow',
            leaveId   : updated._id,
            status    : updated.status,
            reviewedBy: updated.reviewedBy,
            reviewedAt: updated.reviewedAt,
        });
    } catch (error) {
        console.error('[SnowWebhook] Error:', error.message);
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

module.exports = { applyLeave, getMyLeaves, getAllLeaves, reviewLeave, snowWebhookHandler };
