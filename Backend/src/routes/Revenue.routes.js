import { Router } from "express";
import { getRevenue } from "../controllers/Revenue.controller.js";
import { getRevenueAnalytics } from "../controllers/analytics.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();
router.use(verifyJWT);

router.get("/", getRevenue);
router.get("/analytics", getRevenueAnalytics);

export default router;