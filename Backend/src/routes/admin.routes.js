import { Router } from "express";

import { adminLogin, adminLogout, getCurrentAdmin } from "../controllers/adminauth.controller.js";
import { getOverview } from "../controllers/adminControllers/admin.controller.js";
import { getProfile, updateProfile, changePassword } from "../controllers/adminControllers/adminProfile.controller.js";

import { verifyJWT } from "../middlewares/auth.middlewares.js";
import { isAdmin } from "../middlewares/admin.middlewares.js";

const router = Router();

router.post("/login", adminLogin);

router.use(verifyJWT, isAdmin);

router.post("/logout", adminLogout);
router.get("/me", getCurrentAdmin);

router.get("/overview", getOverview);

router.get("/profile", getProfile);
router.patch("/profile", updateProfile);
router.patch("/profile/password", changePassword);

export default router;