import { Router } from "express";
import { updatePatientProfile } from "../controllers/patient.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();
router.use(verifyJWT);

router.patch("/profile", updatePatientProfile);

export default router;