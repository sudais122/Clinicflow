import mongoose from "mongoose";
import { Doctor } from "../models/doctor.models.js"; // needed to resolve req.user._id (a User id) to the real Doctor document
import { Payment, PAID_PLANS, PAYMENT_METHODS } from "../models/Payment.models.js";
import { Subscription } from "../models/subscription.models.js"; // ADJUST path if different
import { uploadBufferToCloudinary } from "../utils/cloudinary.js";
import ApiResponse from "../utils/ApiResponse.js"; // ADJUST if this lives elsewhere

// Keep this in sync with whatever price you show on the Subscription
// page (the frontend's Practice plan shows PKR 4,500/month).
const PLAN_PRICES = {
  Practice: 4500,
};

// One Practice cycle, in days. Kept here and duplicated (with a note)
// in subscription.controller.js's DEFAULT_DURATION_DAYS — ADJUST:
// pull both from one shared constants module instead of keeping two
// copies in sync by hand.
const SUBSCRIPTION_DAYS = 30;

// req.user comes from the JWT/User account, NOT the Doctor document —
// Doctor has its own _id with a `user` ref back to the account (see
// subscription.controller.js's getDoctorSubscription, which does the
// same lookup). Every place below that needs a doctor id for
// Payment.doctor / Subscription.doctor must resolve through here
// first — using req.user._id directly was the actual root cause of
// the subscription never syncing: Payment.doctor was being set to a
// User id that doesn't exist in the Doctor collection at all, so
// approvePayment's Subscription lookup by payment.doctor could never
// match anything.
async function resolveDoctor(userId) {
  return Doctor.findOne({ user: userId });
}

/* ---------------- DOCTOR-FACING ---------------- */

