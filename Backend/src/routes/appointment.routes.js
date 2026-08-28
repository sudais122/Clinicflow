import { Router } from "express";
import {
  bookAppointment,
  getPatientAppointments,
  getDoctorAppointments,
  updateAppointmentStatus,
  cancelAppointment,
  markAppointmentPaid,
} from "../controllers/appointment.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";
import { enforceDailyTokenLimit } from "../middlewares/Tokenlimit.middleware.js";

const router = Router();
router.use(verifyJWT);

// Patient-facing
router.post("/book", enforceDailyTokenLimit, bookAppointment);
router.get("/patient", getPatientAppointments);
router.patch("/:appointmentId/cancel", cancelAppointment);

// Doctor-facing
router.get("/doctor", getDoctorAppointments);
router.patch("/:appointmentId/status", updateAppointmentStatus);
router.patch("/:appointmentId/pay", markAppointmentPaid);

export default router;