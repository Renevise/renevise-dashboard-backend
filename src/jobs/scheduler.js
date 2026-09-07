'use strict';

const cron              = require('node-cron');
const LeaveModel        = require('../model/leave.model');
const OvertimeModel     = require('../model/overtime.model');
const ClientOffModel    = require('../model/client-off.model');
const CorrectionModel   = require('../model/attendance-correction.model');
const AttendanceModel   = require('../model/attendance.model');
const UserModel         = require('../model/user.model');
const NotificationModel = require('../model/notification.model');
const {
    sendAdminReminderEmail,
    sendRequestExpiredEmployeeEmail,
} = require('../services/email.service');
const { postAttendanceToSnow } = require('../services/servicenow.service');

// ── Auto clock-out helpers (mirrors attendance.controller.js) ────────────────

const AUTO_DEPT_CUTOFF = {
    'ServiceNow':          17 * 60 + 45,
    'AI Content Creation': 17 * 60 + 45,
    'Web Development':     16 * 60 + 15,
    'App Development':     16 * 60 + 15,
};
const AUTO_MIN_FULL_DAY = 8.0;
const AUTO_MIN_HALF_DAY = 4.5;

function autoPktMinutes(ms) {
    return Math.floor(ms / 60000 + 5 * 60) % 1440;
}

function autoFormatTime(tsMs) {
    return new Date(tsMs).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'Asia/Karachi',
    });
}

function autoDetermineStatus(clockInMs, workedHours, department) {
    const cutoff = AUTO_DEPT_CUTOFF[department] ?? AUTO_DEPT_CUTOFF['ServiceNow'];
    const isLate = autoPktMinutes(clockInMs) > cutoff;
    if (workedHours >= AUTO_MIN_FULL_DAY) return isLate ? 'Late' : 'Present';
    if (workedHours >= AUTO_MIN_HALF_DAY) return 'Early Leave';
    return 'Half Day';
}

// ── PKT date helpers (UTC+5) ──────────────────────────────────────────────────

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

