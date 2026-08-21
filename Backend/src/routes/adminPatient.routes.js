import { Router } from "express";

import {
  getPatients,
  getPatientDetails,
  getPatientAppointments,
  activatePatient,
  disablePatient,
} from "../controllers/adminControllers/adminPatient.controller.js";

import { verifyJWT } from "../middlewares/auth.middlewares.js";
import { isAdmin } from "../middlewares/admin.middlewares.js";

const router = Router();

router.use(verifyJWT, isAdmin);

router.get("/", getPatients);
router.get("/:patientId", getPatientDetails);
router.get("/:patientId/appointments", getPatientAppointments);
router.patch("/:patientId/activate", activatePatient);
router.patch("/:patientId/disable", disablePatient);

export default router;