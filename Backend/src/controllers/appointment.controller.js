import mongoose from "mongoose";

import { Appointment } from "../models/appointment.models.js";
import { Queue } from "../models/queue.models.js";
import { Doctor } from "../models/doctor.models.js";
import { Patient } from "../models/patient.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

import { generateAppointmentId } from "../utils/id's/appointment.js";

// Allowed status transitions. A status can only move to one listed here.
const allowedTransitions = {
  waiting: ["in-progress", "cancelled"],
  "in-progress": ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

// 1. Book Appointment  (patient only)
const bookAppointment = async (req, res, next) => {
  try {
    const { doctorId, appointmentDate } = req.body;

    if (!doctorId) {
      throw new ApiError(400, "Doctor id is required");
    }
    if (!mongoose.isValidObjectId(doctorId)) {
      throw new ApiError(400, "Invalid doctor id");
    }

    // Resolve the Patient profile from the logged-in user.
    const patient = await Patient.findOne({ user: req.user._id });
    if (!patient) {
      throw new ApiError(404, "Patient profile not found");
    }

    // Make sure the doctor exists.
    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      throw new ApiError(404, "Doctor not found");
    }

    // appointmentDate is required by the schema; default to now if not sent.
    const date = appointmentDate ? new Date(appointmentDate) : new Date();
    if (isNaN(date.getTime())) {
      throw new ApiError(400, "Invalid appointment date");
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Read + update the queue inside the transaction so two concurrent
      // bookings can't grab the same token number.
      const queue = await Queue.findOne({ doctor: doctorId }).session(session);
      if (!queue) {
        throw new ApiError(404, "Doctor queue not found");
      }
      if (!queue.isActive) {
        throw new ApiError(400, "This doctor's queue is currently closed");
      }

      const tokenNumber = queue.currentToken + 1;
      queue.currentToken = tokenNumber;
      queue.lastUpdated = new Date();
      await queue.save({ session });

      const [appointment] = await Appointment.create(
        [
          {
            doctor: doctorId,
            patient: patient._id,
            appointmentDate: date,
            tokenNumber,
            status: "waiting",
          },
        ],
        { session },
      );

      await session.commitTransaction();

      return res
        .status(201)
        .json(
          new ApiResponse(201, appointment, "Appointment booked successfully"),
        );
    } catch (error) {
      await session.abortTransaction();
      throw error instanceof ApiError
        ? error
        : new ApiError(
            500,
            error?.message || "Something went wrong while booking the appointment",
          );
    } finally {
      session.endSession();
    }
  } catch (error) {
    next(error);
  }
};

// 2. Get Patient Appointments  (patient only)
const getPatientAppointments = async (req, res, next) => {
  try {
    const patient = await Patient.findOne({ user: req.user._id });
    if (!patient) {
      throw new ApiError(404, "Patient profile not found");
    }

    const appointments = await Appointment.find({ patient: patient._id })
      .populate({
        path: "doctor",
        select: "clinicName specialization user",
        populate: { path: "user", select: "fullname email" },
      })
      .sort({ createdAt: -1 });

    return res
      .status(200)
      .json(
        new ApiResponse(200, appointments, "Patient appointments fetched"),
      );
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
      .json(
        new ApiResponse(200, appointments, "Doctor appointments fetched"),
      );
  } catch (error) {
    next(error);
  }
};

// 4. Update Appointment Status  (doctor only)
//    waiting -> in-progress -> completed   |   waiting/in-progress -> cancelled
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
        `Cannot change status from "${current}" to "${status}"`,
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

// 5. Cancel Appointment  (patient cancels their own)
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
      .json(new ApiResponse(200, appointment, "Appointment cancelled successfully"));
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