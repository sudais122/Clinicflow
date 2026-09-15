
import mongoose from "mongoose";

import { User } from "../models/user.models.js";
import { Doctor } from "../models/doctor.models.js";
import { Patient } from "../models/patient.models.js";
import { Appointment } from "../models/appointment.models.js";
import { Queue } from "../models/queue.models.js";

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
  } catch {
    /* no JSON body */
  }

  const setCookie = res.headers.getSetCookie
    ? res.headers.getSetCookie()
    : [res.headers.get("set-cookie")].filter(Boolean);
  const cookieHeader = setCookie
    .join("; ")
    .split(",")
    .map((c) => c.trim().split(";")[0])
    .join("; ");

  return { status: res.status, ok: res.ok, data: json, cookie: cookieHeader };
}

function todayPKT() {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function registerDoctor(suffix) {
  const payload = {
    fullname: `QA Queue Doctor ${suffix}`,
    email: `qa.queue.doctor.${suffix}.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `035${String(RUN_ID).slice(-8)}${suffix.charCodeAt(0) % 10}`,
    clinicName: `QA Queue Clinic ${suffix}`,
    clinicAddress: "789 Test Boulevard, Test City, Test Province",
    specialization: "General Medicine",
    licenseNumber: `QA-QUE-${suffix}-${RUN_ID}`,
    experience: "5",
    consultationFee: "1000",
  };
  const res = await apiCall("/auth/register-doctor", { method: "POST", body: payload });
  if (res.status !== 201) {
    throw new Error(`Failed to register test doctor ${suffix}: ${res.status} ${res.data?.message}`);
  }
  createdUserIds.push(res.data.data.user._id);
  return { email: payload.email, password: payload.password };
}

async function registerPatient(suffix) {
  const payload = {
    fullname: `QA Queue Patient ${suffix}`,
    email: `qa.queue.patient.${suffix}.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `036${String(RUN_ID).slice(-8)}${suffix.charCodeAt(0) % 10}`,
    dateOfBirth: "1995-06-15",
    gender: "male",
    bloodGroup: "O+",
  };
  const res = await apiCall("/auth/register-patient", { method: "POST", body: payload });
  if (res.status !== 201) {
    throw new Error(`Failed to register test patient ${suffix}: ${res.status} ${res.data?.message}`);
  }
  createdUserIds.push(res.data.data.user._id);
  return { email: payload.email, password: payload.password };
}

async function login(email, password) {
  const res = await apiCall("/auth/login", { method: "POST", body: { email, password } });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${res.data?.message}`);
  return res.cookie;
}

async function getDoctorId(cookie) {
  const res = await apiCall("/dashboard/doctor", { cookie });
  if (res.status !== 200) throw new Error(`Could not resolve doctor._id: ${res.status} ${res.data?.message}`);
  return res.data.doctor._id;
}

async function getDoctorList(cookie, dateStr) {
  const res = await apiCall(`/appointments/doctor?date=${dateStr}&all=true`, { cookie });
  return Array.isArray(res.data?.appointments) ? res.data.appointments : [];
}

async function getQueueStatus(cookie, doctorId) {
  return apiCall(`/queue/${doctorId}`, { cookie });
}

async function run() {
  console.log(`\nRunning against: ${CONFIG.BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}\n`);

  console.log("Setting up test accounts...");
  const docA = await registerDoctor("A");
  const docB = await registerDoctor("B"); // untouched, for isolation test
  const patient1 = await registerPatient("1");
  const patient2 = await registerPatient("2");

  const cookieA = await login(docA.email, docA.password);
  const cookieB = await login(docB.email, docB.password);
  const cookieP1 = await login(patient1.email, patient1.password);
  const cookieP2 = await login(patient2.email, patient2.password);

  const doctorAId = await getDoctorId(cookieA);
  const doctorBId = await getDoctorId(cookieB);
  createdDoctorIds.push(doctorAId, doctorBId);

  const dateStr = todayPKT();
  console.log(`Doctor A: ${doctorAId}`);
  console.log(`Doctor B: ${doctorBId} (kept untouched, for the isolation test)\n`);

  console.log("Doctor Queue Workflow Tests");

  // ---------------------------------------------------------
  // 1. Doctor opens the clinic
  // ---------------------------------------------------------
  const openRes = await apiCall("/queue/start", { method: "PATCH", cookie: cookieA });
  record(
    "Doctor opens the clinic",
    openRes.status === 200 && openRes.data?.data?.clinicStatus === "open",
    openRes.status === 200 ? undefined : `expected 200, got ${openRes.status}: ${openRes.data?.message}`,
  );

  // ---------------------------------------------------------
  // 2 & 3. Patient books an appointment; it enters "waiting"
  // ---------------------------------------------------------
  const book1Res = await apiCall("/appointments/book", {
    method: "POST",
    cookie: cookieP1,
    body: { doctorId: doctorAId, appointmentDate: dateStr, bookFor: "self" },
  });
  const appt1 = book1Res.data?.data?.appointment;
  record(
    "Patient books an appointment (enters waiting)",
    book1Res.status === 201 && appt1?.status === "waiting",
    book1Res.status === 201
      ? (appt1?.status === "waiting" ? undefined : `status was "${appt1?.status}", expected "waiting"`)
      : `booking failed: ${book1Res.status} ${book1Res.data?.message}`,
  );

  // A second patient books too — needed to test "another patient
  // remains in the queue" further down.
  const book2Res = await apiCall("/appointments/book", {
    method: "POST",
    cookie: cookieP2,
    body: { doctorId: doctorAId, appointmentDate: dateStr, bookFor: "self" },
  });
  const appt2 = book2Res.data?.data?.appointment;

  // ---------------------------------------------------------
  // 4 & 5. Doctor starts the appointment -> becomes in-progress
  // (this is the FIRST /queue/next call: nowServing 0 -> 1, nothing
  // to complete yet since nothing was being served before this)
  // ---------------------------------------------------------
  const serve1Res = await apiCall("/queue/next", { method: "PATCH", cookie: cookieA });
  const listAfterServe1 = await getDoctorList(cookieA, dateStr);
  const appt1AfterServe1 = listAfterServe1.find((a) => a._id === appt1?._id);
  record(
    "Doctor starts the appointment (waiting -> in-progress)",
    serve1Res.status === 200 && appt1AfterServe1?.status === "in-progress",
    serve1Res.status === 200
      ? (appt1AfterServe1?.status === "in-progress" ? undefined : `status is "${appt1AfterServe1?.status}", expected "in-progress"`)
      : `expected 200, got ${serve1Res.status}: ${serve1Res.data?.message}`,
  );

  // ---------------------------------------------------------
  // 7 (tested here, before completion, because this is the moment
  // it's actually meaningful): the second patient is still waiting,
  // untouched by the first patient being served.
  // ---------------------------------------------------------
  const appt2WhileServing = listAfterServe1.find((a) => a._id === appt2?._id);
  record(
    "Another waiting patient remains in the queue",
    appt2WhileServing?.status === "waiting",
    appt2WhileServing?.status === "waiting" ? undefined : `patient 2's status is "${appt2WhileServing?.status}", expected "waiting"`,
  );

  // ---------------------------------------------------------
  // 6. Doctor completes the appointment.
  // Since patient 2 IS waiting (lastToken=2 > nowServing=1), this
  // /queue/next call is valid: it completes token 1 (current) AND
  // advances to + starts token 2, in one atomic action — this is
  // real behavior, not a test simplification.
  // ---------------------------------------------------------
  const serve2Res = await apiCall("/queue/next", { method: "PATCH", cookie: cookieA });
  const listAfterServe2 = await getDoctorList(cookieA, dateStr);
  const appt1Completed = listAfterServe2.find((a) => a._id === appt1?._id);
  const appt2InProgress = listAfterServe2.find((a) => a._id === appt2?._id);
  record(
    "Doctor completes the appointment",
    serve2Res.status === 200 && appt1Completed?.status === "completed",
    serve2Res.status === 200
      ? (appt1Completed?.status === "completed" ? undefined : `status is "${appt1Completed?.status}", expected "completed"`)
      : `expected 200, got ${serve2Res.status}: ${serve2Res.data?.message}`,
  );

  // ---------------------------------------------------------
  // 8. When the LAST active patient (patient 2, now in-progress) is
  // completed, the queue should become empty. Per the note at the
  // top of this file: with no one waiting after patient 2,
  // /queue/next would just 400 here — completion has to go through
  // the direct status endpoint instead. This is real, confirmed
  // application behavior.
  // ---------------------------------------------------------
  const completeAppt2Res = await apiCall(`/appointments/${appt2?._id}/status`, {
    method: "PATCH",
    cookie: cookieA,
    body: { status: "completed" },
  });

  // syncQueueEmptyState runs as a post-commit side effect — give it
  // a brief moment before checking, since it's fire-and-forget from
  // the controller's perspective.
  await new Promise((r) => setTimeout(r, 500));

  const queueStatusAfterEmpty = await getQueueStatus(cookieA, doctorAId);
  const queueBecameEmpty = !!queueStatusAfterEmpty.data?.queueEmptyAt;
  record(
    "Queue becomes empty when the last active patient is completed",
    completeAppt2Res.status === 200 && queueBecameEmpty,
    completeAppt2Res.status === 200
      ? (queueBecameEmpty ? undefined : `queueEmptyAt is still null after completing the last active appointment`)
      : `completing patient 2 failed: ${completeAppt2Res.status} ${completeAppt2Res.data?.message}`,
  );

  // ---------------------------------------------------------
  // 9. Doctor is NOT automatically marked as manually closing the
  // clinic just because the queue emptied.
  // ---------------------------------------------------------
  record(
    "Clinic is not auto-closed when the queue empties",
    queueStatusAfterEmpty.data?.clinicStatus === "open",
    queueStatusAfterEmpty.data?.clinicStatus === "open" ? undefined : `clinicStatus is "${queueStatusAfterEmpty.data?.clinicStatus}", expected it to remain "open"`,
  );

  // ---------------------------------------------------------
  // 10. The separate Close Clinic action still works
  // ---------------------------------------------------------
  const closeRes = await apiCall("/queue/end", { method: "PATCH", cookie: cookieA });
  const queueStatusAfterClose = await getQueueStatus(cookieA, doctorAId);
  record(
    "Close Clinic action works",
    closeRes.status === 200 && queueStatusAfterClose.data?.clinicStatus === "closed",
    closeRes.status === 200
      ? (queueStatusAfterClose.data?.clinicStatus === "closed" ? undefined : `clinicStatus is "${queueStatusAfterClose.data?.clinicStatus}" after closing, expected "closed"`)
      : `expected 200, got ${closeRes.status}: ${closeRes.data?.message}`,
  );

  // ---------------------------------------------------------
  // 11. Reopening the clinic works correctly
  // ---------------------------------------------------------
  const reopenRes = await apiCall("/queue/start", { method: "PATCH", cookie: cookieA });
  const queueStatusAfterReopen = await getQueueStatus(cookieA, doctorAId);
  record(
    "Reopening the clinic works correctly",
    reopenRes.status === 200 && queueStatusAfterReopen.data?.clinicStatus === "open",
    reopenRes.status === 200
      ? (queueStatusAfterReopen.data?.clinicStatus === "open" ? undefined : `clinicStatus is "${queueStatusAfterReopen.data?.clinicStatus}" after reopening, expected "open"`)
      : `expected 200, got ${reopenRes.status}: ${reopenRes.data?.message}`,
  );

  // ---------------------------------------------------------
  // 12. Completed appointment history remains in the database
  // (direct Mongoose read, bypassing the API entirely)
  // ---------------------------------------------------------
  const dbAppt1 = appt1?._id ? await Appointment.findById(appt1._id).lean() : null;
  const dbAppt2 = appt2?._id ? await Appointment.findById(appt2._id).lean() : null;
  const historyIntact = dbAppt1?.status === "completed" && dbAppt2?.status === "completed";
  record(
    "Completed appointment history remains in the database",
    historyIntact,
    historyIntact
      ? undefined
      : `appointment 1: ${dbAppt1 ? `found, status "${dbAppt1.status}"` : "NOT FOUND"}; appointment 2: ${dbAppt2 ? `found, status "${dbAppt2.status}"` : "NOT FOUND"}`,
  );

  // ---------------------------------------------------------
  // 13. Queue state is isolated between different doctors
  // (Doctor B has never been touched by anything above)
  // ---------------------------------------------------------
  const queueStatusB = await getQueueStatus(cookieB, doctorBId);
  const isolated = queueStatusB.data?.clinicStatus === "closed" && queueStatusB.data?.lastToken === 0;
  record(
    "Queue state is isolated between doctors",
    isolated,
    isolated
      ? undefined
      : `Doctor B's queue shows clinicStatus="${queueStatusB.data?.clinicStatus}", lastToken=${queueStatusB.data?.lastToken} — expected the default untouched state ("closed", 0), independent of everything done to Doctor A above`,
  );

  // ---------------------------------------------------------
  // Summary
  // ---------------------------------------------------------
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log("\nDoctor Queue Workflow Tests");
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
  console.log("Cleaning up test data (direct DB access — no delete endpoints exist in the API)...");
  try {
    const apptResult = await Appointment.deleteMany({ doctor: { $in: createdDoctorIds } });
    const queueResult = await Queue.deleteMany({ doctor: { $in: createdDoctorIds } });
    const doctorResult = await Doctor.deleteMany({ _id: { $in: createdDoctorIds } });
    const patientResult = await Patient.deleteMany({ user: { $in: createdUserIds } });
    const userResult = await User.deleteMany({ _id: { $in: createdUserIds } });
    console.log(
      `Removed: ${apptResult.deletedCount} appointment(s), ${queueResult.deletedCount} queue(s), ${doctorResult.deletedCount} doctor(s), ${patientResult.deletedCount} patient(s), ${userResult.deletedCount} user(s).`,
    );
  } catch (err) {
    console.error("Cleanup failed:", err.message);
    console.error("Test data remains, clearly namespaced with this run's timestamp — safe to remove manually.");
  }
}

async function main() {
  await mongoose.connect(CONFIG.MONGO_URI);
  console.log("Connected to MongoDB for verification/cleanup.");

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