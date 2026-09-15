
import mongoose from "mongoose";

import { User } from "../models/user.models.js";
import { Doctor } from "../models/doctor.models.js";
import { Patient } from "../models/patient.models.js";
import { Appointment } from "../models/appointment.models.js";
import { Queue } from "../models/queue.models.js";
import { Subscription } from "../models/subscription.models.js";

const CONFIG = {
  BASE_URL: process.env.BASE_URL || "http://localhost:8000",
  MONGO_URI: process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/patientflow",
};

const RUN_ID = Date.now();
const results = [];
const createdUserIds = [];
const createdDoctorIds = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function apiCall(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${CONFIG.BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch {}
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  const cookieHeader = setCookie.join("; ").split(",").map((c) => c.trim().split(";")[0]).join("; ");
  return { status: res.status, data: json, cookie: cookieHeader };
}

async function registerDoctor(suffix) {
  const payload = {
    fullname: `QA Analytics Doctor ${suffix}`,
    email: `qa.analytics.doctor.${suffix}.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `061${String(RUN_ID).slice(-8)}${suffix.charCodeAt(0) % 10}`,
    clinicName: `QA Analytics Clinic ${suffix}`,
    clinicAddress: "1 Analytics Ave, Test City, Test Province",
    specialization: "General Medicine",
    licenseNumber: `QA-ANL-${suffix}-${RUN_ID}`,
    experience: "5",
    consultationFee: "1000",
  };
  const res = await apiCall("/auth/register-doctor", { method: "POST", body: payload });
  if (res.status !== 201) throw new Error(`register doctor ${suffix} failed: ${res.status} ${res.data?.message}`);
  createdUserIds.push(res.data.data.user._id);
  return { email: payload.email, password: payload.password };
}

async function registerPatient(suffix) {
  const payload = {
    fullname: `QA Analytics Patient ${suffix}`,
    email: `qa.analytics.patient.${suffix}.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `062${String(RUN_ID).slice(-8)}${suffix % 10}`,
    dateOfBirth: "1995-06-15",
    gender: "male",
    bloodGroup: "O+",
  };
  const res = await apiCall("/auth/register-patient", { method: "POST", body: payload });
  if (res.status !== 201) throw new Error(`register patient ${suffix} failed: ${res.status} ${res.data?.message}`);
  createdUserIds.push(res.data.data.user._id);
  return { email: payload.email, password: payload.password };
}

async function login(email, password) {
  const res = await apiCall("/auth/login", { method: "POST", body: { email, password } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return res.cookie;
}

async function getDoctorId(cookie) {
  const res = await apiCall("/dashboard/doctor", { cookie });
  return res.data.doctor._id;
}

async function setPro(doctorMongoId) {
  await Subscription.updateOne({ doctor: doctorMongoId }, { $set: { plan: "paid", status: "active" } });
}

let bookCounter = 0;
async function bookOther(bookerCookie, doctorId, dateStr) {
  bookCounter++;
  return apiCall("/appointments/book", {
    method: "POST",
    cookie: bookerCookie,
    body: {
      doctorId,
      appointmentDate: dateStr,
      bookFor: "other",
      patientName: `QA Analytics Booking ${bookCounter}`,
      patientPhone: `063${String(RUN_ID).slice(-7)}${bookCounter}`,
    },
  });
}

async function monthlySummary(cookie, month) {
  return apiCall(`/appointments/monthly-summary?month=${month}`, { cookie });
}

async function run() {
  console.log(`\nRunning against: ${CONFIG.BASE_URL}\nRun ID: ${RUN_ID}\n`);

  const docA = await registerDoctor("A");
  const docB = await registerDoctor("B");
  const booker = await registerPatient(1);

  const cookieA = await login(docA.email, docA.password);
  const cookieB = await login(docB.email, docB.password);
  const cookieBooker = await login(booker.email, booker.password);

  const doctorAId = await getDoctorId(cookieA);
  const doctorBId = await getDoctorId(cookieB);
  createdDoctorIds.push(doctorAId, doctorBId);

  await setPro(doctorAId);
  await setPro(doctorBId);

  const AUG = "2026-08-15";
  const SEP = "2026-09-10";
  const JULY_MONTH = "2026-07"; // untouched

  console.log("Creating controlled test data...");

  // August: 6 total for Doctor A - 4 paid, 1 cancelled+unpaid, 1 waiting+unpaid
  const augAppts = [];
  for (let i = 0; i < 6; i++) {
    const r = await bookOther(cookieBooker, doctorAId, AUG);
    augAppts.push(r.data?.data?.appointment);
  }
  for (let i = 0; i < 4; i++) {
    await apiCall(`/appointments/${augAppts[i]._id}/pay`, { method: "PATCH", cookie: cookieA });
  }
  await apiCall(`/appointments/${augAppts[4]._id}/cancel`, { method: "PATCH", cookie: cookieBooker }); // cancelled, unpaid
  // augAppts[5] left waiting, unpaid, on purpose

  // September: 8 for Doctor A, all paid
  const sepAppts = [];
  for (let i = 0; i < 8; i++) {
    const r = await bookOther(cookieBooker, doctorAId, SEP);
    sepAppts.push(r.data?.data?.appointment);
  }
  for (const a of sepAppts) {
    await apiCall(`/appointments/${a._id}/pay`, { method: "PATCH", cookie: cookieA });
  }

  // Doctor B: 3 paid appointments in August too - isolation check
  const bookerB = await registerPatient(2);
  const cookieBookerB = await login(bookerB.email, bookerB.password);
  for (let i = 0; i < 3; i++) {
    const r = await bookOther(cookieBookerB, doctorBId, AUG);
    await apiCall(`/appointments/${r.data.data.appointment._id}/pay`, { method: "PATCH", cookie: cookieB });
  }

  console.log(`Doctor A: ${doctorAId} | Doctor B: ${doctorBId}\n`);
  console.log("Monthly Analytics Tests");

  // 1 & 2. August
  const augRes = await monthlySummary(cookieA, "2026-08");
  record("August appointment count correct", augRes.data?.data?.totalAppointments === 6, `got ${augRes.data?.data?.totalAppointments}, expected 6`);
  record("August revenue correct", augRes.data?.data?.totalRevenue === 4000, `got ${augRes.data?.data?.totalRevenue}, expected 4000`);

  // 3 & 4. September
  const sepRes = await monthlySummary(cookieA, "2026-09");
  record("September appointment count correct", sepRes.data?.data?.totalAppointments === 8, `got ${sepRes.data?.data?.totalAppointments}, expected 8`);
  record("September revenue correct", sepRes.data?.data?.totalRevenue === 8000, `got ${sepRes.data?.data?.totalRevenue}, expected 8000`);

  // 5 & 6. No cross-month leakage
  record("August data does not appear in September results", augRes.data?.data?.totalAppointments === 6 && augRes.data?.data?.totalRevenue === 4000);
  record("September data does not appear in August results", sepRes.data?.data?.totalAppointments === 8 && sepRes.data?.data?.totalRevenue === 8000);

  // 7. Zero-appointment month
  const zeroRes = await monthlySummary(cookieA, JULY_MONTH);
  const zeroCorrect = zeroRes.data?.data?.totalAppointments === 0 && zeroRes.data?.data?.totalRevenue === 0;
  record("Month with zero appointments returns 0/0", zeroCorrect, zeroCorrect ? undefined : `got appointments=${zeroRes.data?.data?.totalAppointments}, revenue=${zeroRes.data?.data?.totalRevenue}`);

  // 8. Cancelled appointment revenue rule
  // augAppts[4] is cancelled+unpaid: counted in totalAppointments (6 includes it), excluded from revenue (4000 has no contribution from it)
  const dbCancelled = await Appointment.findById(augAppts[4]._id).lean();
  const cancelledRuleCorrect = dbCancelled?.status === "cancelled" && dbCancelled?.paymentStatus !== "paid" && augRes.data?.data?.totalAppointments === 6 && augRes.data?.data?.totalRevenue === 4000;
  record("Cancelled appointments follow existing revenue rules", cancelledRuleCorrect, cancelledRuleCorrect ? "cancelled appointment counted in total but excluded from revenue, as designed" : `db status="${dbCancelled?.status}", paymentStatus="${dbCancelled?.paymentStatus}"`);

  // 9 & 10. Only the authenticated doctor's data is counted
  const bDoctorAug = await monthlySummary(cookieB, "2026-08");
  const isolationCorrect = bDoctorAug.data?.data?.totalAppointments === 3 && bDoctorAug.data?.data?.totalRevenue === 3000;
  record("Only authenticated doctor's appointments counted", augRes.data?.data?.totalAppointments === 6, "Doctor A's August total unaffected by Doctor B's bookings in the same month");
  record("Another doctor's data not included", isolationCorrect, isolationCorrect ? undefined : `Doctor B's August: appointments=${bDoctorAug.data?.data?.totalAppointments}, revenue=${bDoctorAug.data?.data?.totalRevenue}, expected 3/3000`);

  // 11. Queue reset does not affect historical monthly stats
  await apiCall("/queue/reset", { method: "PATCH", cookie: cookieA });
  const augAfterReset = await monthlySummary(cookieA, "2026-08");
  const unaffectedByReset = augAfterReset.data?.data?.totalAppointments === 6 && augAfterReset.data?.data?.totalRevenue === 4000;
  record("Queue reset does not change historical monthly stats", unaffectedByReset, unaffectedByReset ? undefined : `after reset: appointments=${augAfterReset.data?.data?.totalAppointments}, revenue=${augAfterReset.data?.data?.totalRevenue}`);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log("\nMonthly Analytics Tests");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log("\nFailures:");
    results.filter((r) => !r.passed).forEach((r) => console.log(`- ${r.name}: ${r.detail}`));
  }
  console.log("");
  return failed;
}

async function cleanup() {
  console.log("Cleaning up test data...");
  try {
    const a = await Appointment.deleteMany({ doctor: { $in: createdDoctorIds } });
    const q = await Queue.deleteMany({ doctor: { $in: createdDoctorIds } });
    const s = await Subscription.deleteMany({ doctor: { $in: createdDoctorIds } });
    const d = await Doctor.deleteMany({ _id: { $in: createdDoctorIds } });
    const p = await Patient.deleteMany({ user: { $in: createdUserIds } });
    const u = await User.deleteMany({ _id: { $in: createdUserIds } });
    console.log(`Removed: ${a.deletedCount} appointments, ${q.deletedCount} queues, ${s.deletedCount} subscriptions, ${d.deletedCount} doctors, ${p.deletedCount} patients, ${u.deletedCount} users.`);
  } catch (err) {
    console.error("Cleanup failed:", err.message);
  }
}

async function main() {
  await mongoose.connect(CONFIG.MONGO_URI);
  console.log("Connected to MongoDB.");
  let failed = 1;
  try {
    failed = await run();
  } catch (err) {
    console.error("\nTest run crashed:", err.message);
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();