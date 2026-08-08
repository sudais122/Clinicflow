import mongoose from "mongoose";
import { User } from "../models/user.models.js";
import { Doctor } from "../models/doctor.models.js";
import { Patient } from "../models/patient.models.js";
import { Appointment } from "../models/appointment.models.js";
import { Subscription } from "../models/subscription.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

// Parse ?page & ?limit with sane defaults (used by the list endpoints).
const getPagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

// 2. GET /admin/doctors
const getAllDoctors = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req);

    const [doctors, total] = await Promise.all([
      Doctor.find()
        .select(
          "doctorId clinicName clinicAddress specialization consultationFee user createdAt"
        )
        .populate({
          path: "user",
          select: "fullname email phone role createdAt",
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Doctor.countDocuments(),
    ]);

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { total, page, limit, count: doctors.length, doctors },
          "Doctors fetched"
        )
      );
  } catch (error) {
    next(error);
  }
};

// 3. GET /admin/patients
const getAllPatients = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req);

    const [patients, total] = await Promise.all([
      Patient.find()
        .select("patientId dateOfBirth gender bloodGroup user createdAt")
        .populate({
          path: "user",
          select: "fullname email phone role createdAt",
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Patient.countDocuments(),
    ]);

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { total, page, limit, count: patients.length, patients },
          "Patients fetched"
        )
      );
  } catch (error) {
    next(error);
  }
};

// 4. GET /admin/appointments
const getAllAppointments = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req);

    const filter = {};
    if (req.query.status) {
      const allowed = ["waiting", "in-progress", "completed", "cancelled"];
      if (!allowed.includes(req.query.status)) {
        throw new ApiError(400, "Invalid status filter");
      }
      filter.status = req.query.status;
    }

    const [appointments, total] = await Promise.all([
      Appointment.find(filter)
        .populate({
          path: "doctor",
          select: "doctorId clinicName specialization user",
          populate: { path: "user", select: "fullname email" },
        })
        .populate({
          path: "patient",
          select: "patientId gender user",
          populate: { path: "user", select: "fullname email" },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Appointment.countDocuments(filter),
    ]);

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { total, page, limit, count: appointments.length, appointments },
          "Appointments fetched"
        )
      );
  } catch (error) {
    next(error);
  }
};

// 5. GET /admin/subscriptions
const getAllSubscriptions = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req);

    const filter = {};
    if (req.query.plan) {
      if (!["free", "paid"].includes(req.query.plan)) {
        throw new ApiError(400, "Invalid plan filter");
      }
      filter.plan = req.query.plan;
    }
    if (req.query.status) {
      if (!["active", "expired", "cancelled"].includes(req.query.status)) {
        throw new ApiError(400, "Invalid status filter");
      }
      filter.status = req.query.status;
    }

    const [subscriptions, total] = await Promise.all([
      Subscription.find(filter)
        .populate({
          path: "doctor",
          select: "doctorId clinicName user",
          populate: { path: "user", select: "fullname email" },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Subscription.countDocuments(filter),
    ]);

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { total, page, limit, count: subscriptions.length, subscriptions },
          "Subscriptions fetched"
        )
      );
  } catch (error) {
    next(error);
  }
};

