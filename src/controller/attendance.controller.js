const AttendanceModel = require('../model/attendance.model');
const UserModel       = require('../model/user.model');
const CompanyOffModel = require('../model/company-off.model');
const LeaveModel      = require('../model/leave.model');
const ClientOffModel  = require('../model/client-off.model');
const { postAttendanceToSnow } = require('../services/servicenow.service');
const { DEPT_CUTOFF_MINUTES, getShiftEndMs } = require('../config/shiftConfig');
const MIN_HOURS_FULL_DAY = 8.0;
const MIN_HOURS_HALF_DAY = 4.5;

function pktMinutes(ms) {
    return Math.floor(ms / 60000 + 5 * 60) % 1440;
}

function localDateString() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Karachi',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
}

function formatTime(tsMs) {
    return new Date(tsMs).toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'Asia/Karachi',
    });
}

function determineStatus(clockInMs, actualClockOutMs, workedHours, department) {
    const cutoff     = DEPT_CUTOFF_MINUTES[department] ?? DEPT_CUTOFF_MINUTES['ServiceNow'];
    const isLate     = pktMinutes(clockInMs) > cutoff;
    const shiftEndMs = getShiftEndMs(clockInMs, department);
    const leftEarly  = actualClockOutMs < shiftEndMs;
    if (workedHours >= MIN_HOURS_FULL_DAY) return isLate ? 'Late' : 'Present';
    if (!leftEarly)                        return isLate ? 'Late' : 'Present';
    if (workedHours >= MIN_HOURS_HALF_DAY) return 'Early Leave';
    return 'Half Day';
}

