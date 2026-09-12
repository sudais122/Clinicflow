import { Queue } from "../models/queue.models.js";
import { Appointment } from "../models/appointment.models.js";
import {
  QUEUE_AUTO_RESET_DELAY_MS,
  QUEUE_AUTO_RESET_CHECK_INTERVAL_MS,
} from "../config/queueResetConfig.js";
import { emitQueueAutoReset } from "../socket/socketEvents.js";

async function runAutoResetCycle() {
  try {
    const cutoff = new Date(Date.now() - QUEUE_AUTO_RESET_DELAY_MS);
    const candidates = await Queue.find({
      queueEmptyAt: { $ne: null, $lte: cutoff },
    });

    for (const queue of candidates) {
      try {
        const activeCount = await Appointment.countDocuments({
          doctor: queue.doctor,
          status: { $in: ["waiting", "in-progress"] },
        });

        if (activeCount > 0) {
          // Something became active since — cancel the pending
          // reset rather than proceeding. (Normally syncQueueEmptyState
          // would have already cleared this when the appointment was
          // created/activated, but clearing it here too costs nothing
          // and closes any timing gap.)
          queue.queueEmptyAt = null;
          await queue.save();
          continue;
        }

        // The actual reset. Deliberately narrower than the existing
        // manual "Reset Queue" button — this does NOT touch
        // clinicStatus. Per the spec, an idle queue timing out must
        // never substitute for the doctor's explicit Close Clinic
        // action; whatever clinicStatus currently is (open or
        // closed) is left exactly as-is.
        queue.lastToken = 0;
        queue.nowServing = 0;
        queue.delayInMinutes = 0;
        queue.queueEmptyAt = null;
        queue.lastUpdated = new Date();
        await queue.save();

        emitQueueAutoReset(queue.doctor, {
          lastToken: queue.lastToken,
          nowServing: queue.nowServing,
        });
      } catch (innerErr) {
        // One queue failing must never stop the rest of the batch,
        // corrupt data, or leave a half-applied reset. Just log and
        // let the next cycle retry — the reset itself only runs
        // queue.save() with plain field assignments, so a retry is
        // always safe (idempotent: re-running it when already reset
        // just writes the same zeroed values again).
        console.error(`Auto-reset failed for queue (doctor ${queue.doctor}):`, innerErr);
      }
    }
  } catch (err) {
    console.error("Auto-reset scheduler cycle failed:", err);
  }
}

function startAutoResetScheduler() {
  runAutoResetCycle(); // run once immediately — picks up anything that expired during downtime, rather than waiting a full interval
  setInterval(runAutoResetCycle, QUEUE_AUTO_RESET_CHECK_INTERVAL_MS);
  console.log(
    `Queue auto-reset scheduler started (checking every ${QUEUE_AUTO_RESET_CHECK_INTERVAL_MS / 1000}s, ${QUEUE_AUTO_RESET_DELAY_MS / 60000}min grace period).`,
  );
}

export { startAutoResetScheduler, runAutoResetCycle };