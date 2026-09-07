const express = require('express');
const router  = express.Router();
const { showConfirmPage, processAction } = require('../controller/email-action.controller');

router.get('/',  showConfirmPage);
router.post('/', processAction);

module.exports = router;
