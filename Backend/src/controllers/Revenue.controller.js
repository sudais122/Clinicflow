import { Doctor } from "../models/doctor.models.js";
import { Appointment } from "../models/appointment.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";
import { pktDayBoundsUTC } from "../utils/date.js";

// Same pure date-string arithmetic already used elsewhere (backend
// analytics.controller.js, frontend addDaysToISO) — never touches
// local timezone.
function addDaysISO(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

// GET /revenue?range=7|28&page=&limit=&search=
// GET /revenue?from=&to=&page=&limit=&search=
//
// IMPORTANT: I've never seen your actual revenue.controller.js in
// this conversation — this is a reconstruction matching the exact
// response shape your frontend (loadRevenue in doctor-script.js)
// already expects: { totalRevenue, paidAppointments,
// averageConsultationFee, from, to, appointments }. I've added
// `pagination` to that same object and paginated `appointments`
// specifically. If your real controller computes totalRevenue or
// averageConsultationFee differently (e.g. a different definition of
// "revenue"), adapt those parts — everything else should be a
// reasonable drop-in.
const getRevenue = async (req, res, next) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      throw new ApiError(404, "Doctor profile not found");
    }

    const { range, from, to, search } = req.query;

    let startOfRange, endOfRange, fromISO, toISO;

    if (from && to) {
      if (to < from) {
        throw new ApiError(400, "'to' cannot be before 'from'");
      }
      const fromBounds = pktDayBoundsUTC(from);
      const toBounds = pktDayBoundsUTC(to);
      if (!fromBounds || !toBounds) {
        throw new ApiError(400, "Invalid date — expected YYYY-MM-DD");
      }
      startOfRange = fromBounds.startOfDay;
      endOfRange = toBounds.endOfDay;
      fromISO = from;
      toISO = to;
    } else {
      const days = { "7": 7, "28": 28 }[range] || 28;
      const todayPKT = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
      fromISO = addDaysISO(todayPKT, -(days - 1));
      toISO = todayPKT;
      const fromBounds = pktDayBoundsUTC(fromISO);
      const toBounds = pktDayBoundsUTC(toISO);
      startOfRange = fromBounds.startOfDay;
      endOfRange = toBounds.endOfDay;
    }

    // Only supported page sizes are allowed — reject anything else.
    const ALLOWED_LIMITS = [10, 20, 50];
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    if (!ALLOWED_LIMITS.includes(limit)) {
      throw new ApiError(400, `limit must be one of: ${ALLOWED_LIMITS.join(", ")}`);
    }
    let page = req.query.page ? parseInt(req.query.page, 10) : 1;
    if (!Number.isInteger(page) || page < 1) page = 1;

    const match = {
      doctor: doctor._id,
      paymentStatus: "paid",
      appointmentDate: { $gte: startOfRange, $lte: endOfRange },
    };

    if (search && search.trim()) {
      const q = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape regex metacharacters
      match.patientName = { $regex: q, $options: "i" };
    }

    // Summary stats (total revenue, paid count, average fee) are
    // computed over the FULL matched range — never affected by which
    // page of transactions is currently being viewed. Aggregated at
    // the database level rather than fetching every row into Node.
    const summaryAgg = await Appointment.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$consultationFee" },
          paidAppointments: { $sum: 1 },
        },
      },
    ]);
    const totalRevenue = summaryAgg[0]?.totalRevenue || 0;
    const paidAppointments = summaryAgg[0]?.paidAppointments || 0;
    const averageConsultationFee = paidAppointments
      ? Math.round(totalRevenue / paidAppointments)
      : 0;

    const total = paidAppointments;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    // Out-of-range page (filters changed, records changed) moves to
    // the nearest valid page rather than returning a blank result.
    if (page > totalPages) page = totalPages;

    const appointments = await Appointment.find(match)
      .select("patientName appointmentDate consultationFee")
      .sort({ appointmentDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          totalRevenue,
          paidAppointments,
          averageConsultationFee,
          from: fromISO,
          to: toISO,
          appointments,
          pagination: { page, limit, total, totalPages },
        },
        "Revenue fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

export { getRevenue };