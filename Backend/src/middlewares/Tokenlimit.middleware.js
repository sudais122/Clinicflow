import mongoose from "mongoose";

import { Doctor } from "../models/doctor.models.js";
import { Subscription } from "../models/subscription.models.js";
import { Appointment } from "../models/appointment.models.js";
import ApiError from "../utils/apierror.js";
import { pktDayBoundsUTC } from "../utils/date.js";

const FREE_PLAN_DAILY_TOKEN_LIMIT = 30;

const enforceDailyTokenLimit = async (req, res, next) => {
  try {
    const { doctorId } = req.body;
    if (!doctorId || !mongoose.isValidObjectId(doctorId)) {
      return next(); 
    }

    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return next(); 
    }

    const subscription = await Subscription.findOne({ doctor: doctor._id });
    const isUnlimited =
      subscription && subscription.plan === "paid" && subscription.status === "active";
    if (isUnlimited) {
      return next();
    }

    const todayPKT = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Karachi",
    }); 
    const bounds = pktDayBoundsUTC(todayPKT);
    if (!bounds) {
      return next(new ApiError(500, "Could not resolve today's clinic day"));
    }
    const { startOfDay, endOfDay } = bounds;


    const todaysCount = await Appointment.countDocuments({
      doctor: doctor._id,
      appointmentDate: { $gte: startOfDay, $lte: endOfDay },
      status: { $ne: "cancelled" },
    });

    if (todaysCount >= FREE_PLAN_DAILY_TOKEN_LIMIT) {
      return next(
        new ApiError(
          403,
          `The Free plan is limited to ${FREE_PLAN_DAILY_TOKEN_LIMIT} tokens per clinic day. Upgrade to Practice for unlimited tokens.`,
        ),
      );
    }

    next();
  } catch (error) {
    next(error);
  }
};

export { enforceDailyTokenLimit, FREE_PLAN_DAILY_TOKEN_LIMIT };