import { Doctor } from "../models/doctor.models.js";
import { Subscription } from "../models/subscription.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

const DEFAULT_DURATION_DAYS = 30;
const DEFAULT_PAID_PRICE = 5000;

// Resolve the logged-in doctor's subscription (doctor-only helper).
const getDoctorSubscription = async (userId) => {
  const doctor = await Doctor.findOne({ user: userId });
  if (!doctor) {
    throw new ApiError(403, "Only a doctor can manage a subscription");
  }
  const subscription = await Subscription.findOne({ doctor: doctor._id });
  if (!subscription) {
    throw new ApiError(404, "Subscription not found");
  }
  return { doctor, subscription };
};

// Lazily flip an active paid plan to "expired" once its endDate has passed.
const applyLazyExpiry = async (subscription) => {
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

// 1. Get My Subscription  
const getMySubscription = async (req, res, next) => {
  try {
    const { subscription } = await getDoctorSubscription(req.user._id);
    await applyLazyExpiry(subscription);

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

// 2. Upgrade Subscription 
const upgradeSubscription = async (req, res, next) => {
  try {
    const price = req.body.price ?? DEFAULT_PAID_PRICE;
    const durationDays = req.body.durationDays ?? DEFAULT_DURATION_DAYS;

    if (isNaN(price) || Number(price) <= 0) {
      throw new ApiError(400, "Price must be a number greater than 0");
    }
    if (isNaN(durationDays) || Number(durationDays) <= 0) {
      throw new ApiError(400, "Duration must be a number greater than 0");
    }

    const { subscription } = await getDoctorSubscription(req.user._id);

    if (subscription.plan === "paid" && subscription.status === "active") {
      throw new ApiError(400, "You already have an active paid subscription");
    }

    // (Future: run payment here before applying the upgrade.)
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + Number(durationDays));

    subscription.plan = "paid";
    subscription.price = Number(price);
    subscription.status = "active";
    subscription.startDate = startDate;
    subscription.endDate = endDate;
    await subscription.save();

    return res
      .status(200)
      .json(new ApiResponse(200, subscription, "Subscription upgraded to paid"));
  } catch (error) {
    next(error);
  }
};

// 3. Renew Subscription  
const renewSubscription = async (req, res, next) => {
  try {
    const durationDays = req.body.durationDays ?? DEFAULT_DURATION_DAYS;
    if (isNaN(durationDays) || Number(durationDays) <= 0) {
      throw new ApiError(400, "Duration must be a number greater than 0");
    }

    const { subscription } = await getDoctorSubscription(req.user._id);

    if (subscription.plan !== "paid") {
      throw new ApiError(400, "Only a paid subscription can be renewed");
    }
    if (subscription.status === "cancelled") {
      throw new ApiError(
        400,
        "A cancelled subscription cannot be renewed. Please upgrade again.",
      );
    }

    // Extend from the later of "now" or the current endDate, so renewing early
    // doesn't lose remaining days, and renewing after expiry starts fresh.
    const now = new Date();
    const base =
      subscription.endDate && subscription.endDate > now
        ? new Date(subscription.endDate)
        : now;
    base.setDate(base.getDate() + Number(durationDays));

    subscription.endDate = base;
    subscription.status = "active";
    await subscription.save();

    return res
      .status(200)
      .json(new ApiResponse(200, subscription, "Subscription renewed"));
  } catch (error) {
    next(error);
  }
};

// 4. Cancel Subscription  
const cancelSubscription = async (req, res, next) => {
  try {
    const { subscription } = await getDoctorSubscription(req.user._id);

    if (subscription.plan !== "paid") {
      throw new ApiError(400, "Only a paid subscription can be cancelled");
    }
    if (subscription.status === "cancelled") {
      throw new ApiError(400, "Subscription is already cancelled");
    }

    // Keep the document for history 
    subscription.status = "cancelled";
    await subscription.save();

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