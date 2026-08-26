
import { Payment, PAID_PLANS, PAYMENT_METHODS } from "../models/Payment.models.js";
import { Doctor } from "../models/doctor.models.js"; 
import { uploadBufferToCloudinary } from "../utils/cloudinary.js";
import ApiResponse  from "../utils/apiresponse.js"; 

const PLAN_PRICES = {
  Practice: 4500,
};

const SUBSCRIPTION_DAYS = 30;

/* ---------------- DOCTOR-FACING ---------------- */

// POST /payments  
const submitPayment = async (req, res) => {
  try {
    const doctorId = req.user._id;
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
    const doctorId = req.user._id;
    const payments = await Payment.find({ doctor: doctorId }).sort({ createdAt: -1 });
    return res.status(200).json(new ApiResponse(200, payments, "Your payments"));
  } catch (error) {
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

/* ---------------- ADMIN-FACING ---------------- */

// GET /admin/payments?status=pending 
const getAllPayments = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const payments = await Payment.find(filter)
      .populate("doctor", "fullname clinicName doctorId") // ADJUST fields to match your Doctor schema
      .sort({ createdAt: -1 });

    return res.status(200).json(new ApiResponse(200, payments, "Payments"));
  } catch (error) {
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

// GET /admin/payments/pending  
const getPendingPayments = async (req, res) => {
  req.query.status = "pending";
  return getAllPayments(req, res);
};

// PATCH /admin/payments/:id/approve  
const approvePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user._id;

    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json(new ApiResponse(404, null, "Payment not found"));
    }
    if (payment.status !== "pending") {
      return res
        .status(409)
        .json(new ApiResponse(409, payment, `Payment is already ${payment.status}`));
    }

    const now = new Date();
    const subscriptionEnd = new Date(now);
    subscriptionEnd.setDate(subscriptionEnd.getDate() + SUBSCRIPTION_DAYS);

    payment.status = "approved";
    payment.reviewedBy = adminId;
    payment.reviewedAt = now;
    payment.subscriptionStart = now;
    payment.subscriptionEnd = subscriptionEnd;
    await payment.save();

    // Activate the doctor's subscription. ADJUST this to match your
    // real Doctor schema if it isn't a `subscription: { plan, status,
    // start, end }` sub-object.
    const doctor = await Doctor.findByIdAndUpdate(
      payment.doctor,
      {
        subscription: {
          plan: payment.plan,
          status: "Active",
          start: now,
          end: subscriptionEnd,
        },
      },
      { new: true },
    );

    return res
      .status(200)
      .json(
        new ApiResponse(200, { payment, doctor }, "Payment approved — subscription activated."),
      );
  } catch (error) {
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

// PATCH /admin/payments/:id/reject  
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
        .json(new ApiResponse(409, payment, `Payment is already ${payment.status}`));
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