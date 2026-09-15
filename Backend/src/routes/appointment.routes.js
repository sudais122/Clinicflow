import { Router } from "express";
import {
  bookAppointment,
  getPatientAppointments,
  getDoctorAppointments,
  updateAppointmentStatus,
  cancelAppointment,
  markAppointmentPaid,
  getMonthlySummary
} from "../controllers/appointment.controller.js";
import {
  appointmentBookLimiter,
  appointmentCancelLimiter,
  appointmentStatusLimiter
 } from "../middlewares/Ratelimiter.js";

import { getAppointmentAnalytics } from "../controllers/Analytics.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";
const router = Router();
router.use(verifyJWT);

// Patient-facing
router.post("/book", appointmentBookLimiter, bookAppointment);
router.get("/patient", getPatientAppointments);
router.patch("/:appointmentId/cancel", appointmentCancelLimiter, cancelAppointment);

// Doctor-facing
router.get("/doctor", getDoctorAppointments);
router.get("/analytics", getAppointmentAnalytics);
router.patch("/:appointmentId/status", appointmentStatusLimiter, updateAppointmentStatus);
router.patch("/:appointmentId/pay", appointmentStatusLimiter, markAppointmentPaid);
router.get("/monthly-summary", verifyJWT, getMonthlySummary);

export default router;