function getPKTDateStr(date = new Date()) {
    const pkt = new Date(date.getTime() + PKT_OFFSET_MS);
    const y   = pkt.getUTCFullYear();
    const m   = String(pkt.getUTCMonth() + 1).padStart(2, '0');
    const d   = String(pkt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function addDaysToStr(dateStr, n) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    const ry  = dt.getUTCFullYear();
    const rm  = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const rd  = String(dt.getUTCDate()).padStart(2, '0');
    return `${ry}-${rm}-${rd}`;
}

// ── Expiry job (runs at 00:05 PKT) ───────────────────────────────────────────

async function runExpiryJob() {
    const todayStr = getPKTDateStr();
    console.log(`[Scheduler] Expiry job — todayPKT: ${todayStr}`);

    // ── Leave: expire when fromDate < today (leave start date has passed) ──
    try {
        const expiredLeaves = await LeaveModel.find({ status: 'Pending', fromDate: { $lt: todayStr } });
        for (const leave of expiredLeaves) {
            const updated = await LeaveModel.findOneAndUpdate(
                { _id: leave._id, status: 'Pending' },
                { status: 'Expired' },
                { new: true }
            );
            if (!updated) continue; // race: admin reviewed simultaneously

            NotificationModel.create({
                userId : leave.userId,
                leaveId: leave._id,
                type   : 'leave_expired',
                title  : 'Leave Request Expired',
                message: `Your ${leave.leaveType} leave request from ${leave.fromDate} to ${leave.untilDate} was automatically expired — no decision was made before the start date.`,
            }).catch(e => console.error('[Scheduler] Leave expiry notification failed:', e.message));

            sendRequestExpiredEmployeeEmail({
                to          : leave.email,
                employeeName: leave.employee,
                requestType : 'Leave',
                requestDate : `${leave.fromDate} to ${leave.untilDate}`,
            }).catch(e => console.error('[Scheduler] Leave expiry email failed:', e.message));

            console.log(`[Scheduler] Leave ${leave._id} expired (fromDate: ${leave.fromDate})`);
        }
    } catch (e) {
        console.error('[Scheduler] Leave expiry job error:', e.message);
    }

    // ── Overtime: expire when date < today ──
    try {
        const expiredOvertimes = await OvertimeModel.find({ status: 'Pending', date: { $lt: todayStr } });
        for (const ot of expiredOvertimes) {
            const updated = await OvertimeModel.findOneAndUpdate(
                { _id: ot._id, status: 'Pending' },
                { status: 'Expired' },
                { new: true }
            );
            if (!updated) continue;

            NotificationModel.create({
                userId    : ot.userId,
                overtimeId: ot._id,
                type      : 'overtime_expired',
                title     : 'Overtime Request Expired',
                message   : `Your overtime request for ${ot.date} (${ot.extraHours}h) was automatically expired — no decision was made before the end of the request date.`,
            }).catch(e => console.error('[Scheduler] Overtime expiry notification failed:', e.message));

            sendRequestExpiredEmployeeEmail({
                to          : ot.email,
                employeeName: ot.employee,
                requestType : 'Overtime',
                requestDate : ot.date,
            }).catch(e => console.error('[Scheduler] Overtime expiry email failed:', e.message));

            console.log(`[Scheduler] Overtime ${ot._id} expired (date: ${ot.date})`);
        }
    } catch (e) {
        console.error('[Scheduler] Overtime expiry job error:', e.message);
    }

    // ── Client Off: expire when date < today ──
    try {
        const expiredClientOffs = await ClientOffModel.find({ status: 'Pending', date: { $lt: todayStr } });
        for (const co of expiredClientOffs) {
            const updated = await ClientOffModel.findOneAndUpdate(
                { _id: co._id, status: 'Pending' },
                { status: 'Expired' },
                { new: true }
            );
            if (!updated) continue;

            NotificationModel.create({
                userId     : co.userId,
                clientOffId: co._id,
                type       : 'client_off_expired',
                title      : 'Client Off Request Expired',
                message    : `Your Client Off request for ${co.date} was automatically expired — no decision was made before the end of the request date.`,
            }).catch(e => console.error('[Scheduler] Client Off expiry notification failed:', e.message));

            sendRequestExpiredEmployeeEmail({
                to          : co.employeeEmail,
                employeeName: co.employeeName,
                requestType : 'Client Off',
                requestDate : co.date,
            }).catch(e => console.error('[Scheduler] Client Off expiry email failed:', e.message));

            console.log(`[Scheduler] ClientOff ${co._id} expired (date: ${co.date})`);
        }
    } catch (e) {
        console.error('[Scheduler] Client Off expiry job error:', e.message);
    }

    // ── Attendance Correction: expire 7 days after submission ──
    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const expiredCorrections = await CorrectionModel.find({
            status   : 'Pending',
            createdAt: { $lte: sevenDaysAgo },
        });
        for (const corr of expiredCorrections) {
            const updated = await CorrectionModel.findOneAndUpdate(
                { _id: corr._id, status: 'Pending' },
                { status: 'Expired' },
                { new: true }
            );
            if (!updated) continue;

            NotificationModel.create({
                userId      : corr.userId,
                correctionId: corr._id,
                type        : 'correction_expired',
                title       : 'Attendance Correction Expired',
                message     : `Your attendance correction request for ${corr.date} was automatically expired — no admin decision was made within 7 days of submission.`,
            }).catch(e => console.error('[Scheduler] Correction expiry notification failed:', e.message));

            sendRequestExpiredEmployeeEmail({
                to          : corr.email,
                employeeName: corr.employee,
                requestType : 'Attendance Correction',
                requestDate : corr.date,
            }).catch(e => console.error('[Scheduler] Correction expiry email failed:', e.message));

            console.log(`[Scheduler] Correction ${corr._id} expired (date: ${corr.date})`);
        }
    } catch (e) {
        console.error('[Scheduler] Correction expiry job error:', e.message);
    }

    console.log('[Scheduler] Expiry job complete.');
}

// ── Reminder job (runs at 09:00 PKT) ─────────────────────────────────────────

