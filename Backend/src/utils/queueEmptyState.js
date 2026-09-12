import { Appointment } from "../models/appointment.models.js";
import { Queue } from "../models/queue.models.js";
import { QUEUE_AUTO_RESET_DELAY_MS } from "../config/queueResetConfig.js";
import { emitQueueEmpty, emitQueueActiveAgain } from "../socket/socketEvents.js";

async function syncQueueEmptyState(doctorId) {
  try {
    const activeCount = await Appointment.countDocuments({
      doctor: doctorId,
      status: { $in: ["waiting", "in-progress"] },
    });

    const queue = await Queue.findOne({ doctor: doctorId });
    if (!queue) return;

    if (activeCount === 0 && !queue.queueEmptyAt) {
      queue.queueEmptyAt = new Date();
      await queue.save();
      const autoResetAt = new Date(queue.queueEmptyAt.getTime() + QUEUE_AUTO_RESET_DELAY_MS);
      emitQueueEmpty(doctorId, { queueEmptyAt: queue.queueEmptyAt, autoResetAt });
    } else if (activeCount > 0 && queue.queueEmptyAt) {
      queue.queueEmptyAt = null;
      await queue.save();
      emitQueueActiveAgain(doctorId, {});
    }
  } catch (err) {
    console.error(`syncQueueEmptyState failed for doctor ${doctorId}:`, err);
  }
}

export { syncQueueEmptyState };