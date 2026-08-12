const express      = require('express');
const router       = express.Router();
const authenticate = require('../middleware/authenticate');
const authorize    = require('../middleware/authorize');
const {
    createCompanyOff,
    getCompanyOffs,
    deleteCompanyOff,
} = require('../controller/company-off.controller');

router.get('/',       authenticate,                    getCompanyOffs);
router.post('/',      authenticate, authorize('admin'), createCompanyOff);
router.delete('/:id', authenticate, authorize('admin'), deleteCompanyOff);

module.exports = router;
