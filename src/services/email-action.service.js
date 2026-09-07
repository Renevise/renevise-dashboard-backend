const jwt = require('jsonwebtoken');

function getSecret() {
    if (!process.env.EMAIL_ACTION_SECRET) {
        throw new Error('EMAIL_ACTION_SECRET is not set');
    }
    return process.env.EMAIL_ACTION_SECRET;
}

function generateActionToken({ requestType, requestId, action, adminId }) {
    return jwt.sign(
        {
            type       : 'email_action',
            requestType: String(requestType),
            requestId  : String(requestId),
            action     : String(action),
            adminId    : String(adminId),
        },
        getSecret(),
        { expiresIn: '48h' }
    );
}

function verifyActionToken(token) {
    const payload = jwt.verify(token, getSecret());
    if (payload.type !== 'email_action') {
        const err = new Error('Invalid token type');
        err.name  = 'InvalidTokenType';
        throw err;
    }
    return payload;
}

module.exports = { generateActionToken, verifyActionToken };
