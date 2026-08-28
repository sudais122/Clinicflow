import { Doctor } from "../models/doctor.models.js";
import { Subscription } from "../models/subscription.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

// req.user is the User account (from the JWT), NOT the Doctor
// document — Doctor has its own _id with a `user` ref back to it.
// Every subscription lookup below must resolve through here first.
const getDoctorForUser = async (userId) => {
  const doctor = await Doctor.findOne({ user: userId });
  if (!doctor) {
    throw new ApiError(403, "Only a doctor can manage a subscription");
  }
  return doctor;
};

// Lazily flip an active paid plan to "expired" once its endDate has
// passed — same derivation used in adminDoctor.controller.js and
// adminSubscription.controller.js, kept in sync by hand across all
// three. ADJUST: pull into one shared helper module instead.
const applyExpiryIfNeeded = async (subscription) => {
  if (
    subscription.plan === "paid" &&
    subscription.status === "active" &&
    subscription.endDate &&
    subscription.endDate < new Date()
  ) {
    subscription.status = "expired";
    await subscription.save();
  }
  return subscription;
};

// GET /subscription/me  (doctor)
const getMySubscription = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.user._id);

    let subscription = await Subscription.findOne({ doctor: doctor._id });
    if (!subscription) {
      // First time this doctor's subscription has been read —
      // provision a default Free record instead of 404ing, so the
      // dashboard always has something real to render.
      subscription = await Subscription.create({
        subscriptionId: `SUB-${Date.now().toString(36).toUpperCase()}`,
        doctor: doctor._id,
        plan: "free",
        price: 0,
        status: "active",
        startDate: new Date(),
        endDate: null,
      });
    }

    subscription = await applyExpiryIfNeeded(subscription);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          subscriptionId: subscription.subscriptionId,
          plan: subscription.plan,
          price: subscription.price,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
        },
        "Subscription fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

// PATCH /subscription/upgrade  (doctor)
// Locked down — upgrading to paid Practice requires an admin-approved
// payment proof (see payment.controller.js submitPayment /
// approvePayment), which is the real activation path. This refuses
// to instantly grant a paid plan without one, so it can't be used to
// bypass payment review.
const upgradeSubscription = async (req, res, next) => {
  return next(
    new ApiError(
      400,
      "Upgrading to a paid plan requires submitting a payment proof for admin review — use POST /payments instead.",
    ),
  );
};

// PATCH /subscription/renew  (doctor)
// Locked down for the same reason — extensions go through the same
// POST /payments -> approvePayment path, which already extends
// (rather than resets) an active subscription's endDate correctly.
const renewSubscription = async (req, res, next) => {
  return next(
    new ApiError(
      400,
      "Renewing a paid plan requires submitting a payment proof for admin review — use POST /payments instead.",
    ),
  );
};

// PATCH /subscription/cancel  (doctor)
// Self-service downgrade to Free — no money or verification bypass
// risk, so this stays open.
const cancelSubscription = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.user._id);
    const subscription = await Subscription.findOneAndUpdate(
      { doctor: doctor._id },
      { $set: { plan: "free", status: "cancelled" } },
      { new: true },
    );
    if (!subscription) {
      throw new ApiError(404, "No subscription found");
    }
    return res
      .status(200)
      .json(new ApiResponse(200, subscription, "Subscription cancelled"));
  } catch (error) {
    next(error);
  }
};

export {
  getMySubscription,
  upgradeSubscription,
  renewSubscription,
  cancelSubscription,
};