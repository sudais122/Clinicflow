import { Router } from "express";
import { updateDoctorProfile } from "../controllers/doctor.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();
router.use(verifyJWT);

router.patch("/profile", updateDoctorProfile);

export default router;