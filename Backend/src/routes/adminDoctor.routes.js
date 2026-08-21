import { Router } from "express";

import {
  getDoctors,
  getDoctorDetails,
  getDoctorAppointments,
  approveDoctor,
  activateDoctor,
  deactivateDoctor,
  suspendDoctor,
  unsuspendDoctor,
} from "../controllers/adminControllers/adminDoctor.controller.js";

import { verifyJWT } from "../middlewares/auth.middlewares.js";
import { isAdmin } from "../middlewares/admin.middlewares.js";

const router = Router();

router.use(verifyJWT, isAdmin);

router.get("/", getDoctors);
router.get("/:doctorId", getDoctorDetails);
router.get("/:doctorId/appointments", getDoctorAppointments);
router.patch("/:doctorId/approve", approveDoctor);
router.patch("/:doctorId/activate", activateDoctor);
router.patch("/:doctorId/deactivate", deactivateDoctor);
router.patch("/:doctorId/suspend", suspendDoctor);
router.patch("/:doctorId/unsuspend", unsuspendDoctor);

export default router;