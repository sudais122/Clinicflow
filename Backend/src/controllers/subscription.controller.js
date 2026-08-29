import { Doctor } from "../models/doctor.models.js";
import { Subscription } from "../models/subscription.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

const getDoctorForUser = async (userId) => {
  const doctor = await Doctor.findOne({ user: userId });
  if (!doctor) {
    throw new ApiError(403, "Only a doctor can manage a subscription");
  }
  return doctor;
};

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

const getMySubscription = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.user._id);

    let subscription = await Subscription.findOne({ doctor: doctor._id });
    if (!subscription) {
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

const upgradeSubscription = async (req, res, next) => {
  return next(
    new ApiError(
      400,
      "Upgrading to a paid plan requires submitting a payment proof for admin review — use POST /payments instead.",
    ),
  );
};

const renewSubscription = async (req, res, next) => {
  return next(
    new ApiError(
      400,
      "Renewing a paid plan requires submitting a payment proof for admin review — use POST /payments instead.",
    ),
  );
};

// PATCH /subscription/cancel  (doctor)
// FIX: now resets price to 0 alongside plan/status. Previously only
// plan and status were reset, leaving the old paid price (e.g. 4500)
// sitting in the document forever — that stale value is exactly what
// was still showing on the frontend after a cancel.
const cancelSubscription = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.user._id);
    const subscription = await Subscription.findOneAndUpdate(
      { doctor: doctor._id },
      { $set: { plan: "free", status: "cancelled", price: 0 } },
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