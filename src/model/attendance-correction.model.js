const mongoose = require('mongoose');

const correctionSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        employee: { type: String, required: true },
        email: { type: String, required: true },
        date: { type: String, required: true },
        clockIn: { type: String, required: true },
        clockOut: { type: String, required: true },
        reason: { type: String, required: true },
        status: {
            type: String,
            enum: ['Pending', 'Approved', 'Rejected', 'Expired'],
            default: 'Pending',
        },
        reviewedBy:    { type: String,   default: null },
        reviewedAt:    { type: Date,     default: null },
        remindersSent: { type: [String], default: [] },
    },
    { timestamps: true }
);

module.exports = mongoose.model('AttendanceCorrection', correctionSchema);
