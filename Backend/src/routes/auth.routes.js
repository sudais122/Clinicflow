import { Router } from "express";
import {
  registerDoctor,
  registerPatient,
  login,
  refreshAccessToken,
  logout,
} from "../controllers/auth.controller.js";

import {
  loginLimiter,
  registerLimiter,
  refreshTokenLimiter,
  logoutLimiter,
} from "../middlewares/Ratelimiter.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();

// Public Routes
router.post("/register-doctor", registerLimiter, registerDoctor);
router.post("/register-patient", registerLimiter, registerPatient);
router.post("/login", loginLimiter, login);
router.post("/refresh-token", refreshTokenLimiter, refreshAccessToken);

// Protected Routes
router.post("/logout", verifyJWT, logoutLimiter, logout);

export default router;
