const express    = require('express');
const router     = express.Router();
const {
    submitCorrection,
    getMyCorrections,
    getAllCorrections,
    reviewCorrection,
} = require('../controller/attendance-correction.controller');
const authenticate = require('../middleware/authenticate');
const authorize    = require('../middleware/authorize');

router.post('/',             authenticate,                    submitCorrection);
router.get('/my',            authenticate,                    getMyCorrections);
router.get('/all',           authenticate, authorize('admin'), getAllCorrections);
router.patch('/:id/review',  authenticate, authorize('admin'), reviewCorrection);

module.exports = router;
