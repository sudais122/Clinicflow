import { Router } from "express";

import {
  getSubscriptions,
  getSubscriptionDetails,
  extendSubscription,
  changeSubscriptionPlan,
} from "../controllers/adminControllers/adminSubscription.controller.js";

import { verifyJWT } from "../middlewares/auth.middlewares.js";
import { isAdmin } from "../middlewares/admin.middlewares.js";

const router = Router();

router.use(verifyJWT, isAdmin);

router.get("/", getSubscriptions);
router.get("/:subscriptionId", getSubscriptionDetails);
router.patch("/:subscriptionId/extend", extendSubscription);
router.patch("/:subscriptionId/plan", changeSubscriptionPlan);

export default router;