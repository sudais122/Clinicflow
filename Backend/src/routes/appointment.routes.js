import { Router } from "express";
import {
  bookAppointment,
  getPatientAppointments,
  getDoctorAppointments,
  updateAppointmentStatus,
  cancelAppointment,
} from "../controllers/appointment.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();

// All appointment routes require a logged-in user.
router.use(verifyJWT);

// Patient
router.post("/book", bookAppointment);
router.get("/patient", getPatientAppointments);
router.patch("/:appointmentId/cancel", cancelAppointment);

// Doctor
router.get("/doctor", getDoctorAppointments);
router.patch("/:appointmentId/status", updateAppointmentStatus);

export default router;