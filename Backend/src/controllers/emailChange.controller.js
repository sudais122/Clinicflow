import bcrypt from "bcrypt";
import crypto from "crypto";

import { User } from "../models/user.models.js";
import { EmailChangeRequest } from "../models/emailChangeRequest.model.js";
import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";
import { sendEmail } from "../utils/sendemail.js";
import { emailChangeOtpTemplate } from "../utils/email/emailChangeOtp.js";

const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;

// POST /auth/email/request
const requestEmailChange = async (req, res, next) => {
  try {
    const { newEmail } = req.body;

    if (!newEmail || !newEmail.trim()) {
      throw new ApiError(400, "New email is required");
    }

    const email = newEmail.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError(400, "Please enter a valid email address");
    }

    if (email === req.user.email) {
      throw new ApiError(400, "This is already your current email");
    }

    const existing = await User.findOne({ email });
    if (existing) {
      throw new ApiError(409, "This email is already in use");
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Replace any existing pending request for this user.
    await EmailChangeRequest.findOneAndUpdate(
      { user: req.user._id },
      { newEmail: email, otpHash, otpExpiresAt, attempts: 0 },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await sendEmail({
      to: email,
      subject: "Confirm your new ClinicFlow email",
      html: emailChangeOtpTemplate({
        otp,
        newEmail: email,
        expiryMinutes: OTP_EXPIRY_MINUTES,
      }),
    });

    return res
      .status(200)
      .json(
        new ApiResponse(200, { newEmail: email }, "Verification code sent"),
      );
  } catch (error) {
    next(error);
  }
};

// POST /auth/email/verify
const verifyEmailChange = async (req, res, next) => {
  try {
    const { otp } = req.body;

    if (!otp) {
      throw new ApiError(400, "OTP is required");
    }

    const request = await EmailChangeRequest.findOne({ user: req.user._id });

    if (!request) {
      throw new ApiError(404, "No pending email change request found");
    }

    if (request.otpExpiresAt < new Date()) {
      await request.deleteOne();
      throw new ApiError(400, "OTP has expired. Please request a new one");
    }

    if (request.attempts >= MAX_ATTEMPTS) {
      await request.deleteOne();
      throw new ApiError(400, "Too many attempts. Please request a new code");
    }

    const isMatch = await bcrypt.compare(String(otp), request.otpHash);

    if (!isMatch) {
      request.attempts += 1;
      await request.save();
      throw new ApiError(400, "Invalid OTP");
    }

    // Re-check uniqueness in case someone else grabbed it meanwhile.
    const stillFree = await User.findOne({ email: request.newEmail });
    if (stillFree) {
      await request.deleteOne();
      throw new ApiError(409, "This email is already in use");
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { email: request.newEmail } },
      { new: true },
    ).select("fullname email phone role");

    await request.deleteOne();

    return res
      .status(200)
      .json(new ApiResponse(200, updatedUser, "Email updated successfully"));
  } catch (error) {
    next(error);
  }
};

export { requestEmailChange, verifyEmailChange };