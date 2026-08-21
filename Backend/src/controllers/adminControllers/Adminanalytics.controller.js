import { Appointment } from "../../models/appointment.models.js";
import { User } from "../../models/user.models.js";
import { Doctor } from "../../models/doctor.models.js";
import { Patient } from "../../models/patient.models.js";
import { Subscription } from "../../models/subscription.models.js";
import { Report } from "../../models/report.models.js";

import ApiResponse from "../../utils/apiresponse.js";

const lastNMonths = (n) => {
  const months = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    months.push({ label: start.toLocaleDateString("en-US", { month: "short" }), start, end });
  }
  return months;
};

const getTrends = async (req, res, next) => {
  try {
    const months = lastNMonths(6);

    const appointmentTrend = await Promise.all(
      months.map(async ({ label, start, end }) => {
        const [completed, cancelled] = await Promise.all([
          Appointment.countDocuments({ createdAt: { $gte: start, $lt: end }, status: "completed" }),
          Appointment.countDocuments({ createdAt: { $gte: start, $lt: end }, status: "cancelled" }),
        ]);
        return { month: label, completed, cancelled };
      }),
    );

    const revenueByMonth = await Promise.all(
      months.map(async ({ label, start, end }) => {
        const agg = await Subscription.aggregate([
          { $match: { plan: "paid", startDate: { $gte: start, $lt: end } } },
          { $group: { _id: null, total: { $sum: "$price" } } },
        ]);
        return { month: label, revenue: agg[0]?.total || 0 };
      }),
    );

    const patientGrowth = await Promise.all(
      months.map(async ({ label, start, end }) => {
        const newPatients = await User.countDocuments({ role: "patient", createdAt: { $gte: start, $lt: end } });
        return { month: label, newPatients };
      }),
    );

    return res
      .status(200)
      .json(new ApiResponse(200, { appointmentTrend, revenueByMonth, patientGrowth }, "Trends fetched"));
  } catch (error) {
    next(error);
  }
};

const getActivity = async (req, res, next) => {
  try {
    const limit = 4;

    const [recentDoctors, recentPatients, recentCancelled, recentSubExpired, recentReports] = await Promise.all([
      Doctor.find().sort({ createdAt: -1 }).limit(limit).populate({ path: "user", select: "fullname" }).lean(),
      Patient.find().sort({ createdAt: -1 }).limit(limit).populate({ path: "user", select: "fullname" }).lean(),
      Appointment.find({ status: "cancelled" }).sort({ updatedAt: -1 }).limit(limit).lean(),
      Subscription.find({ status: "expired" }).sort({ updatedAt: -1 }).limit(limit).lean(),
      Report.find().sort({ createdAt: -1 }).limit(limit).lean(),
    ]);

    const items = [
      ...recentDoctors.map((d) => ({ text: `Dr. ${d.user?.fullname || "Unknown"} registered.`, at: d.createdAt })),
      ...recentPatients.map((p) => ({ text: `Patient ${p.user?.fullname || "Unknown"} registered.`, at: p.createdAt })),
      ...recentCancelled.map((a) => ({ text: `Appointment ${a.appointmentId} was cancelled.`, at: a.updatedAt })),
      ...recentSubExpired.map((s) => ({ text: `Subscription ${s.subscriptionId} expired.`, at: s.updatedAt })),
      ...recentReports.map((r) => ({ text: `Problem report submitted.`, at: r.createdAt })),
    ]
      .filter((i) => i.at)
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 10)
      .map((i) => ({ text: i.text, at: i.at }));

    return res.status(200).json(new ApiResponse(200, items, "Recent activity fetched"));
  } catch (error) {
    next(error);
  }
};

export { getTrends, getActivity };