import { Router } from "express";
import { submitPayment, getMyPayments } from "../controllers/Payment.controller.js";
import { uploadScreenshot } from "../middlewares/Multer.middleware.js";
import { verifyJWT } from "../middlewares/auth.middlewares.js";

const router = Router();

// POST /payments        — submit a payment proof (multipart/form-data)
// GET  /payments/me      — this doctor's own payment history
router.post("/", verifyJWT, uploadScreenshot, submitPayment);
router.get("/me", verifyJWT, getMyPayments);

export default router;