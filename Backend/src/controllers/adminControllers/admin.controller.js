import { User } from "../../models/user.models.js";
import { Doctor } from "../../models/doctor.models.js";
import { Appointment } from "../../models/appointment.models.js";
import { Subscription } from "../../models/subscription.models.js";
import { Report } from "../../models/report.models.js";

import ApiError from "../../utils/apierror.js";
import ApiResponse from "../../utils/apiresponse.js";
import { getPeriodStart } from "../../utils/getPeriodStart.js";

const getOverview = async (req, res, next) => {
  try {
    const { period } = req.query;
    const periodStart = getPeriodStart(period);

    const apptDateFilter = periodStart ? { appointmentDate: { $gte: periodStart } } : {};
    const reportDateFilter = periodStart ? { createdAt: { $gte: periodStart } } : {};

    const [
      totalDoctors,
      pendingDoctors,
      activeDoctors,
      inactiveDoctors,

      totalPatients,
      activePatients,

      totalAppointments,
      completedAppointments,
      cancelledAppointments,
      waitingAppointments,
      inProgressAppointments,

      totalSubscriptions,
      activeSubscriptions,
      expiredSubscriptions,

      totalReports,
      pendingReports,
      inReviewReports,
      resolvedReports,
    ] = await Promise.all([
      Doctor.countDocuments({}),
      Doctor.countDocuments({ status: "pending" }),
      Doctor.countDocuments({ status: "active" }),
      Doctor.countDocuments({ status: "inactive" }),

      User.countDocuments({ role: "patient" }),
      User.countDocuments({ role: "patient", isActive: true }),

      Appointment.countDocuments(apptDateFilter),
      Appointment.countDocuments({ ...apptDateFilter, status: "completed" }),
      Appointment.countDocuments({ ...apptDateFilter, status: "cancelled" }),
      Appointment.countDocuments({ ...apptDateFilter, status: "waiting" }),
      Appointment.countDocuments({ ...apptDateFilter, status: "in-progress" }),

      Subscription.countDocuments({}),
      Subscription.countDocuments({ status: "active" }),
      Subscription.countDocuments({ status: "expired" }),

      Report.countDocuments(reportDateFilter),
      Report.countDocuments({ ...reportDateFilter, status: "pending" }),
      Report.countDocuments({ ...reportDateFilter, status: "inreview" }),
      Report.countDocuments({ ...reportDateFilter, status: "resolved" }),
    ]);

    const data = {
      period: period || "all",
      doctors: {
        total: totalDoctors,
        pending: pendingDoctors,
        active: activeDoctors,
        inactive: inactiveDoctors,
      },
      patients: {
        total: totalPatients,
        active: activePatients,
      },
      appointments: {
        total: totalAppointments,
        completed: completedAppointments,
        cancelled: cancelledAppointments,
        waiting: waitingAppointments,
        inProgress: inProgressAppointments,
      },
      subscriptions: {
        total: totalSubscriptions,
        active: activeSubscriptions,
        expired: expiredSubscriptions,
      },
      problemReports: {
        total: totalReports,
        pending: pendingReports,
        inReview: inReviewReports,
        resolved: resolvedReports,
      },
    };

    return res.status(200).json(new ApiResponse(200, data, "Admin overview fetched"));
  } catch (error) {
    next(error);
  }
};

export { getOverview };