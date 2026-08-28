import mongoose from "mongoose";

import { Appointment } from "../models/appointment.models.js";
import { Queue } from "../models/queue.models.js";
import { Doctor } from "../models/doctor.models.js";
import { Patient } from "../models/patient.models.js";
import { Subscription } from "../models/subscription.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";
import { pktDayBoundsUTC } from "../utils/date.js";
import { FREE_PLAN_DAILY_TOKEN_LIMIT, isUnlimitedPlan } from "../utils/planLimits.js";

import { generateAppointmentId } from "../utils/id's/appointment.js";
import { emitQueueLengthUpdated } from "../socket/socketEvents.js";

const allowedTransitions = {
  waiting: ["in-progress", "cancelled"],
  "in-progress": ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};


// 1. Book Appointment
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
    // Standard MongoDB transient-transaction retry pattern: two
    // concurrent bookings for the same doctor both touch the same
    // Queue document (queue.save below), so MongoDB's transaction
    // conflict detection aborts one of them with a
    // TransientTransactionError. Retrying that one (rather than
    // surfacing a raw Mongo error) is what makes "only one request
    // gets token #25" resolve into a real response instead of a
    // 500 for whichever request lost the race.
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

        // ---- Daily token-capacity check (Free plan only) ----------
        // Queue.lastToken is a lifetime counter for this doctor (no
        // date field on Queue at all — it only resets via the
        // doctor's manual "Reset Queue" action), so it can NEVER
        // safely represent "tokens issued today". The limit is
        // therefore checked against real Appointment documents
        // scoped to the PKT calendar day being booked — which may be
        // today or a future date — not against lastToken, and not
        // against "now".
        const subscription = await Subscription.findOne({
          doctor: doctorId,
        }).session(session);

        if (!isUnlimitedPlan(subscription)) {
          const bookingDayPKT = date.toLocaleDateString("en-CA", {
            timeZone: "Asia/Karachi",
          }); // -> "YYYY-MM-DD"
          const bounds = pktDayBoundsUTC(bookingDayPKT);

          if (bounds) {
            const { startOfDay, endOfDay } = bounds;
            // Counts every appointment for that day regardless of
            // status, including cancelled — consistent with how
            // Queue.lastToken itself already behaves elsewhere
            // (cancelling an appointment never decrements lastToken,
            // so a token once issued stays "spent" against the daily
            // count too). ADJUST to `status: { $ne: "cancelled" }`
            // if you'd rather a cancellation free up a slot.
            const todaysCount = await Appointment.countDocuments({
              doctor: doctorId,
              appointmentDate: { $gte: startOfDay, $lte: endOfDay },
            }).session(session);

            if (todaysCount >= FREE_PLAN_DAILY_TOKEN_LIMIT) {
              // No token generated, no queue mutation, no
              // appointment created — this throws before any of
              // that happens, exactly like the other validation
              // errors above.
              throw new ApiError(
                400,
                `Today's queue is full. This doctor has reached the maximum number of appointments (${FREE_PLAN_DAILY_TOKEN_LIMIT}) for today. Please choose another date or doctor.`,
              );
            }
          }
        }
        // ---- END capacity check -------------------------------------

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
              // Snapshotted at booking time — see the note on this
              // field in the schema. Revenue calculations always sum
              // THIS value, never doctor.consultationFee live, so a
              // later fee change never rewrites past revenue.
              consultationFee: doctor.consultationFee,
              paymentStatus: "unpaid",
            },
          ],
          { session },
        );

        appointmentDocId = appointment._id;

        await session.commitTransaction();
        break; // success — leave the retry loop
      } catch (error) {
        await session.abortTransaction();

        const isTransient =
          typeof error?.hasErrorLabel === "function" &&
          error.hasErrorLabel("TransientTransactionError");

        if (isTransient && attempt < MAX_RETRIES - 1) {
          attempt++;
          continue; // retry the whole transaction body
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
const getPatientAppointments = async (req, res, next) => {
  try {
    // Resolve the Patient profile from the logged-in user (JWT -> req.user).
    const patient = await Patient.findOne({ user: req.user._id });
    console.log("Logged-in patient _id:", patient?._id);

    if (!patient) {
      throw new ApiError(404, "Patient profile not found");
    }

    const appointments = await Appointment.find({ patient: patient._id })
      .populate({
        path: "doctor",
        select:
          "doctorId clinicName clinicAddress specialization consultationFee user",
        populate: { path: "user", select: "fullname email phone" },
      })
      .sort({ createdAt: -1 })
      .lean();

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

    // Attach live queue info only to active appointments; past ones don't need it.
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

    return res
      .status(200)
      .json(new ApiResponse(200, data, "Patient appointments fetched"));
  } catch (error) {
    next(error);
  }
};

// 3. Get Doctor Appointments  (doctor only)
// date is REQUIRED — a query param of ?date=YYYY-MM-DD scoping the
// result to that single Pakistan-time calendar day, using the same
// pktDayBoundsUTC() helper defined at the top of this file.
const getDoctorAppointments = async (req, res, next) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      throw new ApiError(404, "Doctor profile not found");
    }

    const { date } = req.query;
    if (!date) {
      throw new ApiError(400, "Date is required");
    }

    const bounds = pktDayBoundsUTC(date);
    if (!bounds) {
      throw new ApiError(400, "Invalid date — expected YYYY-MM-DD");
    }
    const { startOfDay, endOfDay } = bounds;

    const appointments = await Appointment.find({
      doctor: doctor._id,
      appointmentDate: { $gte: startOfDay, $lte: endOfDay },
    })
      .populate({
        path: "patient",
        select: "gender bloodGroup user",
        populate: { path: "user", select: "fullname email" },
      })
      .sort({ tokenNumber: 1 });

    return res
      .status(200)
      .json(new ApiResponse(200, appointments, "Doctor appointments fetched"));
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

    // Only a doctor can drive the status of their own appointments.
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