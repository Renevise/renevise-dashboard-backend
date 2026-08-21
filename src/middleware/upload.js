const multer = require('multer')
const path = require('path')
const fs = require('fs')

const profileUploadDir = path.join(__dirname, '../../uploads/profile')

if (!fs.existsSync(profileUploadDir)) {
    fs.mkdirSync(profileUploadDir, { recursive: true })
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, profileUploadDir)
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase()
        cb(null, `profile-${req.user.userId}-${Date.now()}${ext}`)
    },
})

function fileFilter(_req, file, cb) {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
    if (allowed.includes(file.mimetype)) {
        cb(null, true)
    } else {
        cb(new Error('Only image files are allowed (JPEG, PNG, WebP, GIF)'), false)
    }
}

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter,
})

module.exports = upload
