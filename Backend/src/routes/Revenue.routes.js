import { Router } from "express";
import { getRevenue } from "../controllers/Revenue.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();
router.use(verifyJWT);

router.get("/", getRevenue);

export default router;