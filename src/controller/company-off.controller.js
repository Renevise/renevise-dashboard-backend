const CompanyOffModel   = require('../model/company-off.model');
const UserModel         = require('../model/user.model');
const NotificationModel = require('../model/notification.model');
const { sendCompanyOffEmail } = require('../services/email.service');

function humanDate(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        day: 'numeric', month: 'long', year: 'numeric',
    });
}

async function fanoutToEmployees(companyOff) {
    const employees = await UserModel.find({ role: 'employee' }).select('email userName');
    if (employees.length === 0) return;

    const fromLabel  = humanDate(companyOff.fromDate);
    const untilLabel = humanDate(companyOff.untilDate);
    const isSingleDay = companyOff.fromDate === companyOff.untilDate;

    const title   = 'Company Off Announced';
    const message = isSingleDay
        ? `Company off on ${fromLabel}. Reason: ${companyOff.reason}`
        : `Company off from ${fromLabel} to ${untilLabel}. Reason: ${companyOff.reason}`;

    await NotificationModel.insertMany(
        employees.map(emp => ({
            userId      : emp._id,
            companyOffId: companyOff._id,
            type        : 'company_off',
            title,
            message,
        }))
    );

    for (const emp of employees) {
        sendCompanyOffEmail({
            to          : emp.email,
            employeeName: emp.userName,
            fromDate    : fromLabel,
            untilDate   : untilLabel,
            reason      : companyOff.reason,
        }).catch(err =>
            console.error(`[CompanyOff] Email to ${emp.email} failed:`, err.message)
        );
    }
}

async function createCompanyOff(req, res) {
    try {
        const { fromDate, untilDate, reason } = req.body;

        if (!fromDate || !untilDate || !reason?.trim()) {
            return res.status(400).json({ message: 'fromDate, untilDate, and reason are required' });
        }
        if (untilDate < fromDate) {
            return res.status(400).json({ message: 'Until date must be on or after from date' });
        }

        const overlap = await CompanyOffModel.findOne({
            fromDate : { $lte: untilDate },
            untilDate: { $gte: fromDate },
        });
        if (overlap) {
            return res.status(409).json({
                message: `Company off already exists for overlapping dates: ${overlap.fromDate} to ${overlap.untilDate}`,
            });
        }

        const companyOff = await CompanyOffModel.create({
            fromDate,
            untilDate,
            reason: reason.trim(),
            createdBy: req.user.userId,
        });

        fanoutToEmployees(companyOff).catch(err =>
            console.error('[CompanyOff] Notification/email fanout failed:', err.message)
        );

        return res.status(201).json({ message: 'Company off created successfully', companyOff });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function getCompanyOffs(req, res) {
    try {
        const companyOffs = await CompanyOffModel.find().sort({ fromDate: -1 });
        return res.status(200).json({ companyOffs });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

async function deleteCompanyOff(req, res) {
    try {
        const { id } = req.params;
        const record = await CompanyOffModel.findByIdAndDelete(id);
        if (!record) return res.status(404).json({ message: 'Company off record not found' });
        return res.status(200).json({ message: 'Company off deleted successfully' });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error', error: error.message });
    }
}

module.exports = { createCompanyOff, getCompanyOffs, deleteCompanyOff };