async function runReminderJob() {
    const todayStr    = getPKTDateStr();
    const tomorrowStr = addDaysToStr(todayStr, 1);
    console.log(`[Scheduler] Reminder job — todayPKT: ${todayStr}`);

    let admins = [];
    try {
        admins = await UserModel.find({ role: 'admin' }).select('email userName');
    } catch (e) {
        console.error('[Scheduler] Could not fetch admins for reminders:', e.message);
        return;
    }
    if (!admins.length) {
        console.warn('[Scheduler] No admins found — skipping reminders.');
        return;
    }

    // ── Leave reminders ──
    try {
        const pendingLeaves = await LeaveModel.find({ status: 'Pending' });
        for (const leave of pendingLeaves) {
            const needs = [];

            if (leave.fromDate === tomorrowStr && !(leave.remindersSent || []).includes('day_before')) {
                needs.push({ urgency: 'day_before', marker: 'day_before' });
            }
            if (leave.fromDate === todayStr && !(leave.remindersSent || []).includes('same_day')) {
                needs.push({ urgency: 'same_day', marker: 'same_day' });
            }

            for (const { urgency, marker } of needs) {
                const deadline = leave.fromDate;
                await Promise.all(
                    admins.map(admin =>
                        sendAdminReminderEmail({
                            to             : admin.email,
                            adminName      : admin.userName,
                            requestType    : `Leave (${leave.leaveType})`,
                            employeeName   : leave.employee,
                            requestDate    : `${leave.fromDate} to ${leave.untilDate}`,
                            deadlineDateStr: deadline,
                            urgency,
                        }).catch(e => console.error(`[Scheduler] Leave reminder email failed (${admin.email}):`, e.message))
                    )
                );
                await LeaveModel.findByIdAndUpdate(leave._id, { $addToSet: { remindersSent: marker } });
                console.log(`[Scheduler] Leave ${leave._id} — sent ${marker} reminder`);
            }
        }
    } catch (e) {
        console.error('[Scheduler] Leave reminder job error:', e.message);
    }

    // ── Overtime reminders ──
    try {
        const pendingOvertimes = await OvertimeModel.find({ status: 'Pending' });
        for (const ot of pendingOvertimes) {
            const needs = [];

            if (ot.date === tomorrowStr && !(ot.remindersSent || []).includes('day_before')) {
                needs.push({ urgency: 'day_before', marker: 'day_before' });
            }
            if (ot.date === todayStr && !(ot.remindersSent || []).includes('same_day')) {
                needs.push({ urgency: 'same_day', marker: 'same_day' });
            }

            for (const { urgency, marker } of needs) {
                await Promise.all(
                    admins.map(admin =>
                        sendAdminReminderEmail({
                            to             : admin.email,
                            adminName      : admin.userName,
                            requestType    : 'Overtime',
                            employeeName   : ot.employee,
                            requestDate    : `${ot.date} (${ot.extraHours}h)`,
                            deadlineDateStr: ot.date,
                            urgency,
                        }).catch(e => console.error(`[Scheduler] Overtime reminder email failed (${admin.email}):`, e.message))
                    )
                );
                await OvertimeModel.findByIdAndUpdate(ot._id, { $addToSet: { remindersSent: marker } });
                console.log(`[Scheduler] Overtime ${ot._id} — sent ${marker} reminder`);
            }
        }
    } catch (e) {
        console.error('[Scheduler] Overtime reminder job error:', e.message);
    }

    // ── Client Off reminders ──
    try {
        const pendingClientOffs = await ClientOffModel.find({ status: 'Pending' });
        for (const co of pendingClientOffs) {
            const needs = [];

            if (co.date === tomorrowStr && !(co.remindersSent || []).includes('day_before')) {
                needs.push({ urgency: 'day_before', marker: 'day_before' });
            }
            if (co.date === todayStr && !(co.remindersSent || []).includes('same_day')) {
                needs.push({ urgency: 'same_day', marker: 'same_day' });
            }

            for (const { urgency, marker } of needs) {
                await Promise.all(
                    admins.map(admin =>
                        sendAdminReminderEmail({
                            to             : admin.email,
                            adminName      : admin.userName,
                            requestType    : 'Client Off',
                            employeeName   : co.employeeName,
                            requestDate    : co.date,
                            deadlineDateStr: co.date,
                            urgency,
                        }).catch(e => console.error(`[Scheduler] Client Off reminder email failed (${admin.email}):`, e.message))
                    )
                );
                await ClientOffModel.findByIdAndUpdate(co._id, { $addToSet: { remindersSent: marker } });
                console.log(`[Scheduler] ClientOff ${co._id} — sent ${marker} reminder`);
            }
        }
    } catch (e) {
        console.error('[Scheduler] Client Off reminder job error:', e.message);
    }

    // ── Attendance Correction reminders ──
    // Expiry = createdAt + 7 days. Remind at day 4 (3 days left) and day 6 (1 day left).
    try {
        const pendingCorrections = await CorrectionModel.find({ status: 'Pending' });
        for (const corr of pendingCorrections) {
            const submittedPKT    = getPKTDateStr(corr.createdAt);
            const day3WarningPKT  = addDaysToStr(submittedPKT, 4); // 3 days before expiry
            const dayBeforePKT    = addDaysToStr(submittedPKT, 6); // 1 day before expiry
            const expiryDatePKT   = addDaysToStr(submittedPKT, 7);

            const needs = [];
            if (day3WarningPKT === todayStr && !(corr.remindersSent || []).includes('3day_warning')) {
                needs.push({ urgency: '3day_warning', marker: '3day_warning', expiryDatePKT });
            }
            if (dayBeforePKT === todayStr && !(corr.remindersSent || []).includes('day_before')) {
                needs.push({ urgency: 'day_before', marker: 'day_before', expiryDatePKT });
            }

            for (const { urgency, marker, expiryDatePKT: deadline } of needs) {
                await Promise.all(
                    admins.map(admin =>
                        sendAdminReminderEmail({
                            to             : admin.email,
                            adminName      : admin.userName,
                            requestType    : 'Attendance Correction',
                            employeeName   : corr.employee,
                            requestDate    : corr.date,
                            deadlineDateStr: deadline,
                            urgency,
                        }).catch(e => console.error(`[Scheduler] Correction reminder email failed (${admin.email}):`, e.message))
                    )
                );
                await CorrectionModel.findByIdAndUpdate(corr._id, { $addToSet: { remindersSent: marker } });
                console.log(`[Scheduler] Correction ${corr._id} — sent ${marker} reminder`);
            }
        }
    } catch (e) {
        console.error('[Scheduler] Correction reminder job error:', e.message);
    }

    console.log('[Scheduler] Reminder job complete.');
}

