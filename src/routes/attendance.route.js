const express = require('express');
const attendanceRoute = express.Router();
const { clockIn, clockOut, getTodayStatus, getMyAttendance, getAllAttendance } = require('../controller/attendance.controller');
const authenticate = require('../middleware/authenticate');
const authorize    = require('../middleware/authorize');

attendanceRoute.post('/clock-in',      authenticate,                    clockIn);
attendanceRoute.post('/clock-out',     authenticate,                    clockOut);
attendanceRoute.get('/today-status',   authenticate,                    getTodayStatus);
attendanceRoute.get('/my',             authenticate,                    getMyAttendance);
attendanceRoute.get('/all',            authenticate, authorize('admin'), getAllAttendance);

module.exports = attendanceRoute;
