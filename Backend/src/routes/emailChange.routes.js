import { Router } from "express";
import {
  requestEmailChange,
  verifyEmailChange,
} from "../controllers/emailChange.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();
router.use(verifyJWT);

router.post("/request", requestEmailChange);
router.post("/verify", verifyEmailChange);

export default router;