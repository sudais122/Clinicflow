import crypto from "crypto";

import { User } from "../models/user.models.js";
import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";
import { sendEmail, otpEmailTemplate } from "../utils/sendemail.js";

const OTP_TTL_MS = 60 * 1000;        
const RESEND_COOLDOWN_MS = 30 * 1000; 

const hashOtp = (otp) =>
  crypto.createHash("sha256").update(otp).digest("hex");

// Create a fresh OTP, save it hashed with a 1-min expiry, and email it
const issueOtp = async (user) => {
  const otp = String(crypto.randomInt(100000, 1000000)); 

  user.resetOtp = hashOtp(otp);
  user.resetOtpExpiry = new Date(Date.now() + OTP_TTL_MS);
  user.resetOtpLastSent = new Date();
  await user.save({ validateBeforeSave: false });

  await sendEmail({
    to: user.email,
    subject: "PatientFlow — Password Reset Code",
    html: otpEmailTemplate(otp),
  });
};

//POST /auth/forgot-password  
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      throw new ApiError(400, "Email is required");
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      await issueOtp(user);
    }

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          {},
          "If that email is registered, a reset code has been sent",
        ),
      );
  } catch (error) {
    next(error);
  }
};

//POST /auth/resend-otp   
const resendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      throw new ApiError(400, "Email is required");
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (
        user.resetOtpLastSent &&
        Date.now() - user.resetOtpLastSent.getTime() < RESEND_COOLDOWN_MS
      ) {
        const waitMs =
          RESEND_COOLDOWN_MS - (Date.now() - user.resetOtpLastSent.getTime());
        const waitSec = Math.ceil(waitMs / 1000);
        throw new ApiError(
          429,
          `Please wait ${waitSec}s before requesting another code`,
        );
      }

      await issueOtp(user);
    }

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          {},
          "If that email is registered, a new reset code has been sent",
        ),
      );
  } catch (error) {
    next(error);
  }
};

//POST /auth/verify-otp  
const verifyResetOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      throw new ApiError(400, "Email and OTP are required");
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (
      !user ||
      !user.resetOtp ||
      !user.resetOtpExpiry ||
      user.resetOtpExpiry < new Date()
    ) {
      throw new ApiError(400, "Invalid or expired OTP");
    }

    if (user.resetOtp !== hashOtp(String(otp))) {
      throw new ApiError(400, "Invalid or expired OTP");
    }

    return res
      .status(200)
      .json(new ApiResponse(200, {}, "OTP verified"));
  } catch (error) {
    next(error);
  }
};

//POST /auth/reset-password   
const resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      throw new ApiError(400, "Email, OTP and new password are required");
    }

    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_\-+=])[A-Za-z\d@$!%*?&#^()_\-+=]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      throw new ApiError(
        400,
        "Password must be at least 8 characters and contain uppercase, lowercase, number and special character",
      );
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (
      !user ||
      !user.resetOtp ||
      !user.resetOtpExpiry ||
      user.resetOtpExpiry < new Date()
    ) {
      throw new ApiError(400, "Invalid or expired OTP");
    }

    if (user.resetOtp !== hashOtp(String(otp))) {
      throw new ApiError(400, "Invalid or expired OTP");
    }

    user.password = newPassword;
    user.resetOtp = undefined;
    user.resetOtpExpiry = undefined;
    user.resetOtpLastSent = undefined;
    user.refreshToken = ""; 
    await user.save();

    return res
      .status(200)
      .json(new ApiResponse(200, {}, "Password reset successfully"));
  } catch (error) {
    next(error);
  }
};

export { forgotPassword, resendOtp, verifyResetOtp, resetPassword };