// ── Auto clock-out job (runs every minute) ────────────────────────────────────

async function runAutoClockOutJob() {
    try {
        const threshold = Date.now() - 14 * 3600 * 1000;
        const staleSessions = await AttendanceModel.find({
            clockOutMs: null,
            clockInMs : { $lte: threshold },
        });
        if (!staleSessions.length) return;

        console.log(`[Scheduler] Auto clock-out — ${staleSessions.length} stale session(s)`);

        for (const record of staleSessions) {
            try {
                const clockOutMs = record.clockInMs + 14 * 3600 * 1000;

                const activeBreakSec = record.activeBreakStartMs
                    ? Math.max(0, Math.floor((clockOutMs - record.activeBreakStartMs) / 1000))
                    : 0;
                const totalBreakSec     = (record.accumulatedBreakSec || 0) + activeBreakSec;
                const workedSec         = Math.max(0, 14 * 3600 - totalBreakSec);
                const workedHours       = parseFloat((workedSec / 3600).toFixed(2));
                const breakMinutes      = Math.round(totalBreakSec / 60);
                const shiftDurationMins = 840;

                const user       = await UserModel.findById(record.userId).select('department email serviceNowSysId');
                const department = user?.department ?? 'ServiceNow';
                const status     = autoDetermineStatus(record.clockInMs, workedHours, department);

                await AttendanceModel.findByIdAndUpdate(record._id, {
                    clockOut           : autoFormatTime(clockOutMs),
                    clockOutMs,
                    breakMinutes,
                    shiftDurationMins,
                    workedSeconds      : workedSec,
                    workedHours,
                    status,
                    autoClockOut       : true,
                    activeBreakStartMs : null,
                    accumulatedBreakSec: totalBreakSec,
                });

                NotificationModel.create({
                    userId : record.userId,
                    type   : 'auto_clock_out',
                    title  : 'Auto Clock-Out',
                    message: `You were automatically clocked out after 14 hours (${autoFormatTime(record.clockInMs)} – ${autoFormatTime(clockOutMs)}). Total worked: ${workedHours}h.`,
                }).catch(e => console.error('[Scheduler] Auto clock-out notification failed:', e.message));

                postAttendanceToSnow({
                    snowSysId       : user?.serviceNowSysId ?? null,
                    userEmail       : user?.email,
                    clockInMs       : record.clockInMs,
                    clockOutMs,
                    date            : record.date,
                    locationType    : record.locationType,
                    status,
                    department,
                    breakMinutes,
                    shiftDurationMins,
                }).catch(e => console.error('[Scheduler] Auto clock-out ServiceNow sync failed:', e.message));

                console.log(`[Scheduler] Auto clock-out: userId=${record.userId} date=${record.date} workedHours=${workedHours} status=${status}`);
            } catch (e) {
                console.error(`[Scheduler] Auto clock-out failed for record ${record._id}:`, e.message);
            }
        }
    } catch (e) {
        console.error('[Scheduler] Auto clock-out job error:', e.message);
    }
}

// ── Scheduler entry point ─────────────────────────────────────────────────────

function startScheduler() {
    // 00:05 PKT daily — expire overdue pending requests
    cron.schedule('5 0 * * *', async () => {
        console.log('[Scheduler] --- Expiry job triggered ---');
        try { await runExpiryJob(); } catch (e) { console.error('[Scheduler] Expiry job crashed:', e); }
    });

    // 09:00 PKT daily — send reminders for upcoming expirations
    cron.schedule('0 9 * * *', async () => {
        console.log('[Scheduler] --- Reminder job triggered ---');
        try { await runReminderJob(); } catch (e) { console.error('[Scheduler] Reminder job crashed:', e); }
    });

    // every minute — auto clock-out sessions open for 5+ hours
    cron.schedule('* * * * *', async () => {
        try { await runAutoClockOutJob(); } catch (e) { console.error('[Scheduler] Auto clock-out job crashed:', e); }
    });

    console.log('[Scheduler] Cron jobs registered: expiry=00:05, reminders=09:00, auto-clock-out=every-minute (server local time / PKT)');
}

module.exports = { startScheduler };
