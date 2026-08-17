function snowWebhookAuth(req, res, next) {
    const provided = req.headers['x-snow-webhook-secret'];
    const expected = process.env.SERVICENOW_WEBHOOK_SECRET;

    if (!expected) {
        console.error('[SnowWebhook] SERVICENOW_WEBHOOK_SECRET not set in environment');
        return res.status(500).json({ message: 'Webhook not configured on server' });
    }

    if (!provided || provided !== expected) {
        console.warn('[SnowWebhook] Unauthorized request — invalid or missing X-Snow-Webhook-Secret');
        return res.status(401).json({ message: 'Unauthorized' });
    }

    next();
}

module.exports = snowWebhookAuth;
