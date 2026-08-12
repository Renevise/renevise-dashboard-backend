const express    = require('express');
const router     = express.Router();
const {
    submitOvertime,
    getMyOvertimes,
    getAllOvertimes,
    reviewOvertime,
} = require('../controller/overtime.controller');
const authenticate = require('../middleware/authenticate');
const authorize    = require('../middleware/authorize');

router.post('/',            authenticate,                    submitOvertime);
router.get('/my',           authenticate,                    getMyOvertimes);
router.get('/all',          authenticate, authorize('admin'), getAllOvertimes);
router.patch('/:id/review', authenticate, authorize('admin'), reviewOvertime);

module.exports = router;
