const userModel = require('../model/user.model');
const bcrypt    = require('bcrypt');
const { sendOtpEmail } = require('../services/email.service');

function generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtp(req, res) {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Email is required' });

        const user = await userModel.findOne({ email: email.toLowerCase().trim() });

        if (user) {
            const otp        = generateOtp();
            const hashedOtp  = await bcrypt.hash(otp, 10);
            const expiry     = new Date(Date.now() + 10 * 60 * 1000); 

            user.resetOtp       = hashedOtp;
            user.resetOtpExpiry = expiry;
            await user.save();
            console.log('[ForgotPw] OTP saved to DB. Attempting email delivery...');

            try {
                await sendOtpEmail({ to: user.email, employeeName: user.userName, otp });
            } catch (emailErr) {
                console.error('[ForgotPw] sendOtpEmail threw:', emailErr.message);
            }
        } else {
            console.log('[ForgotPw] No user found for the provided email (not logged to client).');
        }

        return res.status(200).json({ message: 'If this email is registered, an OTP has been sent.' });
    } catch (error) {
        console.error('sendOtp error:', error.message);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function verifyOtp(req, res) {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

        const user = await userModel.findOne({ email: email.toLowerCase().trim() });
        if (!user || !user.resetOtp || !user.resetOtpExpiry) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        if (new Date() > user.resetOtpExpiry) {
            user.resetOtp       = null;
            user.resetOtpExpiry = null;
            await user.save();
            return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
        }

        const isMatch = await bcrypt.compare(String(otp), user.resetOtp);
        if (!isMatch) {
            return res.status(400).json({ message: 'Incorrect OTP. Please try again.' });
        }

        return res.status(200).json({ message: 'OTP verified successfully.' });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

async function resetPassword(req, res) {
    try {
        const { email, otp, newPassword } = req.body;
        if (!email || !otp || !newPassword) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }

        const user = await userModel.findOne({ email: email.toLowerCase().trim() });
        if (!user || !user.resetOtp || !user.resetOtpExpiry) {
            return res.status(400).json({ message: 'Invalid or expired OTP. Please restart the process.' });
        }

        if (new Date() > user.resetOtpExpiry) {
            user.resetOtp       = null;
            user.resetOtpExpiry = null;
            await user.save();
            return res.status(400).json({ message: 'OTP has expired. Please request a new one.' });
        }

        const isMatch = await bcrypt.compare(String(otp), user.resetOtp);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid OTP. Please restart the process.' });
        }

        user.password       = await bcrypt.hash(newPassword, 10);
        user.resetOtp       = null;
        user.resetOtpExpiry = null;
        await user.save();

        return res.status(200).json({ message: 'Password reset successfully. You can now sign in.' });
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports = { sendOtp, verifyOtp, resetPassword };
