import { Router } from "express";
import { submitReport, getMyReports } from "../controllers/report.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();
router.use(verifyJWT);

router.post("/report", submitReport);
router.get("/report/me", getMyReports);

export default router;