const userModel = require('../model/user.model')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')



async function loginUser(req, res) {



    try {

        const { email, password } = req.body

        if (!email || !password) {
            return res.status(400).json({
                message: "All fields are required",
            });
        }

        const existingUser = await userModel.findOne({ email });

        if (!existingUser) {
            return res.status(401).json({
                message: "Invalid email or password",
            });
        }

        const passwordIsMatch = await bcrypt.compare(password, existingUser.password)

        if (!passwordIsMatch) {

            return res.status(401).json({ message: "Invalid email or password" })

        }

        const token = await jwt.sign(
            {
                userId: existingUser._id,
                role: existingUser.role
            },

            process.env.JWT_TOKEN,
            {
                expiresIn: '1d'
            }
        )

        return res.status(200).json({
  message: "Login successful",
  token,
  user: {
    id: existingUser._id,
    userName: existingUser.userName,
    email: existingUser.email,
    role: existingUser.role,
  },
});
    } catch (error) {

        return res.status(500).json({
            message: "Internal server error"
        });

    }



}


module.exports = { loginUser }