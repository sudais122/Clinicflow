import mongoose from "mongoose";

import { Appointment } from "../models/appointment.models.js";
import { Queue } from "../models/queue.models.js";
import { Doctor } from "../models/doctor.models.js";
import { Patient } from "../models/patient.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

import { generateAppointmentId } from "../utils/id's/appointment.js";

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
      throw new ApiError(
        400,
        'bookFor must be either "self" or "other"',
      );
    }
    //Get logged-in patient's profile

    const patient = await Patient.findOne({
      user: req.user._id,
    });

    if (!patient) {
      throw new ApiError(404, "Patient profile not found");
    }

    //Determine actual patient name
    let actualPatientName;

    if (bookFor === "self") {
      actualPatientName = req.user.fullname;

      if (!actualPatientName) {
        throw new ApiError(
          400,
          "Your profile name is not available",
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

      actualPatientName = patientName.trim();
    }

    // Make sure doctor exists

    const doctor = await Doctor.findById(doctorId);

    if (!doctor) {
      throw new ApiError(404, "Doctor not found");
    }

    // --------------------------------------------------
    // 6. Validate appointment date
    // --------------------------------------------------

    const date = appointmentDate
      ? new Date(appointmentDate)
      : new Date();

    if (isNaN(date.getTime())) {
      throw new ApiError(400, "Invalid appointment date");
    }

    // --------------------------------------------------
    // 7. Start transaction
    // --------------------------------------------------

    const session = await mongoose.startSession();

    session.startTransaction();

    let appointmentDocId;

    try {
      // ------------------------------------------------
      // 8. Get doctor's queue
      // ------------------------------------------------

      const queue = await Queue.findOne({
        doctor: doctorId,
      }).session(session);

      if (!queue) {
        throw new ApiError(
          404,
          "Doctor queue not found",
        );
      }

      // ------------------------------------------------
      // 9. Check clinic status
      // ------------------------------------------------

      if (queue.clinicStatus !== "open") {
        throw new ApiError(
          400,
          "Clinic is currently closed",
        );
      }

      // ------------------------------------------------
      // 10. Generate next token
      // ------------------------------------------------

      const tokenNumber = queue.lastToken + 1;

      queue.lastToken = tokenNumber;
      queue.lastUpdated = new Date();

      await queue.save({ session });

      // ------------------------------------------------
      // 11. Generate appointment ID
      // ------------------------------------------------

      const appointmentId = await generateAppointmentId({
        session,
      });

      // ------------------------------------------------
      // 12. Create appointment
      // ------------------------------------------------

      const [appointment] = await Appointment.create(
        [
          {
            appointmentId,

            // Logged-in account that booked it
            bookedBy: req.user._id,

            // Patient profile/account holder
            patient: patient._id,

            // Actual person attending
            patientName: actualPatientName,

            doctor: doctorId,

            appointmentDate: date,

            tokenNumber,

            status: "waiting",
          },
        ],
        { session },
      );

      appointmentDocId = appointment._id;

      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();

      throw error instanceof ApiError
        ? error
        : new ApiError(
            500,
            error?.message ||
              "Something went wrong while booking the appointment",
          );
    } finally {
      await session.endSession();
    }

    // --------------------------------------------------
    // 13. Get created appointment with doctor details
    // --------------------------------------------------

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

    // --------------------------------------------------
    // 14. Get latest queue information
    // --------------------------------------------------

    const queue = await Queue.findOne({
      doctor: doctorId,
    }).lean();

    const yourToken = populatedAppointment.tokenNumber;

    const nowServing = queue?.nowServing ?? 0;

    const patientsAhead = Math.max(
      yourToken - nowServing - 1,
      0,
    );

    const perPatient =
      queue?.estimatedTimePerPatient ?? 10;

    const delay = queue?.delayInMinutes ?? 0;

    const estimatedWaitMinutes =
      patientsAhead * perPatient + delay;

    // --------------------------------------------------
    // 15. Notify doctor's room
    // --------------------------------------------------

    emitQueueLengthUpdated(doctorId, {
      lastToken: queue?.lastToken ?? yourToken,
      nowServing,
    });

    // --------------------------------------------------
    // 16. Response
    // --------------------------------------------------

    const responseData = {
      appointment: populatedAppointment,

      queue: {
        yourToken,
        nowServing,
        patientsAhead,
        estimatedTimePerPatient: perPatient,
        delayInMinutes: delay,
        estimatedWaitMinutes,
        clinicStatus:
          queue?.clinicStatus ?? "closed",
      },
    };

    return res.status(201).json(
      new ApiResponse(
        201,
        responseData,
        "Appointment booked successfully",
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

    // Only THIS patient's appointments, newest first.
    const appointments = await Appointment.find({ patient: patient._id })
      .populate({
        path: "doctor",
        select:
          "doctorId clinicName clinicAddress specialization consultationFee user",
        populate: { path: "user", select: "fullname email phone" },
      })
      .sort({ createdAt: -1 })
      .lean();

      console.log("Found appointments:", appointments.length);

    // Load each involved doctor's live queue once, so we can compute the
    // patient's position per appointment without querying in a loop.
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
const getDoctorAppointments = async (req, res, next) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      throw new ApiError(404, "Doctor profile not found");
    }

    const appointments = await Appointment.find({ doctor: doctor._id })
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

export {
  bookAppointment,
  getPatientAppointments,
  getDoctorAppointments,
  updateAppointmentStatus,
  cancelAppointment,
};
