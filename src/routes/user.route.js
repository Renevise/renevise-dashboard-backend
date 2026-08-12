const express = require('express')
const { registerUser, checkSetupStatus } = require('../controller/register.controller')
const { loginUser } = require('../controller/login.controller')
const { sendOtp, verifyOtp, resetPassword } = require('../controller/forgot-password.controller')
const route = express.Router()

route.get('/setup-status', checkSetupStatus)
route.post('/register', registerUser)
route.post('/login', loginUser)

route.post('/forgot-password', sendOtp)
route.post('/verify-otp',      verifyOtp)
route.post('/reset-password',  resetPassword)

module.exports = route
