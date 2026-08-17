const express    = require('express');
const leaveRoute = express.Router();
const { applyLeave, getMyLeaves, getAllLeaves, reviewLeave, snowWebhookHandler } = require('../controller/leave.controller');
const authenticate    = require('../middleware/authenticate');
const authorize       = require('../middleware/authorize');
const snowWebhookAuth = require('../middleware/snowWebhookAuth');

leaveRoute.post('/',               authenticate,                     applyLeave);
leaveRoute.get('/my',              authenticate,                     getMyLeaves);
leaveRoute.get('/all',             authenticate, authorize('admin'), getAllLeaves);
leaveRoute.patch('/:id/review',    authenticate, authorize('admin'), reviewLeave);
leaveRoute.post('/snow-webhook',   snowWebhookAuth,                  snowWebhookHandler);

module.exports = leaveRoute;