async function clockIn(req, res) {
    try {
        const userId = req.user.userId;
        const { locationType = 'office' } = req.body;

        const user = await UserModel.findById(userId).select('firstName lastName userName department');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const today = localDateString();
        const existing = await AttendanceModel.findOne({ userId, clockOutMs: null });

        if (existing) {
            return res.status(409).json({ message: 'Already clocked in today' });
        }

        const clockInMs = Date.now();
        const employeeName = (user.firstName && user.lastName)
            ? `${user.firstName} ${user.lastName}`
            : user.userName;

        const dept           = user.department ?? 'ServiceNow';
        const cutoff         = DEPT_CUTOFF_MINUTES[dept] ?? DEPT_CUTOFF_MINUTES['ServiceNow'];
        const prelimStatus   = pktMinutes(clockInMs) > cutoff ? 'Late' : 'Present';

        const record = await AttendanceModel.create({
            userId,
            employee:   employeeName,
            department: user.department ?? null,
            date: today,
            clockIn: formatTime(clockInMs),
            clockInMs,
            locationType,
            status: prelimStatus,
        });

        return res.status(201).json({ message: 'Clocked in successfully', record });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function clockOut(req, res) {
    try {
        const userId = req.user.userId;

        const record = await AttendanceModel.findOne(
            { userId, clockOutMs: null },
            null,
            { sort: { clockInMs: -1 } }
        );

        if (!record) {
            return res.status(404).json({ message: 'No active clock-in session found' });
        }

        const user = await UserModel.findById(userId).select('department email serviceNowSysId');
        const department = user?.department ?? 'ServiceNow';

        const actualClockOutMs = Date.now();
        const shiftEndMs       = getShiftEndMs(record.clockInMs, department);
        const calcMs           = Math.min(actualClockOutMs, shiftEndMs);

        // Compute break from DB — cap active break at shift end
        const activeBreakSec = record.activeBreakStartMs
            ? Math.max(0, Math.floor((calcMs - record.activeBreakStartMs) / 1000))
            : 0;
        const totalBreakSec     = (record.accumulatedBreakSec || 0) + activeBreakSec;

        const rawSec            = Math.max(0, Math.floor((calcMs - record.clockInMs) / 1000));
        const workedSec         = Math.max(0, rawSec - totalBreakSec);
        const workedHours       = parseFloat((workedSec / 3600).toFixed(2));
        const breakMinutes      = Math.round(totalBreakSec / 60);
        const shiftDurationMins = Math.floor((calcMs - record.clockInMs) / 60000);
        const clockOutMs        = actualClockOutMs;
        const status            = determineStatus(record.clockInMs, actualClockOutMs, workedHours, department);

        const isLate = pktMinutes(record.clockInMs) > (DEPT_CUTOFF_MINUTES[department] ?? DEPT_CUTOFF_MINUTES['ServiceNow']);

        const updated = await AttendanceModel.findByIdAndUpdate(
            record._id,
            {
                clockOut: formatTime(clockOutMs),
                clockOutMs,
                breakMinutes,
                shiftDurationMins,
                workedSeconds: workedSec,
                workedHours,
                status,
                isLate,
                activeBreakStartMs : null,
                accumulatedBreakSec: totalBreakSec,
            },
            { new: true }
        );

        postAttendanceToSnow({
            snowSysId   : user.serviceNowSysId ?? null,
            userEmail   : user.email,
            clockInMs   : record.clockInMs,
            clockOutMs,
            date        : updated.date,
            locationType: updated.locationType,
            status,
            department  : user.department ?? null,
            breakMinutes,
            shiftDurationMins,
        }).catch(err => console.error('[ServiceNow] Sync failed:', err.message));

        return res.status(200).json({ message: 'Clocked out successfully', record: updated });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function startBreak(req, res) {
    try {
        const userId = req.user.userId;
        const record = await AttendanceModel.findOne(
            { userId, clockOutMs: null },
            null,
            { sort: { clockInMs: -1 } }
        );
        if (!record) {
            return res.status(404).json({ message: 'No active clock-in session found' });
        }
        if (record.activeBreakStartMs !== null) {
            return res.status(409).json({ message: 'Already on break' });
        }
        const updated = await AttendanceModel.findByIdAndUpdate(
            record._id,
            { activeBreakStartMs: Date.now() },
            { new: true }
        );
        return res.status(200).json({ message: 'Break started', record: updated });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function endBreak(req, res) {
    try {
        const userId = req.user.userId;
        const record = await AttendanceModel.findOne(
            { userId, clockOutMs: null },
            null,
            { sort: { clockInMs: -1 } }
        );
        if (!record) {
            return res.status(404).json({ message: 'No active clock-in session found' });
        }
        if (record.activeBreakStartMs === null) {
            return res.status(409).json({ message: 'Not currently on break' });
        }
        const breakDurationSec = Math.max(0, Math.floor((Date.now() - record.activeBreakStartMs) / 1000));
        const newAccumulated   = (record.accumulatedBreakSec || 0) + breakDurationSec;
        const updated = await AttendanceModel.findByIdAndUpdate(
            record._id,
            { activeBreakStartMs: null, accumulatedBreakSec: newAccumulated },
            { new: true }
        );
        return res.status(200).json({ message: 'Break ended', record: updated });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function getTodayStatus(req, res) {
    try {
        const userId = req.user.userId;
        const record = await AttendanceModel.findOne(
            { userId, clockOutMs: null },
            null,
            { sort: { clockInMs: -1 } }
        );
        return res.status(200).json({ record: record || null });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function getMyAttendance(req, res) {
    try {
        const userId = req.user.userId;
        const { year, month } = req.query;

        const filter = { userId };
        if (year && month) {
            const y = String(year).padStart(4, '0');
            const m = String(month).padStart(2, '0');
            filter.date = { $gte: `${y}-${m}-01`, $lte: `${y}-${m}-31` };
        }

        const records = await AttendanceModel.find(filter).sort({ date: -1, clockInMs: -1 });
        return res.status(200).json({ records });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function getAllAttendance(req, res) {
    try {
        const { year, month } = req.query;

        const filter = {};
        if (year && month) {
            const y = String(year).padStart(4, '0');
            const m = String(month).padStart(2, '0');
            filter.date = { $gte: `${y}-${m}-01`, $lte: `${y}-${m}-31` };
        }

        const records = await AttendanceModel.find(filter).sort({ date: -1, clockInMs: -1 });
        return res.status(200).json({ records });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function updateRemarks(req, res) {
    try {
        const { id } = req.params;
        const { adminRemarks } = req.body;
        const record = await AttendanceModel.findByIdAndUpdate(
            id,
            { adminRemarks: adminRemarks ?? null },
            { new: true }
        );
        if (!record) return res.status(404).json({ message: 'Record not found' });
        return res.status(200).json({ message: 'Remarks updated', record });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function getTodaySummary(req, res) {
    try {
        const pktToday = localDateString(); // actual PKT date right now

        // Accept an optional date query param; fall back to PKT today
        const rawDate   = req.query.date;
        const targetDate = (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate))
            ? rawDate
            : pktToday;

        const isToday  = targetDate === pktToday;
        const isPast   = targetDate < pktToday;
        // isFuture = !isToday && !isPast (implied below)

        // Current PKT minute only matters for today's cutoff check
        const nowMin = isToday ? pktMinutes(Date.now()) : 0;

        // Day of week for the target date
        const [y, m, d] = targetDate.split('-').map(Number);
        const dow       = new Date(Date.UTC(y, m - 1, d, 12)).getDay(); // 0=Sun, 6=Sat
        const isWeekday = dow !== 0 && dow !== 6;

        // All non-admin employees
        const employees = await UserModel.find({ role: 'employee' })
            .select('_id firstName lastName userName department');

        // Attendance records for the target date
        const attRecords = await AttendanceModel.find({ date: targetDate });
        const attMap     = new Map(attRecords.map(r => [String(r.userId), r]));

        // Company off ranges covering the target date
        const companyOffs  = await CompanyOffModel.find({ fromDate: { $lte: targetDate }, untilDate: { $gte: targetDate } });
        const isCompanyOff = companyOffs.length > 0;

        // Approved leaves covering the target date
        const leaves   = await LeaveModel.find({ fromDate: { $lte: targetDate }, untilDate: { $gte: targetDate }, status: 'Approved' });
        const leaveMap = new Map(leaves.map(l => [String(l.userId), l]));

        // Approved client offs for the target date
        const clientOffs   = await ClientOffModel.find({ date: targetDate, status: 'Approved' });
        const clientOffMap = new Map(clientOffs.map(c => [String(c.userId), c]));

        const summary = { present: 0, absent: 0, onLeave: 0, companyOff: 0, clientOff: 0 };

        const employeeList = employees.map(emp => {
            const userId = String(emp._id);
            const name   = (emp.firstName && emp.lastName)
                ? `${emp.firstName} ${emp.lastName}`
                : emp.userName;
            const dept   = emp.department ?? 'ServiceNow';
            const att    = attMap.get(userId);

            // 1. Has clock-in record → Present
            if (att) {
                summary.present++;
                return {
                    userId,
                    name,
                    department: emp.department,
                    status: 'Present',
                    clockIn: att.clockIn ?? null,
                    clockOut: att.clockOut ?? null,
                    attendanceStatus: att.status ?? 'Present',
                };
            }

            // 2. Company Off
            if (isCompanyOff) {
                summary.companyOff++;
                return { userId, name, department: emp.department, status: 'Company Off', clockIn: null, clockOut: null, attendanceStatus: null };
            }

            // 3. Approved Leave covering the target date
            if (leaveMap.has(userId)) {
                summary.onLeave++;
                return { userId, name, department: emp.department, status: 'On Leave', clockIn: null, clockOut: null, attendanceStatus: null };
            }

            // 4. Approved Client Off for the target date
            if (clientOffMap.has(userId)) {
                summary.clientOff++;
                return { userId, name, department: emp.department, status: 'Client Off', clockIn: null, clockOut: null, attendanceStatus: null };
            }

            // 5. Absent logic — only applies on weekdays, never on future dates
            //    Past date: day is over, no record → definitively Absent
            //    Today:     cutoff has passed → Absent
            //    Future:    shift hasn't happened yet → Not Started
            const cutoffMin = DEPT_CUTOFF_MINUTES[dept] ?? DEPT_CUTOFF_MINUTES['ServiceNow'];
            const isAbsent  = isWeekday && (isPast || (isToday && nowMin > cutoffMin));
            if (isAbsent) {
                summary.absent++;
                return { userId, name, department: emp.department, status: 'Absent', clockIn: null, clockOut: null, attendanceStatus: null };
            }

            // 6. Not Started (future date, pre-cutoff today, or weekend)
            return { userId, name, department: emp.department, status: 'Not Started', clockIn: null, clockOut: null, attendanceStatus: null };
        });

        return res.status(200).json({ date: targetDate, employees: employeeList, summary });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports = { clockIn, clockOut, startBreak, endBreak, getTodayStatus, getMyAttendance, getAllAttendance, updateRemarks, getTodaySummary };
