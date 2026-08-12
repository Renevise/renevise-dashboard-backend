const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const { getMyNotifications, markAsRead, markAllAsRead } = require('../controller/notification.controller');

router.get('/',              authenticate, getMyNotifications);
router.patch('/read-all',    authenticate, markAllAsRead);
router.patch('/:id/read',    authenticate, markAsRead);

module.exports = router;
