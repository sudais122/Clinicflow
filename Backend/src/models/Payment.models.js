import mongoose, { Schema } from "mongoose";

// Extend this list as you add more paid tiers.
const PAID_PLANS = ["Practice"];
const PAYMENT_METHODS = ["easypaisa", "bank_transfer"];
const PAYMENT_STATUSES = ["pending", "approved", "rejected"];

const paymentSchema = new Schema(
  {
    doctor: {
      type: Schema.Types.ObjectId,
      ref: "Doctor", // ADJUST if your Doctor model is registered under a different name
      required: true,
      index: true,
    },
    plan: {
      type: String,
      enum: PAID_PLANS,
      required: true,
    },
    // Derived server-side from the plan (see PLAN_PRICES in the
    // controller) — never trust an amount submitted by the client.
    amount: {
      type: Number,
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      required: true,
    },
    transactionReference: {
      type: String,
      trim: true,
    },
    screenshotUrl: {
      type: String,
      required: true,
    },
    screenshotPublicId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: "pending",
      index: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User", // ADJUST — whatever your Admin/User model is called
    },
    reviewedAt: {
      type: Date,
    },
    subscriptionStart: {
      type: Date,
    },
    subscriptionEnd: {
      type: Date,
    },
  },
  { timestamps: true },
);

export const Payment = mongoose.model("Payment", paymentSchema);
export { PAID_PLANS, PAYMENT_METHODS, PAYMENT_STATUSES };