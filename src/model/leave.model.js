const mongoose = require('mongoose');

const leaveSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        employee: { type: String, required: true },
        email:    { type: String, required: true },
        leaveType:{ type: String, required: true },
        fromDate: { type: String, required: true },
        untilDate:{ type: String, required: true },
        days:     { type: Number, required: true },
        reason:   { type: String, required: true },
        status: {
            type: String,
            enum: ['Pending', 'Approved', 'Rejected', 'Expired'],
            default: 'Pending',
        },
        reviewedBy:    { type: String,   default: null },
        reviewedAt:    { type: Date,     default: null },
        remindersSent: { type: [String], default: [] },
        snowLeaveId:   { type: String, default: null },
        departureTime: { type: String, default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Leave', leaveSchema);
