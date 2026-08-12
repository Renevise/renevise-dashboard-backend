const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    userName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,

    },

    role: {
      type: String,
      enum: ["admin", "employee"],
      default: "employee",
    },

    department: {
      type: String,
      enum: ["ServiceNow", "Web Development", "App Development", "AI Content Creation"],
      default: null,
    },

    resetOtp: {
      type: String,
      default: null,
    },

    resetOtpExpiry: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);
const userModel=mongoose.model('User',userSchema)
module.exports =userModel