import mongoose from "mongoose";

import { Appointment } from "../models/appointment.models.js";
import { Queue } from "../models/queue.models.js";
import { Doctor } from "../models/doctor.models.js";
import { Patient } from "../models/patient.models.js";
import { Subscription } from "../models/subscription.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";
import { pktDayBoundsUTC } from "../utils/date.js";
import {
  FREE_PLAN_DAILY_TOKEN_LIMIT,
  isUnlimitedPlan,
  isAppointmentLockedForPlan,
} from "../utils/planLimits.js";
import { notifyBookingLimitReached } from "./notification.controller.js";

import { generateAppointmentId } from "../utils/id's/appointment.js";
import { emitQueueLengthUpdated } from "../socket/socketEvents.js";

const allowedTransitions = {
  waiting: ["in-progress", "cancelled"],
  "in-progress": ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};


// 1. Book Appointment
//
// REVERSED FROM THE PREVIOUS VERSION: booking now ALWAYS succeeds
// regardless of the doctor's plan or how many appointments they
// already have that day. There is no capacity check, no rejection,
// no "queue is full" response — the patient never learns anything
// about the doctor's subscription. Whether this appointment ends up
// "locked" for the DOCTOR is determined AFTER creation and never
// affects the patient's booking outcome or response in any way.
const bookAppointment = async (req, res, next) => {
  try {
    const {
      doctorId,
      appointmentDate,
      bookFor,
      patientName,
      patientPhone,
    } = req.body;

    if (!doctorId) {
      throw new ApiError(400, "Doctor id is required");
    }

    if (!mongoose.isValidObjectId(doctorId)) {
      throw new ApiError(400, "Invalid doctor id");
    }

    if (!bookFor) {
      throw new ApiError(
        400,
        "Please specify whether the appointment is for yourself or someone else",
      );
    }

    if (!["self", "other"].includes(bookFor)) {
      throw new ApiError(400, 'bookFor must be either "self" or "other"');
    }

    const patient = await Patient.findOne({
      user: req.user._id,
    });

    if (!patient) {
      throw new ApiError(404, "Patient profile not found");
    }

    let actualPatientName;
    let actualPatientPhone;

    if (bookFor === "self") {
      actualPatientName = req.user.fullname;
      actualPatientPhone = req.user.phone;

      if (!actualPatientName) {
        throw new ApiError(400, "Your profile name is not available");
      }

      if (!actualPatientPhone) {
        throw new ApiError(
          400,
          "Your profile phone number is not available",
        );
      }
    }

    if (bookFor === "other") {
      if (!patientName || !patientName.trim()) {
        throw new ApiError(
          400,
          "Patient name is required when booking for someone else",
        );
      }

      if (!patientPhone || !patientPhone.trim()) {
        throw new ApiError(
          400,
          "Patient phone number is required when booking for someone else",
        );
      }

      if (!/^[+\d][\d\s-]{6,14}\d$/.test(patientPhone.trim())) {
        throw new ApiError(400, "Please enter a valid phone number");
      }

      actualPatientName = patientName.trim();
      actualPatientPhone = patientPhone.trim();
    }

    const doctor = await Doctor.findById(doctorId);

    if (!doctor) {
      throw new ApiError(404, "Doctor not found");
    }

    const existingActive = await Appointment.findOne({
      patientName: actualPatientName,
      patientPhone: actualPatientPhone,
      doctor: doctorId,
      status: {
        $in: ["waiting", "in-progress"],
      },
    });

    if (existingActive) {
      throw new ApiError(
        409,
        `${actualPatientName} already has an active appointment with this doctor. Please wait until it is completed or cancel it before booking another appointment with this doctor.`,
      );
    }

    const date = appointmentDate
      ? new Date(appointmentDate)
      : new Date();

    if (isNaN(date.getTime())) {
      throw new ApiError(400, "Invalid appointment date");
    }

    const session = await mongoose.startSession();

    let appointmentDocId;
    // Retry loop is still here purely for transaction-conflict
    // safety on the Queue document (two concurrent bookings for the
    // same doctor both touch it) — unrelated to plan limits now,
    // which no longer participate in this transaction at all.
    const MAX_RETRIES = 3;
    let attempt = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      session.startTransaction();

      try {
        const queue = await Queue.findOne({
          doctor: doctorId,
        }).session(session);

        if (!queue) {
          throw new ApiError(404, "Doctor queue not found");
        }

        const tokenNumber = Math.max(queue.lastToken + 1, 1);

        queue.lastToken = tokenNumber;
        queue.lastUpdated = new Date();

        await queue.save({ session });

        const appointmentId = await generateAppointmentId({
          session,
        });

        const [appointment] = await Appointment.create(
          [
            {
              appointmentId,
              bookedBy: req.user._id,
              patient: patient._id,
              patientName: actualPatientName,
              patientPhone: actualPatientPhone,
              doctor: doctorId,
              appointmentDate: date,
              tokenNumber,
              status: "waiting",
              consultationFee: doctor.consultationFee,
              paymentStatus: "unpaid",
            },
          ],
          { session },
        );

        appointmentDocId = appointment._id;

        await session.commitTransaction();
        break;
      } catch (error) {
        await session.abortTransaction();

        const isTransient =
          typeof error?.hasErrorLabel === "function" &&
          error.hasErrorLabel("TransientTransactionError");

        if (isTransient && attempt < MAX_RETRIES - 1) {
          attempt++;
          continue;
        }

        throw error instanceof ApiError
          ? error
          : new ApiError(
              500,
              error?.message ||
                "Something went wrong while booking the appointment",
            );
      }
    }

    session.endSession();

    const populatedAppointment =
      await Appointment.findById(appointmentDocId)
        .populate({
          path: "doctor",
          select:
            "doctorId clinicName clinicAddress specialization consultationFee user",
          populate: {
            path: "user",
            select: "fullname email phone",
          },
        })
        .populate({
          path: "bookedBy",
          select: "fullname email phone",
        })
        .lean();

    if (!populatedAppointment) {
      throw new ApiError(
        404,
        "Appointment could not be retrieved",
      );
    }

    const queue = await Queue.findOne({
      doctor: doctorId,
    }).lean();

    const yourToken = populatedAppointment.tokenNumber;
    const clinicStatus = queue?.clinicStatus ?? "closed";
    const nowServing = queue?.nowServing ?? 0;
    const perPatient =
      queue?.estimatedTimePerPatient ?? 10;
    const delay = queue?.delayInMinutes ?? 0;

    let patientsAhead = 0;
    let estimatedWaitMinutes = 0;

    if (clinicStatus === "open") {
      patientsAhead = Math.max(
        yourToken - nowServing - 1,
        0,
      );

      estimatedWaitMinutes =
        patientsAhead * perPatient + delay;
    }

    emitQueueLengthUpdated(doctorId, {
      lastToken: queue?.lastToken ?? yourToken,
      nowServing,
    });

    // Plain, unconditional success response — identical regardless of
    // whether this appointment turns out locked for the doctor. The
    // patient never sees any plan/limit/upgrade information anywhere
    // in this response.
    const responseData = {
      appointment: populatedAppointment,

      queue: {
        yourToken,
        nowServing:
          clinicStatus === "open" ? nowServing : null,
        patientsAhead:
          clinicStatus === "open" ? patientsAhead : null,
        estimatedTimePerPatient:
          clinicStatus === "open" ? perPatient : null,
        delayInMinutes:
          clinicStatus === "open" ? delay : null,
        estimatedWaitMinutes:
          clinicStatus === "open"
            ? estimatedWaitMinutes
            : null,
        clinicStatus,
      },

      message:
        clinicStatus === "open"
          ? "Appointment booked successfully"
          : "Appointment booked successfully. The clinic is currently closed. Queue information will be available when the clinic opens.",
    };

    // Fire-and-forget: notify the DOCTOR if this appointment landed
    // beyond their Free-plan limit. Deliberately after the response
    // data is built and never awaited into the patient's response —
    // a failure here must never affect booking, which has already
    // fully succeeded by this point.
    isAppointmentLockedForPlan(doctorId, populatedAppointment)
      .then((locked) => {
        if (locked) {
          return notifyBookingLimitReached(doctorId, patient._id, date);
        }
      })
      .catch((err) => console.error("Lock/notification check failed:", err));

    return res
      .status(201)
      .json(
        new ApiResponse(
          201,
          responseData,
          responseData.message,
        ),
      );
  } catch (error) {
    next(error);
  }
};

