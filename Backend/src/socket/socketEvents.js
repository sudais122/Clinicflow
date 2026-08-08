import { getIO } from "./socket.js";

const room = (doctorId) => `queue_${doctorId}`;

// Wrap every emit so a socket failure never throws into the controller.
const safeEmit = (doctorId, event, payload) => {
  try {
    getIO().to(room(doctorId)).emit(event, payload);
  } catch (err) {
    console.error(`Socket emit failed (${event}):`, err.message);
  }
};

// Doctor -> patients in the room
export const emitClinicStarted = (doctorId, payload) =>
  safeEmit(doctorId, "clinicStarted", payload);

export const emitClinicClosed = (doctorId, payload) =>
  safeEmit(doctorId, "clinicClosed", payload);

export const emitQueueUpdated = (doctorId, payload) =>
  safeEmit(doctorId, "queueUpdated", payload);

export const emitDelayUpdated = (doctorId, payload) =>
  safeEmit(doctorId, "delayUpdated", payload);

export const emitQueueLengthUpdated = (doctorId, payload) =>
  safeEmit(doctorId, "queueLengthUpdated", payload);