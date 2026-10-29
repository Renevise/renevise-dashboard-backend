const express = require('express');
const attendanceRoute = express.Router();
const { clockIn, clockOut, startBreak, endBreak, getTodayStatus, getMyAttendance, getAllAttendance, updateRemarks, getTodaySummary } = require('../controller/attendance.controller');
const authenticate = require('../middleware/authenticate');
const authorize    = require('../middleware/authorize');

attendanceRoute.post('/clock-in',      authenticate,                    clockIn);
attendanceRoute.post('/clock-out',     authenticate,                    clockOut);
attendanceRoute.post('/break-start',   authenticate,                    startBreak);
attendanceRoute.post('/break-end',     authenticate,                    endBreak);
attendanceRoute.get('/today-status',   authenticate,                    getTodayStatus);
attendanceRoute.get('/my',             authenticate,                    getMyAttendance);
attendanceRoute.get('/all',            authenticate, authorize('admin'), getAllAttendance);
attendanceRoute.get('/today-summary',  authenticate, authorize('admin'), getTodaySummary);
attendanceRoute.patch('/:id/remarks',  authenticate, authorize('admin'), updateRemarks);

module.exports = attendanceRoute;
