const mongoose = require('mongoose');

const companyOffSchema = new mongoose.Schema(
    {
        fromDate:  { type: String, required: true },
        untilDate: { type: String, required: true },
        reason:    { type: String, required: true },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    },
    { timestamps: true }
);

module.exports = mongoose.model('CompanyOff', companyOffSchema);
