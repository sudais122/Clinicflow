import { Router } from "express";
import {
  registerDoctor,
  registerPatient,
  login,
  refreshAccessToken,
  logout,
} from "../controllers/auth.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();

// Public Routes
router.post("/register-doctor", registerDoctor);
router.post("/register-patient", registerPatient);
router.post("/login", login);
router.post("/refresh-token", refreshAccessToken);

// Protected Routes
router.post("/logout", verifyJWT, logout);

export default router;