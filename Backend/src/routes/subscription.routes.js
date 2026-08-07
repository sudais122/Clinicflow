import { Router } from "express";
import {
  getMySubscription,
  upgradeSubscription,
  renewSubscription,
  cancelSubscription,
} from "../controllers/subscription.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();
router.use(verifyJWT);

router.get("/me", getMySubscription);
router.patch("/upgrade", upgradeSubscription);
router.patch("/renew", renewSubscription);
router.patch("/cancel", cancelSubscription);

export default router;