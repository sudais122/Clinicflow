import mongoose from "mongoose";

import { Queue } from "../models/queue.models.js";
import { Doctor } from "../models/doctor.models.js";
import { Appointment } from "../models/appointment.models.js";

import ApiError from "../utils/apierror.js";
import ApiResponse from "../utils/apiresponse.js";

import {
  emitClinicStarted,
  emitClinicClosed,
  emitQueueUpdated,
  emitDelayUpdated,
} from "../socket/socketEvents.js";

// Helper: resolve the logged-in doctor and their queue (mutations only).
const getOwnQueue = async (userId) => {
  const doctor = await Doctor.findOne({ user: userId });
  if (!doctor) {
    throw new ApiError(403, "Only a doctor can manage the queue");
  }
  const queue = await Queue.findOne({ doctor: doctor._id });
  if (!queue) {
    throw new ApiError(404, "Queue not found for this doctor");
  }
  return { doctor, queue };
};

// 1. Get Queue Status
const getQueueStatus = async (req, res, next) => {
  try {
    const { doctorId } = req.params;
    if (!mongoose.isValidObjectId(doctorId)) {
      throw new ApiError(400, "Invalid doctor id");
    }

    const queue = await Queue.findOne({ doctor: doctorId }).lean();
    if (!queue) {
      throw new ApiError(404, "Queue not found for this doctor");
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          clinicStatus: queue.clinicStatus,
          currentToken: queue.nowServing,
          lastToken: queue.lastToken,
          estimatedTimePerPatient: queue.estimatedTimePerPatient,
          delayInMinutes: queue.delayInMinutes,
        },
        "Queue status fetched",
      ),
    );
  } catch (error) {
    next(error);
  }
};

// 2. Start Clinic  —  PATCH /queue/start  (doctor)
const startClinic = async (req, res, next) => {
  try {
    const { doctor, queue } = await getOwnQueue(req.user._id);

    queue.clinicStatus = "open";
    queue.lastUpdated = new Date();
    await queue.save();

    // Real-time: tell everyone in this doctor's room the clinic is open.
    emitClinicStarted(doctor._id, { clinicStatus: "open" });

    return res
      .status(200)
      .json(new ApiResponse(200, queue, "Clinic started"));
  } catch (error) {
    next(error);
  }
};