// 2. Get Patient Appointments
//
// Now paginated, searchable (patient name), and status-filterable —
// same pattern as the doctor side's getDoctorAppointments. `all=true`
// bypasses pagination entirely and is used by everything on the
// Patient Dashboard that needs the FULL list (Overview's current
// appointment card, Queue page, socket room joining by doctorId) —
// none of that should ever be truncated to one page.
const getPatientAppointments = async (req, res, next) => {
  try {
    const patient = await Patient.findOne({ user: req.user._id });

    if (!patient) {
      throw new ApiError(404, "Patient profile not found");
    }

    const { search, status } = req.query;
    const returnAll = req.query.all === "true";

    const ALLOWED_LIMITS = [10, 20, 50];
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    if (!returnAll && !ALLOWED_LIMITS.includes(limit)) {
      throw new ApiError(400, `limit must be one of: ${ALLOWED_LIMITS.join(", ")}`);
    }
    let page = req.query.page ? parseInt(req.query.page, 10) : 1;
    if (!Number.isInteger(page) || page < 1) page = 1;

    const match = { patient: patient._id };

    if (!returnAll && status && status !== "all") {
      // "upcoming" groups the two active statuses together, matching
      // the existing patient dashboard's own filter tabs (All /
      // Upcoming / Completed / Cancelled).
      if (status === "upcoming") {
        match.status = { $in: ["waiting", "in-progress"] };
      } else if (["completed", "cancelled"].includes(status)) {
        match.status = status;
      } else {
        throw new ApiError(400, "Invalid status filter");
      }
    }

    if (!returnAll && search && search.trim()) {
      const q = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape regex metacharacters
      match.patientName = { $regex: q, $options: "i" };
    }

    const total = await Appointment.countDocuments(match);
    const totalPages = returnAll ? 1 : Math.max(1, Math.ceil(total / limit));
    if (page > totalPages) page = totalPages;

    let query = Appointment.find(match)
      .populate({
        path: "doctor",
        select:
          "doctorId clinicName clinicAddress specialization consultationFee user",
        populate: { path: "user", select: "fullname email phone" },
      })
      .sort({ createdAt: -1 });

    if (!returnAll) {
      query = query.skip((page - 1) * limit).limit(limit);
    }

    const appointments = await query.lean();

    const doctorIds = [
      ...new Set(
        appointments
          .map((a) => a.doctor?._id?.toString())
          .filter(Boolean),
      ),
    ];

    const queues = await Queue.find({ doctor: { $in: doctorIds } }).lean();
    const queueByDoctor = {};
    for (const q of queues) {
      queueByDoctor[q.doctor.toString()] = q;
    }

    // Patient view is completely unaffected by lock status — a
    // patient's own appointment always shows their real live queue
    // position, regardless of whether the doctor can currently serve
    // it. Nothing about locking is ever computed or exposed here.
    const data = appointments.map((appt) => {
      const isActive =
        appt.status === "waiting" || appt.status === "in-progress";

      const queue = queueByDoctor[appt.doctor?._id?.toString()];

      let queueInfo = null;
      if (isActive && queue) {
        const yourToken = appt.tokenNumber;
        const nowServing = queue.nowServing ?? 0;
        const patientsAhead = Math.max(yourToken - nowServing - 1, 0);
        const perPatient = queue.estimatedTimePerPatient ?? 10;
        const delay = queue.delayInMinutes ?? 0;

        queueInfo = {
          yourToken,
          nowServing,
          patientsAhead,
          estimatedTimePerPatient: perPatient,
          delayInMinutes: delay,
          estimatedWaitMinutes: patientsAhead * perPatient + delay,
          isActive: queue.isActive ?? false,
        };
      }

      return { ...appt, queue: queueInfo };
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          appointments: data,
          pagination: { page, limit, total, totalPages },
        },
        "Patient appointments fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

// 3. Get Doctor Appointments  (doctor only)
//
// Now server-side paginated, searchable (patient name / appointment
// ID), and status-filterable, on top of the existing lock/redaction
// behavior. Still annotates every appointment with `locked` and, for
// locked ones, REDACTS sensitive fields server-side (patientName,
// patientPhone, populated patient/user details, consultationFee,
// paymentStatus) before they ever leave the server — the frontend
// blur is a UX layer on top of this, not the privacy boundary.
//
// Response shape changed from a bare array to { appointments,
// pagination } — this is a breaking change to the previous contract,
// intentionally, since pagination metadata has to live somewhere.
const getDoctorAppointments = async (req, res, next) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      throw new ApiError(404, "Doctor profile not found");
    }

    const { date, search, status } = req.query;
    if (!date) {
      throw new ApiError(400, "Date is required");
    }

    const bounds = pktDayBoundsUTC(date);
    if (!bounds) {
      throw new ApiError(400, "Invalid date — expected YYYY-MM-DD");
    }
    const { startOfDay, endOfDay } = bounds;

    // `all=true` bypasses pagination entirely and returns every
    // appointment for the day — used internally by queue/overview
    // logic (Live Queue, Serve, token lookups, counts) which all
    // need the FULL day's list, not a page of it. Search/status
    // filters are ignored in this mode; the paginated list UI never
    // sends this flag.
    const returnAll = req.query.all === "true";

    // Only supported page sizes are allowed — reject anything else
    // outright rather than silently clamping to an unexpected value.
    const ALLOWED_LIMITS = [10, 20, 50];
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
    if (!returnAll && !ALLOWED_LIMITS.includes(limit)) {
      throw new ApiError(
        400,
        `limit must be one of: ${ALLOWED_LIMITS.join(", ")}`,
      );
    }
    let page = req.query.page ? parseInt(req.query.page, 10) : 1;
    if (!Number.isInteger(page) || page < 1) page = 1;

    const match = {
      doctor: doctor._id,
      appointmentDate: { $gte: startOfDay, $lte: endOfDay },
    };

    if (!returnAll && status && status !== "all") {
      const validStatuses = ["waiting", "in-progress", "completed", "cancelled"];
      if (!validStatuses.includes(status)) {
        throw new ApiError(400, "Invalid status filter");
      }
      match.status = status;
    }

    if (!returnAll && search && search.trim()) {
      const q = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape regex metacharacters
      match.$or = [
        { patientName: { $regex: q, $options: "i" } },
        { appointmentId: { $regex: q, $options: "i" } },
      ];
    }

    const subscription = await Subscription.findOne({ doctor: doctor._id });
    const unlimited = isUnlimitedPlan(subscription);

    // Lock rank depends on position among ALL of that day's
    // appointments by tokenNumber — not just the filtered/paginated
    // subset — so this has to be computed against the full,
    // unfiltered day before search/status/pagination are applied.
    // Cheap: bounded to a single clinic day, projection-only.
    const rankByToken = new Map();
    if (!unlimited) {
      const allTokensForDay = await Appointment.find({
        doctor: doctor._id,
        appointmentDate: { $gte: startOfDay, $lte: endOfDay },
      })
        .select("tokenNumber")
        .sort({ tokenNumber: 1 })
        .lean();
      allTokensForDay.forEach((a, idx) => rankByToken.set(a.tokenNumber, idx + 1));
    }

    const total = await Appointment.countDocuments(match);
    const totalPages = returnAll ? 1 : Math.max(1, Math.ceil(total / limit));
    // An out-of-range page (e.g. filters changed, records were
    // deleted) moves to the nearest valid page rather than returning
    // a blank result.
    if (page > totalPages) page = totalPages;

    let query = Appointment.find(match)
      .populate({
        path: "patient",
        select: "gender bloodGroup user",
        populate: { path: "user", select: "fullname email" },
      })
      .sort({ tokenNumber: 1 });

    if (!returnAll) {
      query = query.skip((page - 1) * limit).limit(limit);
    }

    const appointments = await query.lean();

    const shaped = appointments.map((a) => {
      const rank = unlimited ? 0 : rankByToken.get(a.tokenNumber) || 0;
      const locked = !unlimited && rank > FREE_PLAN_DAILY_TOKEN_LIMIT;

      if (locked) {
        return {
          _id: a._id,
          appointmentId: a.appointmentId,
          tokenNumber: a.tokenNumber,
          appointmentDate: a.appointmentDate,
          status: a.status,
          locked: true,
        };
      }

      return { ...a, locked: false };
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          appointments: shaped,
          pagination: { page, limit, total, totalPages },
        },
        "Doctor appointments fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

// 4. Update Appointment Status
const updateAppointmentStatus = async (req, res, next) => {
  try {
    const { appointmentId } = req.params;
    const { status } = req.body;

    if (!mongoose.isValidObjectId(appointmentId)) {
      throw new ApiError(400, "Invalid appointment id");
    }

    const validStatuses = ["waiting", "in-progress", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      throw new ApiError(400, "Invalid status value");
    }

    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      throw new ApiError(403, "Only a doctor can update appointment status");
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      throw new ApiError(404, "Appointment not found");
    }

    if (appointment.doctor.toString() !== doctor._id.toString()) {
      throw new ApiError(403, "You are not allowed to update this appointment");
    }

    // A doctor should not be able to bypass the Serve lock by driving
    // status transitions directly through this endpoint either —
    // moving a locked appointment to in-progress is the same
    // restricted action as Serve, just via a different route.
    if (status === "in-progress") {
      const locked = await isAppointmentLockedForPlan(doctor._id, appointment);
      if (locked) {
        throw new ApiError(
          403,
          "This appointment is beyond your Free plan's daily limit. Upgrade to Practice to serve additional patients today.",
        );
      }
    }

    const current = appointment.status;
    if (!allowedTransitions[current].includes(status)) {
      throw new ApiError(
        400,
        `Cannot change status from "${current}" to "${status}"`
      );
    }

    appointment.status = status;
    await appointment.save();

    return res
      .status(200)
      .json(new ApiResponse(200, appointment, "Appointment status updated"));
  } catch (error) {
    next(error);
  }
};

// 5. Cancel Appointment
const cancelAppointment = async (req, res, next) => {
  try {
    const { appointmentId } = req.params;

    if (!mongoose.isValidObjectId(appointmentId)) {
      throw new ApiError(400, "Invalid appointment id");
    }

    const patient = await Patient.findOne({ user: req.user._id });
    if (!patient) {
      throw new ApiError(404, "Patient profile not found");
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      throw new ApiError(404, "Appointment not found");
    }

    if (appointment.patient.toString() !== patient._id.toString()) {
      throw new ApiError(403, "You are not allowed to cancel this appointment");
    }

    if (appointment.status === "cancelled") {
      throw new ApiError(400, "Appointment is already cancelled");
    }
    if (appointment.status === "completed") {
      throw new ApiError(400, "A completed appointment cannot be cancelled");
    }

    appointment.status = "cancelled";
    await appointment.save();

    return res
      .status(200)
      .json(
        new ApiResponse(200, appointment, "Appointment cancelled successfully")
      );
  } catch (error) {
    next(error);
  }
};

// 6. Mark Appointment Paid
const markAppointmentPaid = async (req, res, next) => {
  try {
    const { appointmentId } = req.params;

    if (!mongoose.isValidObjectId(appointmentId)) {
      throw new ApiError(400, "Invalid appointment id");
    }

    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      throw new ApiError(403, "Only a doctor can mark an appointment as paid");
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      throw new ApiError(404, "Appointment not found");
    }

    if (appointment.doctor.toString() !== doctor._id.toString()) {
      throw new ApiError(403, "You are not allowed to update this appointment");
    }

    if (appointment.paymentStatus === "paid") {
      throw new ApiError(400, "Appointment is already marked as paid");
    }

    appointment.paymentStatus = "paid";
    appointment.paidAt = new Date();
    await appointment.save();

    return res
      .status(200)
      .json(
        new ApiResponse(200, appointment, "Appointment marked as paid"),
      );
  } catch (error) {
    next(error);
  }
};

export {
  bookAppointment,
  getPatientAppointments,
  getDoctorAppointments,
  updateAppointmentStatus,
  cancelAppointment,
  markAppointmentPaid,
};