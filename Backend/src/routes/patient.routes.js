import { Router } from "express";
import { updatePatientProfile ,getCurrentUser} from "../controllers/patient.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();
router.use(verifyJWT);

router.patch("/profile", updatePatientProfile);
router.get("/me", verifyJWT, getCurrentUser);

export default router;