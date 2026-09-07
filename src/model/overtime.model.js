const mongoose = require('mongoose');

const overtimeSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        employee: { type: String, required: true },
        email: { type: String, required: true },
        onBehalf: { type: String, default: '' },
        requestedFor: { type: String, required: true },
        requestedForId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        date: { type: String, required: true },
        extraHours: { type: Number, required: true },
        reason: { type: String, required: true },
        status: {
            type: String,
            enum: ['Pending', 'Approved', 'Rejected', 'Expired'],
            default: 'Pending',
        },
        reviewedBy:     { type: String,   default: null },
        reviewedAt:     { type: Date,     default: null },
        remindersSent:  { type: [String], default: [] },
        snowOvertimeId: { type: String, default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Overtime', overtimeSchema);
