import "../loadEnv.js";
import mongoose from "mongoose";
import { Appointment } from "../models/appointment.models.js";
import { Doctor } from "../models/doctor.models.js";

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const missing = await Appointment.find({
    $or: [
      { consultationFee: { $exists: false } },
      { consultationFee: null },
    ],
  });

  console.log(`Found ${missing.length} appointment(s) missing consultationFee.`);

  if (missing.length === 0) {
    console.log("Nothing to backfill.");
    await mongoose.disconnect();
    process.exit(0);
  }

  // Cache doctor fees so we don't re-query the same doctor for every
  // one of their appointments.
  const feeByDoctor = new Map();

  let updated = 0;
  let skipped = 0;

  for (const appt of missing) {
    const doctorId = appt.doctor.toString();

    if (!feeByDoctor.has(doctorId)) {
      const doctor = await Doctor.findById(doctorId).select("consultationFee");
      feeByDoctor.set(doctorId, doctor?.consultationFee ?? null);
    }

    const fee = feeByDoctor.get(doctorId);

    if (fee == null) {
      console.warn(
        `Skipping appointment ${appt.appointmentId} — doctor ${doctorId} not found or has no consultationFee.`,
      );
      skipped += 1;
      continue;
    }

    // Also backfill paymentStatus if it's missing, defaulting to
    // "unpaid" — same reasoning as consultationFee: this field didn't
    // exist on these old records either.
    appt.consultationFee = fee;
    if (!appt.paymentStatus) {
      appt.paymentStatus = "unpaid";
    }

    await appt.save();
    updated += 1;
  }

  console.log(`Backfilled ${updated} appointment(s).`);
  if (skipped > 0) {
    console.log(`Skipped ${skipped} appointment(s) — see warnings above.`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});