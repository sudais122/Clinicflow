import { Router } from "express";
import {
  adminLogin,
  adminLogout,
  getCurrentAdmin,
} from "../controllers/adminauth.controller.js";

import {
  getAllDoctors,
  getAllPatients,
  getAllAppointments,
  getAllSubscriptions,
  getAdminDashboard,
  deactivateUser,
  activateUser 
} from "../controllers/admin.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";
import { isAdmin } from "../middlewares/admin.middlewares.js";

const router = Router();

// Public: admin login
router.post("/login", adminLogin);

router.use(verifyJWT);
router.use(isAdmin);

router.post("/logout", adminLogout);
router.get("/me", getCurrentAdmin);

router.get("/doctors", getAllDoctors);
router.get("/patients", getAllPatients);
router.get("/appointments", getAllAppointments);
router.get("/subscriptions", getAllSubscriptions);
router.get("/dashboard", getAdminDashboard);
router.patch("/users/:userId/deactivate", deactivateUser);
router.patch("/users/:userId/activate", activateUser);

export default router;