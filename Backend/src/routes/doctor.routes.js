import { Router } from "express";
import { updateDoctorProfile , getAvailableDoctors ,getCurrentDoctorProfile} from "../controllers/doctor.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();
router.use(verifyJWT);

router.patch("/profile", updateDoctorProfile);
router.get("/getdrprofile",getCurrentDoctorProfile);
router.get("/getalldoctors", getAvailableDoctors);

export default router;