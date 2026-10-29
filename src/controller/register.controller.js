const userModel = require("../model/user.model");
const bcrypt = require('bcrypt');
const { resolveUniqueUserName } = require('../utils/username');

async function checkSetupStatus(req, res) {
  try {
    const adminExists = await userModel.exists({ role: 'admin' });
    return res.status(200).json({ adminExists: !!adminExists });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function registerUser(req, res) {
  try {
    const adminExists = await userModel.exists({ role: 'admin' });
    if (adminExists) {
      return res.status(403).json({ message: "Admin account already exists. Please login." });
    }

    const { firstName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingEmail = await userModel.findOne({ email });
    if (existingEmail) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const userName = await resolveUniqueUserName(firstName, lastName, userModel);
    const hashPassword = await bcrypt.hash(password, 10);

    await userModel.create({
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      userName,
      email,
      password:  hashPassword,
      role:      'admin',
    });

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { registerUser, checkSetupStatus };