// 6. GET /admin/dashboard
const getAdminDashboard = async (req, res, next) => {
 // Resolve a ?range= query into a { startDate, endDate } window (or null for all-time).
//   ?range=today | 7d | 30d | all | custom(&startDate=&endDate=)
const resolveDateRange = (query) => {
  const range = query.range || "all";

  if (range === "all") {
    return null; // no date filter
  }

  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const start = new Date();

  if (range === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (range === "7d") {
    start.setDate(start.getDate() - 6); // last 7 days incl. today
    start.setHours(0, 0, 0, 0);
  } else if (range === "30d") {
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  } else if (range === "custom") {
    if (!query.startDate || !query.endDate) {
      throw new ApiError(400, "custom range requires startDate and endDate");
    }
    const s = new Date(query.startDate);
    const e = new Date(query.endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) {
      throw new ApiError(400, "Invalid startDate or endDate");
    }
    if (s > e) {
      throw new ApiError(400, "startDate cannot be after endDate");
    }
    s.setHours(0, 0, 0, 0);
    e.setHours(23, 59, 59, 999);
    return { startDate: s, endDate: e };
  } else {
    throw new ApiError(400, "Invalid range. Use today, 7d, 30d, custom, or all");
  }

  return { startDate: start, endDate: end };
};

const getAdminDashboard = async (req, res, next) => {
  try {
    const dateRange = resolveDateRange(req.query);

    // Build a createdAt match if a date range was requested (else empty = all-time).
    const dateMatch = dateRange
      ? { createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate } }
      : {};

    // ---- Current system stats (all-time totals; not date-filtered) ----
    // ---- Historical analytics (scoped to the selected range) ----
    const [
      totalUsers,
      totalDoctors,
      totalPatients,
      activeClinics,
      appointmentsByStatus,
      appointmentsByDate,
      newDoctors,
      newPatients,
      doctorsBySpecialization,
      subscriptionsByPlan,
      subscriptionsByStatus,
      revenueAgg,
    ] = await Promise.all([
      // Current stats
      User.countDocuments(),
      Doctor.countDocuments(),
      Patient.countDocuments(),
      Queue.countDocuments({ clinicStatus: "open" }),

      // Appointments grouped by status, within range
      Appointment.aggregate([
        { $match: dateMatch },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      // Appointments per day, within range (for the line/bar chart)
      Appointment.aggregate([
        { $match: dateMatch },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // New doctors / patients within range
      Doctor.countDocuments(dateMatch),
      Patient.countDocuments(dateMatch),

      // Doctors grouped by specialization (all-time trend)
      Doctor.aggregate([
        { $group: { _id: "$specialization", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Subscriptions (all-time)
      Subscription.aggregate([
        { $group: { _id: "$plan", count: { $sum: 1 } } },
      ]),
      Subscription.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Subscription.aggregate([
        { $match: { plan: "paid", status: "active" } },
        { $group: { _id: null, total: { $sum: "$price" } } },
      ]),
    ]);

    // Turn [{_id, count}] arrays into simple keyed objects.
    const toMap = (arr) =>
      arr.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {});

    const apptStatus = toMap(appointmentsByStatus);
    const subPlan = toMap(subscriptionsByPlan);
    const subStatus = toMap(subscriptionsByStatus);

    // Total appointments in range 
    const totalAppointmentsInRange = Object.values(apptStatus).reduce(
      (a, b) => a + b,
      0,
    );

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          range: req.query.range || "all",
          dateWindow: dateRange
            ? {
                startDate: dateRange.startDate,
                endDate: dateRange.endDate,
              }
            : null,

          // Current, all-time system stats
          currentStats: {
            totalUsers,
            totalDoctors,
            totalPatients,
            activeClinics,
          },

          // Date-filtered analytics
          analytics: {
            appointments: {
              total: totalAppointmentsInRange,
              waiting: apptStatus.waiting || 0,
              inProgress: apptStatus["in-progress"] || 0,
              completed: apptStatus.completed || 0,
              cancelled: apptStatus.cancelled || 0,
            },
            appointmentsByDate, 
            newDoctors,
            newPatients,
          },

          // All-time breakdowns for pie/bar charts
          breakdowns: {
            doctorsBySpecialization, // [{ _id: "Cardiologist", count: 4 }, ...]
            subscriptions: {
              free: subPlan.free || 0,
              paid: subPlan.paid || 0,
              active: subStatus.active || 0,
              expired: subStatus.expired || 0,
              cancelled: subStatus.cancelled || 0,
            },
            revenue: {
              activePaidTotal: revenueAgg[0]?.total || 0,
            },
          },
        },
        "Admin dashboard fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};
};

// deactive user
const deactivateUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      throw new ApiError(400, "Invalid user id");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }
    if (user.isActive === false) {
      throw new ApiError(400, "Account is already deactivated");
    }

    user.isActive = false;
    await user.save({ validateBeforeSave: false });

    const updated = await User.findById(userId).select(
      "fullname email role isActive"
    );

    return res
      .status(200)
      .json(new ApiResponse(200, updated, "Account deactivated"));
  } catch (error) {
    next(error);
  }
};

// active user
const activateUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      throw new ApiError(400, "Invalid user id");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }
    if (user.isActive === true) {
      throw new ApiError(400, "Account is already active");
    }

    user.isActive = true;
    await user.save({ validateBeforeSave: false });

    const updated = await User.findById(userId).select(
      "fullname email role isActive"
    );

    return res
      .status(200)
      .json(new ApiResponse(200, updated, "Account activated"));
  } catch (error) {
    next(error);
  }
};

export {
  getAllDoctors,
  getAllPatients,
  getAllAppointments,
  getAllSubscriptions,
  getAdminDashboard,
  deactivateUser,
  activateUser,
};
