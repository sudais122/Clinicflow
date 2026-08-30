import { Doctor } from "../models/doctor.models.js";
import { Subscription } from "../models/subscription.models.js";
import { Appointment } from "../models/appointment.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";
import { pktDayBoundsUTC } from "../utils/date.js";
import { isUnlimitedPlan } from "../utils/planLimits.js";

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 };

// Same pure UTC date-string arithmetic already used on the frontend
// (addDaysToISO in doctor-script.js) — never touches local timezone.
function addDaysISO(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function shortLabel(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Resolves doctor + validates Practice access. Both analytics
// endpoints share this — the actual backend authorization boundary
// the spec requires (frontend blur is UX only).
async function requirePracticeAccess(userId) {
  const doctor = await Doctor.findOne({ user: userId });
  if (!doctor) {
    throw new ApiError(403, "Only a doctor can access analytics");
  }
  const subscription = await Subscription.findOne({ doctor: doctor._id });
  if (!isUnlimitedPlan(subscription)) {
    throw new ApiError(
      403,
      "Analytics is a Practice-plan feature. Upgrade to Practice to unlock it.",
    );
  }
  return doctor;
}

function resolveRangeBounds(rangeParam) {
  const days = RANGE_DAYS[rangeParam];
  if (!days) {
    throw new ApiError(400, "range must be one of: 7d, 30d, 90d");
  }
  const todayPKT = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  const startDateISO = addDaysISO(todayPKT, -(days - 1)); // inclusive of today
  const startBounds = pktDayBoundsUTC(startDateISO);
  const endBounds = pktDayBoundsUTC(todayPKT);
  if (!startBounds || !endBounds) {
    throw new ApiError(500, "Could not resolve the selected date range");
  }
  return { days, startDateISO, startOfRange: startBounds.startOfDay, endOfRange: endBounds.endOfDay };
}

// GET /appointments/analytics?range=7d|30d|90d  (doctor, Practice only)
const getAppointmentAnalytics = async (req, res, next) => {
  try {
    const doctor = await requirePracticeAccess(req.user._id);
    const { days, startDateISO, startOfRange, endOfRange } = resolveRangeBounds(req.query.range || "7d");

    // Backend aggregation, not a full fetch-and-count in JS — scales
    // regardless of how many appointments this doctor accumulates.
    const results = await Appointment.aggregate([
      {
        $match: {
          doctor: doctor._id,
          appointmentDate: { $gte: startOfRange, $lte: endOfRange },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$appointmentDate", timezone: "Asia/Karachi" } },
          count: { $sum: 1 },
        },
      },
    ]);

    const byDate = new Map(results.map((r) => [r._id, r.count]));
    // Fill every day in the range, including zero-count days, so the
    // chart is a continuous series rather than having gaps.
    const data = [];
    for (let i = 0; i < days; i++) {
      const dISO = addDaysISO(startDateISO, i);
      data.push({ date: shortLabel(dISO), dateISO: dISO, count: byDate.get(dISO) || 0 });
    }

    return res
      .status(200)
      .json(new ApiResponse(200, { range: req.query.range || "7d", data }, "Appointment analytics fetched"));
  } catch (error) {
    next(error);
  }
};

// GET /revenue/analytics?range=7d|30d|90d  (doctor, Practice only)
const getRevenueAnalytics = async (req, res, next) => {
  try {
    const doctor = await requirePracticeAccess(req.user._id);
    const { days, startDateISO, startOfRange, endOfRange } = resolveRangeBounds(req.query.range || "7d");

    // Same revenue definition as the existing Revenue page: paid
    // appointments' consultationFee, keyed by appointmentDate.
    const results = await Appointment.aggregate([
      {
        $match: {
          doctor: doctor._id,
          paymentStatus: "paid",
          appointmentDate: { $gte: startOfRange, $lte: endOfRange },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$appointmentDate", timezone: "Asia/Karachi" } },
          revenue: { $sum: "$consultationFee" },
        },
      },
    ]);

    const byDate = new Map(results.map((r) => [r._id, r.revenue]));
    const data = [];
    for (let i = 0; i < days; i++) {
      const dISO = addDaysISO(startDateISO, i);
      data.push({ date: shortLabel(dISO), dateISO: dISO, revenue: byDate.get(dISO) || 0 });
    }

    return res
      .status(200)
      .json(new ApiResponse(200, { range: req.query.range || "7d", data }, "Revenue analytics fetched"));
  } catch (error) {
    next(error);
  }
};

export { getAppointmentAnalytics, getRevenueAnalytics };