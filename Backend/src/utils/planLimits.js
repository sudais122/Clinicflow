import { Subscription } from "../models/subscription.models.js";
import { Appointment } from "../models/appointment.models.js";
import { pktDayBoundsUTC } from "./date.js";

const FREE_PLAN_DAILY_TOKEN_LIMIT = 25;

function isUnlimitedPlan(subscription) {
  return !!subscription && subscription.plan === "paid" && subscription.status === "active";
}

async function isAppointmentLockedForPlan(doctorId, appointment) {
  const subscription = await Subscription.findOne({ doctor: doctorId });
  if (isUnlimitedPlan(subscription)) return false;

  const dayPKT = new Date(appointment.appointmentDate).toLocaleDateString("en-CA", {
    timeZone: "Asia/Karachi",
  });
  const bounds = pktDayBoundsUTC(dayPKT);
  if (!bounds) return false;

  const rank = await Appointment.countDocuments({
    doctor: doctorId,
    appointmentDate: { $gte: bounds.startOfDay, $lte: bounds.endOfDay },
    tokenNumber: { $lte: appointment.tokenNumber },
  });
  return rank > FREE_PLAN_DAILY_TOKEN_LIMIT;
}

export { FREE_PLAN_DAILY_TOKEN_LIMIT, isUnlimitedPlan, isAppointmentLockedForPlan };