const userModel = require("../model/user.model");
const bcrypt = require('bcrypt')

async function checkSetupStatus(req, res) {
  try {
    const adminExists = await userModel.exists({ role: 'admin' })
    return res.status(200).json({ adminExists: !!adminExists })
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" })
  }
}

async function registerUser(req, res) {
  try {
    const adminExists = await userModel.exists({ role: 'admin' })

    if (adminExists) {
      return res.status(403).json({
        message: "Admin account already exists. Please login.",
      })
    }

    const { userName, email, password } = req.body;

    if (!userName || !email || !password) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const existingEmail = await userModel.findOne({ email });

    if (existingEmail) {
      return res.status(409).json({
        message: "Email already exists",
      });
    }

    const hashPassword = await bcrypt.hash(password, 10)

    await userModel.create({
      userName,
      email,
      password: hashPassword,
      role: 'admin',
    });

    res.status(201).json({
      message: "User registered successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
}

module.exports = { registerUser, checkSetupStatus };
