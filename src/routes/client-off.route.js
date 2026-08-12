const express        = require('express');
const clientOffRoute = express.Router();
const {
    submitClientOff,
    getMyClientOffs,
    getAllClientOffs,
    reviewClientOff,
} = require('../controller/client-off.controller');
const authenticate = require('../middleware/authenticate');
const authorize    = require('../middleware/authorize');

clientOffRoute.post('/',            authenticate,                    submitClientOff);
clientOffRoute.get('/my',           authenticate,                    getMyClientOffs);
clientOffRoute.get('/all',          authenticate, authorize('admin'), getAllClientOffs);
clientOffRoute.patch('/:id/review', authenticate, authorize('admin'), reviewClientOff);

module.exports = clientOffRoute;
