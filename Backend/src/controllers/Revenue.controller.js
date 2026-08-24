import { Doctor } from "../models/doctor.models.js";
import { Appointment } from "../models/appointment.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";
import { addDaysToISO, pktDayBoundsUTC, todayPKT } from "../utils/date.js";

function resolveRevenueWindow({ range, from, to }) {
  let fromStr;
  let toStr;

  if (from || to) {
    if (!from || !to) return null; 
    fromStr = from;
    toStr = to;
  } else {
    const days = range === "7" ? 7 : 28;
    toStr = todayPKT();
    fromStr = addDaysToISO(toStr, -(days - 1));
  }

  const fromBounds = pktDayBoundsUTC(fromStr);
  const toBounds = pktDayBoundsUTC(toStr);
  if (!fromBounds || !toBounds) return null;

  if (fromBounds.startOfDay > toBounds.endOfDay) return null; 

  return {
    fromStr,
    toStr,
    startOfDay: fromBounds.startOfDay,
    endOfDay: toBounds.endOfDay,
  };
}

const getRevenue = async (req, res, next) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      throw new ApiError(403, "Only a doctor can view revenue");
    }

    const { range, from, to } = req.query;
    const window = resolveRevenueWindow({ range, from, to });
    if (!window) {
      throw new ApiError(
        400,
        "Provide either ?range=7|28 or both ?from=YYYY-MM-DD&to=YYYY-MM-DD (to must not be before from)",
      );
    }
    const { fromStr, toStr, startOfDay, endOfDay } = window;

    const [result] = await Appointment.aggregate([
      {
        $match: {
          doctor: doctor._id,
          paymentStatus: "paid",
          appointmentDate: { $gte: startOfDay, $lte: endOfDay },
        },
      },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: "$consultationFee" },
                paidAppointments: { $sum: 1 },
              },
            },
          ],
          appointments: [
            { $sort: { appointmentDate: -1 } },
            {
              $project: {
                _id: 0,
                appointmentId: 1,
                patientName: 1,
                appointmentDate: 1,
                consultationFee: 1,
                paymentStatus: 1,
                paidAt: 1,
              },
            },
          ],
        },
      },
    ]);

    const summary = result?.summary?.[0] || {
      totalRevenue: 0,
      paidAppointments: 0,
    };
    const appointments = result?.appointments || [];

    const averageConsultationFee =
      summary.paidAppointments > 0
        ? Math.round(summary.totalRevenue / summary.paidAppointments)
        : 0;

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          totalRevenue: summary.totalRevenue,
          paidAppointments: summary.paidAppointments,
          averageConsultationFee,
          from: fromStr,
          to: toStr,
          appointments,
        },
        "Revenue fetched successfully",
      ),
    );
  } catch (error) {
    next(error);
  }
};

export { getRevenue };
