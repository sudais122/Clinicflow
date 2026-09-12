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

// Queue just became empty — no active appointments remain. Payload
export const emitQueueEmpty = (doctorId, payload) =>
  safeEmit(doctorId, "queueEmpty", payload);

// A new active appointment arrived during the grace period — cancels
export const emitQueueActiveAgain = (doctorId, payload) =>
  safeEmit(doctorId, "queueActiveAgain", payload);

// The scheduler actually performed the automatic idle-queue reset.
export const emitQueueAutoReset = (doctorId, payload) =>
  safeEmit(doctorId, "queueAutoReset", payload);