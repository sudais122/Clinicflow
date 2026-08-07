import { Router } from "express";
import { getDoctorDashboard } from "../controllers/doctorDashboard.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();
router.use(verifyJWT);

router.get("/doctor", getDoctorDashboard);

export default router;