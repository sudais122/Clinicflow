import { Router } from "express";

import {
  getProblemReports,
  getProblemReportDetails,
  moveReportToReview,
  resolveProblemReport,
} from "../controllers/adminControllers/adminReport.controller.js";

import { verifyJWT } from "../middlewares/auth.middlewares.js";
import { isAdmin } from "../middlewares/admin.middlewares.js";

const router = Router();

router.use(verifyJWT, isAdmin);

router.get("/problems", getProblemReports);
router.get("/problems/:reportId", getProblemReportDetails);
router.patch("/problems/:reportId/review", moveReportToReview);
router.patch("/problems/:reportId/resolve", resolveProblemReport);

export default router;