// POST /payments  (doctor, multipart/form-data)
const submitPayment = async (req, res) => {
  try {
    const doctor = await resolveDoctor(req.user._id);
    if (!doctor) {
      return res
        .status(403)
        .json(new ApiResponse(403, null, "Only a doctor can submit a payment"));
    }
    const doctorId = doctor._id;
    const { plan, paymentMethod, transactionReference } = req.body;

    if (!PAID_PLANS.includes(plan)) {
      return res
        .status(400)
        .json(new ApiResponse(400, null, `Plan must be one of: ${PAID_PLANS.join(", ")}`));
    }
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      return res
        .status(400)
        .json(
          new ApiResponse(
            400,
            null,
            `Payment method must be one of: ${PAYMENT_METHODS.join(", ")}`,
          ),
        );
    }
    if (!req.file) {
      return res
        .status(400)
        .json(new ApiResponse(400, null, "Payment screenshot is required"));
    }

    // Block a second SIMULTANEOUS submission while one is still being
    // reviewed. Deliberately does NOT block submitting again just
    // because the doctor already has an active Practice subscription
    // — that's exactly what "Extend Subscription" is (see
    // approvePayment below, which extends rather than resets when the
    // existing subscription is still active and non-expired).
    const existingPending = await Payment.findOne({
      doctor: doctorId,
      status: "pending",
    });
    if (existingPending) {
      return res
        .status(409)
        .json(
          new ApiResponse(
            409,
            existingPending,
            "You already have a payment awaiting review.",
          ),
        );
    }

    const result = await uploadBufferToCloudinary(
      req.file.buffer,
      `clinicflow/payment-proofs/${doctorId}`,
    );

    const payment = await Payment.create({
      doctor: doctorId,
      plan,
      amount: PLAN_PRICES[plan],
      paymentMethod,
      transactionReference,
      screenshotUrl: result.secure_url,
      screenshotPublicId: result.public_id,
      status: "pending",
    });

    return res
      .status(201)
      .json(new ApiResponse(201, payment, "Payment submitted — awaiting admin review."));
  } catch (error) {
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

// GET /payments/me  (doctor)
const getMyPayments = async (req, res) => {
  try {
    const doctor = await resolveDoctor(req.user._id);
    if (!doctor) {
      return res
        .status(403)
        .json(new ApiResponse(403, null, "Only a doctor can view payments"));
    }
    const payments = await Payment.find({ doctor: doctor._id }).sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, payments, "Your payments"));
  } catch (error) {
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

/* ---------------- ADMIN-FACING ---------------- */

// GET /admin/payments?status=pending  (admin) — status is optional
const getAllPayments = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    // fullname/email live on the User document, not on Doctor itself
    // (Doctor only has a `user` ref) — nested-populate through it.
    // clinicName/doctorId ARE flat on Doctor, so those stay as before.
    const payments = await Payment.find(filter)
      .populate({
        path: "doctor",
        select: "clinicName doctorId user",
        populate: { path: "user", select: "fullname email" }, // ADJUST field names if your User schema differs
      })
      .sort({ createdAt: -1 });

    return res.status(200).json(new ApiResponse(200, payments, "Payments"));
  } catch (error) {
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

// GET /admin/payments/pending  (admin) — convenience shortcut
const getPendingPayments = async (req, res) => {
  req.query.status = "pending";
  return getAllPayments(req, res);
};

// PATCH /admin/payments/:id/approve  (admin)
//
// Runs as a MongoDB transaction — payment.status flips to "approved"
// and the Subscription is created/extended atomically, or neither
// happens. REQUIRES a replica set (standalone mongod does not support
// transactions).
//
// Fresh activation vs extension: if the doctor already has an active,
// non-expired paid Subscription, this EXTENDS it — endDate moves
// forward by SUBSCRIPTION_DAYS from its current endDate, startDate is
// left untouched. Otherwise it's a fresh activation starting now.
const approvePayment = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const { id } = req.params;
    const adminId = req.user._id;

    const payment = await Payment.findById(id).session(session);
    if (!payment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json(new ApiResponse(404, null, "Payment not found"));
    }
    if (payment.status !== "pending") {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(409)
        .json(new ApiResponse(409, payment, "Payment has already been processed."));
    }

    const now = new Date();

    const existing = await Subscription.findOne({ doctor: payment.doctor }).session(session);
    const isExtension =
      !!existing &&
      existing.plan === "paid" &&
      existing.status === "active" &&
      !!existing.endDate &&
      existing.endDate > now;

    const startDate = isExtension ? existing.startDate : now;
    const extendFrom = isExtension ? existing.endDate : now;
    const endDate = new Date(extendFrom);
    endDate.setDate(endDate.getDate() + SUBSCRIPTION_DAYS);

    payment.status = "approved";
    payment.reviewedBy = adminId;
    payment.reviewedAt = now;
    payment.subscriptionStart = startDate;
    payment.subscriptionEnd = endDate;
    await payment.save({ session });

    // Subscription.plan uses the generic "free"/"paid" vocabulary
    // (its own model), distinct from Payment.plan which names the
    // specific paid tier (e.g. "Practice") — intentional, not a bug.
    const subscription = await Subscription.findOneAndUpdate(
      { doctor: payment.doctor },
      {
        $set: {
          plan: "paid",
          status: "active",
          price: payment.amount,
          startDate,
          endDate,
        },
        $setOnInsert: {
          subscriptionId: `SUB-${Date.now().toString(36).toUpperCase()}`,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true, session },
    );

    await session.commitTransaction();
    session.endSession();

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { payment, subscription },
          isExtension
            ? "Payment approved — subscription extended."
            : "Payment approved — subscription activated.",
        ),
      );
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    session.endSession();
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

// PATCH /admin/payments/:id/reject  (admin)
// Body: { reason } (optional but recommended)
const rejectPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user._id;

    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json(new ApiResponse(404, null, "Payment not found"));
    }
    if (payment.status !== "pending") {
      return res
        .status(409)
        .json(new ApiResponse(409, payment, "Payment has already been processed."));
    }

    payment.status = "rejected";
    payment.reviewedBy = adminId;
    payment.reviewedAt = new Date();
    payment.rejectionReason = reason || "";
    await payment.save();

    return res.status(200).json(new ApiResponse(200, payment, "Payment rejected."));
  } catch (error) {
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

export {
  submitPayment,
  getMyPayments,
  getAllPayments,
  getPendingPayments,
  approvePayment,
  rejectPayment,
};