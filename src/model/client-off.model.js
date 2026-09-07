const mongoose = require('mongoose');

const clientOffSchema = new mongoose.Schema(
    {
        userId: {
            type    : mongoose.Schema.Types.ObjectId,
            ref     : 'User',
            required: true,
        },
        employeeName : { type: String, required: true },
        employeeEmail: { type: String, required: true },
        department   : { type: String, required: true },
        date         : { type: String, required: true }, 
        reason       : { type: String, required: true },
        status: {
            type   : String,
            enum   : ['Pending', 'Approved', 'Rejected', 'Expired'],
            default: 'Pending',
        },
        reviewedBy:    { type: String,   default: null },
        reviewedAt:    { type: Date,     default: null },
        remindersSent: { type: [String], default: [] },
    },
    { timestamps: true }
);

module.exports = mongoose.model('ClientOff', clientOffSchema);
