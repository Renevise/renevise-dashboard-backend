const express    = require('express');
const leaveRoute = express.Router();
const { applyLeave, getMyLeaves, getAllLeaves, reviewLeave } = require('../controller/leave.controller');
const authenticate = require('../middleware/authenticate');
const authorize    = require('../middleware/authorize');

leaveRoute.post('/',              authenticate,                    applyLeave);
leaveRoute.get('/my',             authenticate,                    getMyLeaves);
leaveRoute.get('/all',            authenticate, authorize('admin'), getAllLeaves);
leaveRoute.patch('/:id/review',   authenticate, authorize('admin'), reviewLeave);

module.exports = leaveRoute;
