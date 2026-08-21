const AttendanceModel = require('../model/attendance.model');
const UserModel = require('../model/user.model');
const { postAttendanceToSnow } = require('../services/servicenow.service');

const DEPT_CUTOFF_MINUTES = {
    'ServiceNow':          17 * 60 + 45,  
    'AI Content Creation': 17 * 60 + 45,  
    'Web Development':     16 * 60 + 15,  
    'App Development':     16 * 60 + 15,  
};
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

function determineStatus(clockInMs, workedHours, department) {
    const cutoff = DEPT_CUTOFF_MINUTES[department] ?? DEPT_CUTOFF_MINUTES['ServiceNow'];
    const isLate = pktMinutes(clockInMs) > cutoff;
    if (workedHours >= MIN_HOURS_FULL_DAY) return isLate ? 'Late' : 'Present';
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
        const existing = await AttendanceModel.findOne({ userId, date: today, clockOutMs: null });

        if (existing) {
            return res.status(409).json({ message: 'Already clocked in today' });
        }

        const clockInMs = Date.now();
        const employeeName = (user.firstName && user.lastName)
            ? `${user.firstName} ${user.lastName}`
            : user.userName;

        const record = await AttendanceModel.create({
            userId,
            employee:   employeeName,
            department: user.department ?? null,
            date: today,
            clockIn: formatTime(clockInMs),
            clockInMs,
            locationType,
            status: 'Present',
        });

        return res.status(201).json({ message: 'Clocked in successfully', record });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function clockOut(req, res) {
    try {
        const userId = req.user.userId;
        const { breakSec = 0 } = req.body;

        const today = localDateString();
        const record = await AttendanceModel.findOne({ userId, date: today, clockOutMs: null });

        if (!record) {
            return res.status(404).json({ message: 'No active clock-in session found for today' });
        }

        const user = await UserModel.findById(userId).select('department email serviceNowSysId');
        const department = user?.department ?? 'ServiceNow';

        const clockOutMs = Date.now();
        const rawSec = Math.max(0, Math.floor((clockOutMs - record.clockInMs) / 1000));
        const workedSec = Math.max(0, rawSec - breakSec);
        const workedHours = parseFloat((workedSec / 3600).toFixed(2));
        const breakMinutes = Math.round(breakSec / 60);
        const shiftDurationMins = Math.floor((clockOutMs - record.clockInMs) / 60000);
        const status = determineStatus(record.clockInMs, workedHours, department);

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
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function getTodayStatus(req, res) {
    try {
        const userId = req.user.userId;
        const today = localDateString();
        const record = await AttendanceModel.findOne({ userId, date: today, clockOutMs: null });
        return res.status(200).json({ record: record || null });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function getMyAttendance(req, res) {
    try {
        const userId = req.user.userId;
        const records = await AttendanceModel.find({ userId }).sort({ date: -1, clockInMs: -1 });
        return res.status(200).json({ records });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function getAllAttendance(req, res) {
    try {
        const records = await AttendanceModel.find().sort({ date: -1, clockInMs: -1 });
        return res.status(200).json({ records });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

module.exports = { clockIn, clockOut, getTodayStatus, getMyAttendance, getAllAttendance };
