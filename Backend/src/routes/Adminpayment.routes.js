import { Router } from "express";
import {
  getAllPayments,
  getPendingPayments,
  approvePayment,
  rejectPayment,
} from "../controllers/Payment.controller.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";
import { isAdmin } from "../middlewares/admin.middlewares.js";

const router = Router();

// GET   /admin/payments            — all payments, optional ?status= filter
// GET   /admin/payments/pending    — shortcut for ?status=pending
// PATCH /admin/payments/:id/approve
// PATCH /admin/payments/:id/reject   body: { reason }
router.get("/", verifyJWT, isAdmin, getAllPayments);
router.get("/pending", verifyJWT, isAdmin, getPendingPayments);
router.patch("/:id/approve", verifyJWT, isAdmin, approvePayment);
router.patch("/:id/reject", verifyJWT, isAdmin, rejectPayment);

export default router;