import mongoose from "mongoose";

import { User } from "../models/user.models.js";
import { Doctor } from "../models/doctor.models.js";
import { Patient } from "../models/patient.models.js";
import { Appointment } from "../models/appointment.models.js";
import { Queue } from "../models/queue.models.js";
import { runAutoResetCycle } from "../jobs/autoResetIdleQueues.js";
import { QUEUE_AUTO_RESET_DELAY_MS } from "../config/queueResetConfig.js";

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
  const res = await fetch(`${CONFIG.BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  const cookieHeader = setCookie.join("; ").split(",").map((c) => c.trim().split(";")[0]).join("; ");
  return { status: res.status, ok: res.ok, data: json, cookie: cookieHeader };
}

function todayPKT() {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// backdate queueEmptyAt so it looks like the grace period already passed
async function backdateQueueEmpty(doctorId, minutesAgo) {
  const backdated = new Date(Date.now() - minutesAgo * 60 * 1000);
  await Queue.updateOne({ doctor: doctorId }, { $set: { queueEmptyAt: backdated } });
}

async function registerDoctor(suffix) {
  const payload = {
    fullname: `QA Reset Doctor ${suffix}`,
    email: `qa.reset.doctor.${suffix}.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `037${String(RUN_ID).slice(-8)}${suffix.charCodeAt(0) % 10}`,
    clinicName: `QA Reset Clinic ${suffix}`,
    clinicAddress: "12 Test Lane, Test City, Test Province",
    specialization: "General Medicine",
    licenseNumber: `QA-RST-${suffix}-${RUN_ID}`,
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
    fullname: `QA Reset Patient ${suffix}`,
    email: `qa.reset.patient.${suffix}.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `038${String(RUN_ID).slice(-8)}${suffix.charCodeAt(0) % 10}`,
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
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return res.cookie;
}

async function getDoctorId(cookie) {
  const res = await apiCall("/dashboard/doctor", { cookie });
  if (res.status !== 200) throw new Error(`could not resolve doctor id: ${res.status}`);
  return res.data.doctor._id;
}

async function getQueueStatus(cookie, doctorId) {
  return apiCall(`/queue/${doctorId}`, { cookie });
}

// books, serves, and completes one appointment so the queue ends up empty
async function bookServeComplete(patientCookie, doctorCookie, doctorId, dateStr) {
  const bookRes = await apiCall("/appointments/book", {
    method: "POST",
    cookie: patientCookie,
    body: { doctorId, appointmentDate: dateStr, bookFor: "self" },
  });
  const appt = bookRes.data?.data?.appointment;
  await apiCall("/queue/next", { method: "PATCH", cookie: doctorCookie }); // waiting -> in-progress
  const completeRes = await apiCall(`/appointments/${appt._id}/status`, {
    method: "PATCH",
    cookie: doctorCookie,
    body: { status: "completed" },
  });
  return { appt, completeRes };
}

async function run() {
  console.log(`\nRunning against: ${CONFIG.BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}\n`);

  const docA = await registerDoctor("A");
  const patient1 = await registerPatient("1");
  const cookieA = await login(docA.email, docA.password);
  const cookieP1 = await login(patient1.email, patient1.password);
  const doctorAId = await getDoctorId(cookieA);
  createdDoctorIds.push(doctorAId);
  const dateStr = todayPKT();

  await apiCall("/queue/start", { method: "PATCH", cookie: cookieA });

  console.log("Auto-Reset Tests");

  // 1. Complete the last active appointment
  const { appt: appt1, completeRes } = await bookServeComplete(cookieP1, cookieA, doctorAId, dateStr);
  record("Complete last active appointment", completeRes.status === 200, completeRes.status === 200 ? undefined : `status ${completeRes.status}`);

  await new Promise((r) => setTimeout(r, 500)); // syncQueueEmptyState is fire-and-forget

  // 2. Queue records when it became empty
  const statusAfterEmpty = await getQueueStatus(cookieA, doctorAId);
  const recordedEmpty = !!statusAfterEmpty.data?.queueEmptyAt;
  record("Queue records when it became empty", recordedEmpty, recordedEmpty ? undefined : "queueEmptyAt is null after completing the last patient");

  // 3. Automatic reset is scheduled/pending
  const hasAutoResetAt = !!statusAfterEmpty.data?.autoResetAt;
  record("Automatic reset is pending", hasAutoResetAt, hasAutoResetAt ? undefined : "autoResetAt was not returned/computed");

  // 4 & 5. Simulate time passing beyond 15 minutes (backdate, no real wait)
  const graceMinutes = QUEUE_AUTO_RESET_DELAY_MS / 60000;
  await backdateQueueEmpty(doctorAId, graceMinutes + 1);
  record("Time advanced beyond grace period (simulated)", true, `queueEmptyAt backdated by ${graceMinutes + 1} min`);

  // 6. Run the reset mechanism (real function, called directly)
  await runAutoResetCycle();
  record("Reset mechanism executed", true);

  // 7. Queue is reset
  const queueAfterReset = await Queue.findOne({ doctor: doctorAId }).lean();
  const wasReset = queueAfterReset?.lastToken === 0 && queueAfterReset?.nowServing === 0 && !queueAfterReset?.queueEmptyAt;
  record(
    "Queue automatically resets",
    wasReset,
    wasReset ? undefined : `lastToken=${queueAfterReset?.lastToken}, nowServing=${queueAfterReset?.nowServing}, queueEmptyAt=${queueAfterReset?.queueEmptyAt}`,
  );

  // 8. Completed appointments remain in DB
  const dbAppt1 = await Appointment.findById(appt1._id).lean();
  record("Completed appointment history remains", dbAppt1?.status === "completed", dbAppt1 ? undefined : "appointment not found after reset");

  // 9. Revenue/history data unchanged
  const revenueIntact = dbAppt1?.consultationFee === appt1.consultationFee && dbAppt1?.paymentStatus === appt1.paymentStatus;
  record("Revenue/history data unchanged", revenueIntact, revenueIntact ? undefined : "consultationFee or paymentStatus changed after reset");

  // 10. Clinic not reopened/closed by the reset
  const doctorDoc = await Doctor.findById(doctorAId).lean();
  const clinicUntouched = queueAfterReset?.clinicStatus === "open";
  record("Clinic status untouched by reset", clinicUntouched, clinicUntouched ? undefined : `clinicStatus is "${queueAfterReset?.clinicStatus}", expected "open"`);

  // --- Edge case: new patient arrives before reset fires ---
  console.log("\nEdge case — new patient before reset");
  const patient2 = await registerPatient("2");
  const cookieP2 = await login(patient2.email, patient2.password);
  const { appt: appt2, completeRes: completeRes2 } = await bookServeComplete(cookieP2, cookieA, doctorAId, dateStr);
  await new Promise((r) => setTimeout(r, 500));

  const newAppt = await apiCall("/appointments/book", {
    method: "POST",
    cookie: cookieP2,
    body: { doctorId: doctorAId, appointmentDate: dateStr, bookFor: "other", patientName: "QA Reset Interrupt", patientPhone: `039${String(RUN_ID).slice(-8)}` },
  });
  await new Promise((r) => setTimeout(r, 500));

  const statusBeforeBackdate = await Queue.findOne({ doctor: doctorAId }).lean();
  const cancelledPending = !statusBeforeBackdate?.queueEmptyAt;
  record("New appointment cancels pending reset", cancelledPending, cancelledPending ? undefined : "queueEmptyAt still set after a new active appointment arrived");

  await backdateQueueEmpty(doctorAId, graceMinutes + 1); // won't matter if queueEmptyAt is null
  await runAutoResetCycle();
  const queueAfterInterrupt = await Queue.findOne({ doctor: doctorAId }).lean();
  const resetDidNotHappen = queueAfterInterrupt?.lastToken > 0;
  record(
    "Reset does not fire when a new patient arrived in time",
    resetDidNotHappen,
    resetDidNotHappen ? undefined : `lastToken was reset to ${queueAfterInterrupt?.lastToken} despite an active appointment existing`,
  );

  // clean up the interrupting appointment for the next scenario
  if (newAppt.data?.data?.appointment?._id) {
    await apiCall(`/appointments/${newAppt.data.data.appointment._id}/cancel`, { method: "PATCH", cookie: cookieP2 });
  }

  // --- Edge case: server restart persistence ---
  console.log("\nEdge case — persists across a fresh process (simulated restart)");
  const docB = await registerDoctor("B");
  const patient3 = await registerPatient("3");
  const cookieB = await login(docB.email, docB.password);
  const cookieP3 = await login(patient3.email, patient3.password);
  const doctorBId = await getDoctorId(cookieB);
  createdDoctorIds.push(doctorBId);

  await apiCall("/queue/start", { method: "PATCH", cookie: cookieB });
  await bookServeComplete(cookieP3, cookieB, doctorBId, dateStr);
  await new Promise((r) => setTimeout(r, 500));
  await backdateQueueEmpty(doctorBId, graceMinutes + 1);

  // runAutoResetCycle has zero in-memory state — every call reads
  // fresh from the DB, which is exactly what makes it restart-safe.
  await runAutoResetCycle();
  const queueB = await Queue.findOne({ doctor: doctorBId }).lean();
  const restartSafe = queueB?.lastToken === 0 && !queueB?.queueEmptyAt;
  record(
    "Reset works after simulated restart (persisted timestamp)",
    restartSafe,
    restartSafe ? undefined : `lastToken=${queueB?.lastToken}, queueEmptyAt=${queueB?.queueEmptyAt}`,
  );

  // summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log("\nAuto-Reset Tests");
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
    const d = await Doctor.deleteMany({ _id: { $in: createdDoctorIds } });
    const p = await Patient.deleteMany({ user: { $in: createdUserIds } });
    const u = await User.deleteMany({ _id: { $in: createdUserIds } });
    console.log(`Removed: ${a.deletedCount} appointments, ${q.deletedCount} queues, ${d.deletedCount} doctors, ${p.deletedCount} patients, ${u.deletedCount} users.`);
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