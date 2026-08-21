const express = require('express')
const profileRoute = express.Router()
const authenticate = require('../middleware/authenticate')
const upload = require('../middleware/upload')
const { getProfile, updateProfile, changePassword, uploadPicture } = require('../controller/profile.controller')

profileRoute.get('/', authenticate, getProfile)
profileRoute.put('/', authenticate, updateProfile)
profileRoute.put('/password', authenticate, changePassword)
profileRoute.post('/picture', authenticate, upload.single('profilePicture'), uploadPicture)

module.exports = profileRoute
