const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
    {
        userId      : { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
        leaveId     : { type: mongoose.Schema.Types.ObjectId, ref: 'Leave',    default: null },
        overtimeId  : { type: mongoose.Schema.Types.ObjectId, ref: 'Overtime', default: null },
        correctionId: { type: mongoose.Schema.Types.ObjectId, default: null },
        companyOffId: { type: mongoose.Schema.Types.ObjectId, default: null },
        clientOffId : { type: mongoose.Schema.Types.ObjectId, default: null },
        title       : { type: String, required: true },
        message     : { type: String, required: true },
        type        : {
            type: String,
            enum: [
                'leave_approved', 'leave_rejected',
                'correction_approved', 'correction_rejected',
                'overtime_approved', 'overtime_rejected',
                'company_off',
                'client_off_approved', 'client_off_rejected',
            ],
            required: true,
        },
        read: { type: Boolean, default: false },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