// 3. Next Patient
const nextPatient = async (req, res, next) => {
  try {
    const doctor = await Doctor.findOne({ user: req.user._id });
    if (!doctor) {
      throw new ApiError(403, "Only a doctor can manage the queue");
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    let updatedQueue;

    try {
      const queue = await Queue.findOne({ doctor: doctor._id }).session(session);
      if (!queue) {
        throw new ApiError(404, "Queue not found for this doctor");
      }
      if (queue.clinicStatus !== "open") {
        throw new ApiError(400, "Start the clinic before calling patients");
      }
      if (queue.nowServing >= queue.lastToken) {
        throw new ApiError(400, "No more patients in the queue");
      }

      // Complete the patient currently being served (if any).
      if (queue.nowServing >= 1) {
        await Appointment.findOneAndUpdate(
          {
            doctor: doctor._id,
            tokenNumber: queue.nowServing,
            status: { $in: ["waiting", "in-progress"] },
          },
          { status: "completed" },
          { session },
        );
      }

      // Advance to the next token.
      queue.nowServing += 1;
      queue.lastUpdated = new Date();
      await queue.save({ session });

      // Mark the newly-current patient as in-progress.
      await Appointment.findOneAndUpdate(
        {
          doctor: doctor._id,
          tokenNumber: queue.nowServing,
          status: "waiting",
        },
        { status: "in-progress" },
        { session },
      );

      await session.commitTransaction();

      updatedQueue = queue;
    } catch (error) {
      await session.abortTransaction();
      throw error instanceof ApiError
        ? error
        : new ApiError(500, error?.message || "Failed to move to next patient");
    } finally {
      session.endSession();
    }

    // Real-time: broadcast the shared queue state; each patient computes
    // their own "patients ahead" and wait time from their own token.
    emitQueueUpdated(doctor._id, {
      nowServing: updatedQueue.nowServing,
      lastToken: updatedQueue.lastToken,
      estimatedTimePerPatient: updatedQueue.estimatedTimePerPatient,
      delayInMinutes: updatedQueue.delayInMinutes,
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        { currentToken: updatedQueue.nowServing, lastToken: updatedQueue.lastToken },
        "Moved to next patient",
      ),
    );
  } catch (error) {
    next(error);
  }
};

// 4. Update Delay
const updateDelay = async (req, res, next) => {
  try {
    const { delay } = req.body;

    if (delay === undefined || delay === null || isNaN(delay)) {
      throw new ApiError(400, "Delay (in minutes) is required");
    }
    if (Number(delay) < 0) {
      throw new ApiError(400, "Delay cannot be negative");
    }

    const { doctor, queue } = await getOwnQueue(req.user._id);

    queue.delayInMinutes = Number(delay);
    queue.lastUpdated = new Date();
    await queue.save();

    // Real-time: tell patients about the new delay.
    emitDelayUpdated(doctor._id, {
      delayInMinutes: queue.delayInMinutes,
      nowServing: queue.nowServing,
      estimatedTimePerPatient: queue.estimatedTimePerPatient,
    });

    return res
      .status(200)
      .json(new ApiResponse(200, queue, "Delay updated"));
  } catch (error) {
    next(error);
  }
};

// 5. Update Estimated Time
const updateTime = async (req, res, next) => {
  try {
    const { estimatedTimePerPatient } = req.body;

    if (
      estimatedTimePerPatient === undefined ||
      estimatedTimePerPatient === null ||
      isNaN(estimatedTimePerPatient)
    ) {
      throw new ApiError(400, "Estimated time per patient is required");
    }
    if (Number(estimatedTimePerPatient) <= 0) {
      throw new ApiError(400, "Estimated time must be greater than 0");
    }

    const { doctor, queue } = await getOwnQueue(req.user._id);

    queue.estimatedTimePerPatient = Number(estimatedTimePerPatient);
    queue.lastUpdated = new Date();
    await queue.save();

    // Real-time: estimated time affects everyone's wait, so broadcast it too.
    emitQueueUpdated(doctor._id, {
      nowServing: queue.nowServing,
      lastToken: queue.lastToken,
      estimatedTimePerPatient: queue.estimatedTimePerPatient,
      delayInMinutes: queue.delayInMinutes,
    });

    return res
      .status(200)
      .json(new ApiResponse(200, queue, "Estimated time updated"));
  } catch (error) {
    next(error);
  }
};

// 6. End Clinic
const endClinic = async (req, res, next) => {
  try {
    const { doctor, queue } = await getOwnQueue(req.user._id);

    queue.clinicStatus = "closed";
    queue.lastUpdated = new Date();
    await queue.save();

    // Real-time: tell everyone the clinic is closed.
    emitClinicClosed(doctor._id, { clinicStatus: "closed" });

    return res
      .status(200)
      .json(new ApiResponse(200, queue, "Clinic ended"));
  } catch (error) {
    next(error);
  }
};

// 7. Reset Queue
const resetQueue = async (req, res, next) => {
  try {
    const { doctor, queue } = await getOwnQueue(req.user._id);

    queue.lastToken = 0;
    queue.nowServing = 0;
    queue.delayInMinutes = 0;
    queue.clinicStatus = "closed";
    queue.lastUpdated = new Date();
    await queue.save();

    // Real-time: reset means closed + counters zeroed.
    emitClinicClosed(doctor._id, { clinicStatus: "closed" });

    return res
      .status(200)
      .json(new ApiResponse(200, queue, "Queue reset for a new day"));
  } catch (error) {
    next(error);
  }
};

export {
  getQueueStatus,
  startClinic,
  nextPatient,
  updateDelay,
  updateTime,
  endClinic,
  resetQueue,
};