const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        employee: {
            type: String,
            required: true,
        },
        department: {
            type: String,
            default: null,
        },
        date: {
            type: String,
            required: true,
        },
        clockIn: {
            type: String,
            default: null,
        },
        clockOut: {
            type: String,
            default: null,
        },
        clockInMs: {
            type: Number,
            default: null,
        },
        clockOutMs: {
            type: Number,
            default: null,
        },
        breakMinutes: {
            type: Number,
            default: 0,
        },
        activeBreakStartMs: {
            type: Number,
            default: null,
        },
        accumulatedBreakSec: {
            type: Number,
            default: 0,
        },
        shiftDurationMins: {
            type: Number,
            default: 0,
        },
        workedSeconds: {
            type: Number,
            default: 0,
        },
        workedHours: {
            type: Number,
            default: 0,
        },
        status: {
            type: String,
            enum: ['Present', 'Late', 'Half Day', 'Early Leave'],
            default: 'Present',
        },
        locationType: {
            type: String,
            enum: ['office', 'remote'],
            default: 'office',
        },
        autoClockOut: {
            type: Boolean,
            default: false,
        },
        isLate: {
            type: Boolean,
            default: false,
        },
        adminRemarks: {
            type: String,
            default: null,
        },
    },
    { timestamps: true }
);

attendanceSchema.index({ userId: 1, date: -1 });
attendanceSchema.index({ userId: 1, date: 1, clockOutMs: 1 });
attendanceSchema.index({ userId: 1, clockOutMs: 1, clockInMs: -1 });
attendanceSchema.index({ date: -1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
