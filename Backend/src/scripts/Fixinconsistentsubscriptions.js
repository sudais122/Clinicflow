/* ============================================================
   One-off reconciliation script. Run ONCE after deploying the fixed
   payment.controller.js + subscription.controller.js:
     node scripts/fixInconsistentSubscriptions.js

   Resolves each approved payment's doctor defensively: tries
   payment.doctor as a Doctor._id first (the correct, post-fix
   shape), and falls back to treating it as a User id (Doctor.user)
   in case it's old data from before the Doctor-resolution fix in
   submitPayment. Idempotent — safe to re-run.

   ADJUST: MONGO_URI and the three model import paths below to match
   your project exactly.
   ============================================================ */

import mongoose from "mongoose";
import dotenv from "dotenv";
import { Doctor } from "../models/doctor.models.js";
import { Payment } from "../models/Payment.models.js";
import { Subscription } from "../models/subscription.models.js";

dotenv.config();

// Matches whatever your real app already uses to connect.
const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/clinicflow"; // ADJUST
const SUBSCRIPTION_DAYS = 30;

async function resolveDoctor(rawId) {
  let doctor = await Doctor.findById(rawId).catch(() => null);
  if (!doctor) {
    doctor = await Doctor.findOne({ user: rawId }).catch(() => null);
  }
  return doctor;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected. Scanning approved payments for inconsistent subscriptions...");

  const approvedPayments = await Payment.find({ status: "approved" }).sort({
    reviewedAt: -1,
  });

  const seenDoctors = new Set();
  let fixed = 0;
  let alreadyOk = 0;
  let skipped = 0;

  for (const payment of approvedPayments) {
    const doctor = await resolveDoctor(payment.doctor);
    if (!doctor) {
      console.warn(
        `Skipping payment ${payment._id} — no matching Doctor found for ${payment.doctor}`,
      );
      skipped++;
      continue;
    }

    const doctorKey = doctor._id.toString();
    if (seenDoctors.has(doctorKey)) continue; // already handled via this doctor's most recent approval
    seenDoctors.add(doctorKey);

    const subscription = await Subscription.findOne({ doctor: doctor._id });

    const alreadyCorrect =
      subscription &&
      subscription.plan === "paid" &&
      subscription.status === "active" &&
      subscription.endDate &&
      subscription.endDate > new Date();

    if (alreadyCorrect) {
      alreadyOk++;
      continue;
    }

    const startDate = payment.subscriptionStart || payment.reviewedAt || payment.createdAt;
    const endDate =
      payment.subscriptionEnd ||
      new Date(new Date(startDate).getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

    await Subscription.findOneAndUpdate(
      { doctor: doctor._id },
      {
        $set: {
          plan: "paid",
          price: payment.amount,
          startDate,
          endDate,
          status: endDate > new Date() ? "active" : "expired",
        },
        $setOnInsert: {
          subscriptionId: `SUB-${Date.now().toString(36).toUpperCase()}-${fixed}`,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    fixed++;
    console.log(`Fixed subscription for doctor ${doctorKey} (payment ${payment._id})`);
  }

  console.log(
    `Done. ${fixed} doctor(s) fixed, ${alreadyOk} already correct, ${skipped} skipped (no matching Doctor).`,
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});