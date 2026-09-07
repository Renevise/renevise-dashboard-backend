'use strict';

const { verifyActionToken }   = require('../services/email-action.service');
const LeaveModel              = require('../model/leave.model');
const OvertimeModel           = require('../model/overtime.model');
const ClientOffModel          = require('../model/client-off.model');
const CorrectionModel         = require('../model/attendance-correction.model');
const UserModel               = require('../model/user.model');
const NotificationModel       = require('../model/notification.model');
const {
    sendLeaveStatusEmail,
    sendOvertimeStatusEmail,
    sendClientOffStatusEmail,
    sendCorrectionStatusEmail,
} = require('../services/email.service');
const { syncLeaveRequestToSnow, syncOvertimeToSnow } = require('../services/servicenow.service');

const REQUEST_LABELS = {
    leave     : 'Leave Request',
    overtime  : 'Overtime Request',
    clientOff : 'Client Off Request',
    correction: 'Attendance Correction',
};

// ── HTML helpers ──────────────────────────────────────────────────────────────

function buildHtml(title, headerGrad, borderColor, headerInner, bodyInner) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Renevise HRMS</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;background:#f4f6fb;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 16px}
    .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:560px;width:100%;overflow:hidden}
    .hdr{background:linear-gradient(135deg,${headerGrad});padding:24px 28px}
    .hdr h1{color:#fff;font-size:20px;font-weight:700;margin:0 0 4px}
    .hdr p{color:rgba(255,255,255,.75);font-size:13px;margin:0}
    .bdy{padding:28px 32px;border:1px solid ${borderColor};border-top:none;border-radius:0 0 12px 12px}
    table{width:100%;border-collapse:collapse;font-size:13.5px;color:#444;margin-bottom:20px}
    td{padding:7px 0;vertical-align:top}
    td:first-child{font-weight:600;color:#111;width:170px}
    .badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700}
    .pending{background:rgba(251,191,36,.15);color:#D97706}
    .approved{background:rgba(16,185,129,.12);color:#10B981}
    .rejected{background:rgba(239,68,68,.10);color:#EF4444}
    .expired{background:rgba(107,114,128,.12);color:#9CA3AF}
    .btn-wrap{margin:20px 0 12px}
    .btn{display:block;width:100%;padding:14px;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;color:#fff;text-align:center;letter-spacing:.3px}
    .approve{background:#10B981}.approve:hover{background:#059669}
    .reject{background:#EF4444}.reject:hover{background:#DC2626}
    .note{color:#888;font-size:12.5px;line-height:1.6;margin-bottom:20px}
    hr{border:none;border-top:1px solid #eef0ff;margin:20px 0}
    .footer{color:#aaa;font-size:12px}
    .msg{color:#555;font-size:14px;line-height:1.7;margin-bottom:20px}
  </style>
</head>
<body>
  <div class="card">
    <div class="hdr">${headerInner}</div>
    <div class="bdy">${bodyInner}</div>
  </div>
</body>
</html>`;
}

function errorPage(title, message) {
    return buildHtml(
        title,
        '#6B7280,#4B5563', '#e5e7eb',
        `<h1>${title}</h1><p>Renevise HRMS</p>`,
        `<p class="msg">${message}</p><hr><p class="footer">Renevise HRMS &mdash; automated notification system</p>`
    );
}

function alreadyReviewedPage(currentStatus) {
    const cls = currentStatus === 'Approved' ? 'approved' : currentStatus === 'Expired' ? 'expired' : 'rejected';
    const msg = currentStatus === 'Expired'
        ? 'This request was automatically expired because no admin decision was made before the deadline. It can no longer be approved or rejected.'
        : 'This request has already been actioned. No further action is needed.';
    return buildHtml(
        currentStatus === 'Expired' ? 'Request Expired' : 'Already Reviewed',
        '#1F3BFF,#6C4BFF', '#e0e6ff',
        `<h1>${currentStatus === 'Expired' ? 'Request Expired' : 'Request Already Reviewed'}</h1><p>Renevise HRMS</p>`,
        `<p class="msg">${msg} Current status: <span class="badge ${cls}">${currentStatus}</span></p>
         <p style="color:#888;font-size:13px;margin-top:8px;">You may close this window.</p>
         <hr><p class="footer">Renevise HRMS &mdash; automated notification system</p>`
    );
}

function confirmationPage({ token, action, requestTypeLabel, rows }) {
    const isApprove = action === 'Approved';
    const grad      = isApprove ? '#059669,#10B981' : '#DC2626,#EF4444';
    const border    = isApprove ? '#a7f3d0'         : '#fecaca';
    const btnCls    = isApprove ? 'approve'          : 'reject';
    const icon      = isApprove ? '&#10003;'         : '&#10007;';
    const label     = isApprove ? 'Approve'           : 'Reject';

    const tableRows = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

    return buildHtml(
        `Confirm ${label}`,
        grad, border,
        `<h1>Confirm ${label}: ${requestTypeLabel}</h1><p>Renevise HRMS &mdash; Admin Action</p>`,
        `<p class="msg">Please review the request details below before confirming your action.</p>
         <table>${tableRows}</table>
         <form method="POST" action="/api/email-action?token=${token}">
           <div class="btn-wrap">
             <button type="submit" class="btn ${btnCls}">${icon}&nbsp; Confirm ${label}</button>
           </div>
         </form>
         <p class="note">This will <strong>${action.toLowerCase()}</strong> the request and notify the employee via email. This action cannot be undone.</p>
         <hr><p class="footer">Renevise HRMS &mdash; automated notification system</p>`
    );
}

function successPage(action, requestTypeLabel) {
    const isApprove = action === 'Approved';
    const grad      = isApprove ? '#059669,#10B981' : '#DC2626,#EF4444';
    const border    = isApprove ? '#a7f3d0'         : '#fecaca';
    const icon      = isApprove ? '&#10003;'         : '&#10007;';

    return buildHtml(
        `${requestTypeLabel} ${action}`,
        grad, border,
        `<h1>${icon} ${requestTypeLabel} ${action}</h1><p>Renevise HRMS &mdash; Action Complete</p>`,
        `<p class="msg">The request has been <strong>${action.toLowerCase()}</strong> successfully. The employee has been notified via email.</p>
         <p style="color:#888;font-size:13px;margin-top:8px;">You may close this window.</p>
         <hr><p class="footer">Renevise HRMS &mdash; automated notification system</p>`
    );
}

// ── Request helpers ───────────────────────────────────────────────────────────

async function fetchRecord(requestType, requestId) {
    switch (requestType) {
        case 'leave':      return LeaveModel.findById(requestId);
        case 'overtime':   return OvertimeModel.findById(requestId);
        case 'clientOff':  return ClientOffModel.findById(requestId);
        case 'correction': return CorrectionModel.findById(requestId);
        default:           return null;
    }
}

function buildDisplayRows(requestType, record) {
    switch (requestType) {
        case 'leave':
            return [
                ['Employee',   record.employee],
                ['Leave Type', record.leaveType],
                ['From',       record.fromDate],
                ['Until',      record.untilDate],
                ['Total Days', `${record.days} day${record.days !== 1 ? 's' : ''}`],
                ['Reason',     record.reason],
                ['Status',     '<span class="badge pending">Pending</span>'],
            ];
        case 'overtime':
            return [
                ['Submitted By', record.employee],
                ...(record.onBehalf === 'Yes' ? [['Requested For', record.requestedFor]] : []),
                ['Date',         record.date],
                ['Extra Hours',  `${record.extraHours}h`],
                ['Reason',       record.reason],
                ['Status',       '<span class="badge pending">Pending</span>'],
            ];
        case 'clientOff':
            return [
                ['Employee',   record.employeeName],
                ['Department', record.department],
                ['Date',       record.date],
                ['Reason',     record.reason],
                ['Status',     '<span class="badge pending">Pending</span>'],
            ];
        case 'correction':
            return [
                ['Employee',  record.employee],
                ['Date',      record.date],
                ['Clock In',  record.clockIn],
                ['Clock Out', record.clockOut],
                ['Reason',    record.reason],
                ['Status',    '<span class="badge pending">Pending</span>'],
            ];
        default:
            return [];
    }
}

// Mirrors the review controller logic exactly for all 4 request types.
// Returns null when a race condition is detected (record no longer Pending).
async function applyReview(requestType, record, status, adminUserName) {
    const reviewFields = { status, reviewedBy: adminUserName, reviewedAt: new Date() };

    switch (requestType) {
        case 'leave': {
            const updated = await LeaveModel.findOneAndUpdate(
                { _id: record._id, status: 'Pending' },
                reviewFields,
                { new: true }
            );
            if (!updated) return null;
            const existingSnowId = updated.snowLeaveId ?? null;

            syncLeaveRequestToSnow({ leave: updated, snowLeaveId: existingSnowId })
                .then(sysId => {
                    if (sysId && !existingSnowId) {
                        return LeaveModel.findByIdAndUpdate(updated._id, { snowLeaveId: sysId })
                            .catch(e => console.error('[EmailAction] Leave snowId save failed:', e.message));
                    }
                })
                .catch(e => console.error('[EmailAction] Leave ServiceNow sync failed:', e.message));

            sendLeaveStatusEmail({
                to          : record.email,
                employeeName: record.employee,
                leaveType   : record.leaveType,
                fromDate    : record.fromDate,
                untilDate   : record.untilDate,
                days        : record.days,
                status,
            }).catch(e => console.error('[EmailAction] Leave employee email failed:', e.message));

            NotificationModel.create({
                userId : record.userId,
                leaveId: record._id,
                type   : status === 'Approved' ? 'leave_approved' : 'leave_rejected',
                title  : `Leave Request ${status}`,
                message: `Your ${record.leaveType} leave from ${record.fromDate} to ${record.untilDate} (${record.days} day${record.days !== 1 ? 's' : ''}) has been ${status.toLowerCase()}.`,
            }).catch(e => console.error('[EmailAction] Leave notification failed:', e.message));

            return updated;
        }

        case 'overtime': {
            const updated = await OvertimeModel.findOneAndUpdate(
                { _id: record._id, status: 'Pending' },
                reviewFields,
                { new: true }
            );
            if (!updated) return null;
            const existingSnowId = updated.snowOvertimeId ?? null;

            syncOvertimeToSnow({ overtime: updated, snowOvertimeId: existingSnowId })
                .then(sysId => {
                    if (sysId && !existingSnowId) {
                        return OvertimeModel.findByIdAndUpdate(updated._id, { snowOvertimeId: sysId })
                            .catch(e => console.error('[EmailAction] Overtime snowId save failed:', e.message));
                    }
                })
                .catch(e => console.error('[EmailAction] Overtime ServiceNow sync failed:', e.message));

            NotificationModel.create({
                userId    : record.userId,
                overtimeId: record._id,
                type      : status === 'Approved' ? 'overtime_approved' : 'overtime_rejected',
                title     : `Overtime Request ${status}`,
                message   : `Your overtime request for ${record.date} (${record.extraHours}h) has been ${status.toLowerCase()}.`,
            }).catch(e => console.error('[EmailAction] Overtime notification failed:', e.message));

            sendOvertimeStatusEmail({
                to          : record.email,
                employeeName: record.employee,
                date        : record.date,
                extraHours  : record.extraHours,
                reason      : record.reason,
                status,
            }).catch(e => console.error('[EmailAction] Overtime employee email failed:', e.message));

            return updated;
        }

        case 'clientOff': {
            const updated = await ClientOffModel.findOneAndUpdate(
                { _id: record._id, status: 'Pending' },
                reviewFields,
                { new: true }
            );
            if (!updated) return null;

            sendClientOffStatusEmail({
                to          : record.employeeEmail,
                employeeName: record.employeeName,
                date        : record.date,
                reason      : record.reason,
                status,
            }).catch(e => console.error('[EmailAction] ClientOff employee email failed:', e.message));

            NotificationModel.create({
                userId     : record.userId,
                clientOffId: record._id,
                type       : status === 'Approved' ? 'client_off_approved' : 'client_off_rejected',
                title      : `Client Off Request ${status}`,
                message    : `Your Client Off request for ${record.date} has been ${status.toLowerCase()}.`,
            }).catch(e => console.error('[EmailAction] ClientOff notification failed:', e.message));

            return updated;
        }

        case 'correction': {
            const updated = await CorrectionModel.findOneAndUpdate(
                { _id: record._id, status: 'Pending' },
                reviewFields,
                { new: true }
            );
            if (!updated) return null;

            NotificationModel.create({
                userId      : record.userId,
                correctionId: record._id,
                type        : status === 'Approved' ? 'correction_approved' : 'correction_rejected',
                title       : `Attendance Correction ${status}`,
                message     : `Your attendance correction for ${record.date} (${record.clockIn} – ${record.clockOut}) has been ${status.toLowerCase()}.`,
            }).catch(e => console.error('[EmailAction] Correction notification failed:', e.message));

            sendCorrectionStatusEmail({
                to          : record.email,
                employeeName: record.employee,
                date        : record.date,
                clockIn     : record.clockIn,
                clockOut    : record.clockOut,
                reason      : record.reason,
                status,
            }).catch(e => console.error('[EmailAction] Correction employee email failed:', e.message));

            return updated;
        }
    }
}

// ── Shared resolver (token + admin + record) ──────────────────────────────────

async function resolveContext(token) {
    if (!token) {
        return { error: { status: 400, page: errorPage('Missing Token', 'No action token was provided in this link.') } };
    }

    let payload;
    try {
        payload = verifyActionToken(token);
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return { error: { status: 410, page: errorPage('Link Expired', 'This action link has expired (links are valid for 48 hours). Please log in to the Renevise HRMS dashboard to review the request manually.') } };
        }
        if (err.message === 'EMAIL_ACTION_SECRET is not set') {
            return { error: { status: 500, page: errorPage('Server Configuration Error', 'The server is not configured to process email actions. Please contact the system administrator.') } };
        }
        return { error: { status: 400, page: errorPage('Invalid Link', 'This link is invalid or has been tampered with. Please use the original link from your notification email.') } };
    }

    const { requestType, action, adminId, requestId } = payload;

    if (!REQUEST_LABELS[requestType] || !['Approved', 'Rejected'].includes(action)) {
        return { error: { status: 400, page: errorPage('Invalid Token', 'The token contains an unrecognized request type or action.') } };
    }

    let admin = null;
    try { admin = await UserModel.findById(adminId).select('userName role'); } catch (_) {}
    if (!admin || admin.role !== 'admin') {
        return { error: { status: 403, page: errorPage('Unauthorized', 'The admin account associated with this link could not be verified. Please log in to the dashboard directly.') } };
    }

    let record = null;
    try { record = await fetchRecord(requestType, requestId); } catch (_) {}
    if (!record) {
        return { error: { status: 404, page: errorPage('Request Not Found', 'The request linked to this action could not be found. It may have been deleted.') } };
    }

    return { payload, admin, record };
}

// ── Route handlers ────────────────────────────────────────────────────────────

// GET /api/email-action?token=<jwt>  — show confirmation page
async function showConfirmPage(req, res) {
    const ctx = await resolveContext(req.query.token);
    if (ctx.error) return res.status(ctx.error.status).send(ctx.error.page);

    const { payload, record } = ctx;
    const { requestType, action } = payload;

    if (record.status !== 'Pending') {
        return res.status(200).send(alreadyReviewedPage(record.status));
    }

    return res.status(200).send(confirmationPage({
        token           : req.query.token,
        action,
        requestTypeLabel: REQUEST_LABELS[requestType],
        rows            : buildDisplayRows(requestType, record),
    }));
}

// POST /api/email-action?token=<jwt>  — process the confirmed action
async function processAction(req, res) {
    const ctx = await resolveContext(req.query.token);
    if (ctx.error) return res.status(ctx.error.status).send(ctx.error.page);

    const { payload, admin, record } = ctx;
    const { requestType, action }    = payload;

    if (record.status !== 'Pending') {
        return res.status(200).send(alreadyReviewedPage(record.status));
    }

    let result;
    try {
        result = await applyReview(requestType, record, action, admin.userName || 'Admin');
    } catch (err) {
        console.error(`[EmailAction] DB update failed for ${requestType} ${payload.requestId}:`, err.message);
        return res.status(500).send(errorPage('Processing Error', 'An error occurred while saving your action. Please try again or log in to the dashboard to review the request manually.'));
    }

    if (!result) {
        // Race: record was concurrently expired or reviewed between context load and update
        let currentRecord = null;
        try { currentRecord = await fetchRecord(requestType, payload.requestId); } catch (_) {}
        return res.status(200).send(alreadyReviewedPage(currentRecord?.status || 'Expired'));
    }

    console.log(`[EmailAction] ${requestType} ${payload.requestId} ${action} by ${admin.userName}`);
    return res.status(200).send(successPage(action, REQUEST_LABELS[requestType]));
}

module.exports = { showConfirmPage, processAction };
