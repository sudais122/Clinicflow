import { Router } from "express";
import {
  forgotPassword,
  resendOtp,
  verifyResetOtp,
  resetPassword,
} from "../controllers/Forgotpassword.controller.js";

const router = Router();

router.post("/forgot-password", forgotPassword);
router.post("/resend-otp", resendOtp);
router.post("/verify-otp", verifyResetOtp);
router.post("/reset-password", resetPassword);

export default router;
