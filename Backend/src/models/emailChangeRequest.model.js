import mongoose from "mongoose";

const emailChangeRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    newEmail: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    otpHash: {
        type: String,
        required: true
    },
    otpExpiresAt: {
        type: Date,
        required: true
    },
    attempts: {
        type: Number,
        default: 0 
    },
  },
  { timestamps: true },
);

export const EmailChangeRequest = mongoose.model(
  "EmailChangeRequest",
  emailChangeRequestSchema,
);
