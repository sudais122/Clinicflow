
import mongoose from "mongoose";

// Adjust this import path only if this script ends up somewhere
// other than the "same depth as controllers/" location described
// above — these paths are copied exactly from your real
// appointment.controller.js imports.
import { User } from "../models/user.models.js";
import { Doctor } from "../models/doctor.models.js";
import { Patient } from "../models/patient.models.js";
import { Appointment } from "../models/appointment.models.js";
import { Queue } from "../models/queue.models.js";

const CONFIG = {
  BASE_URL: process.env.BASE_URL || "http://localhost:8000",
  // Your app.js never calls mongoose.connect() itself (that must live
  // in a server-startup file I haven't seen) — set this to whatever
  // env var / literal URI your real startup file actually uses.
  MONGO_URI: process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/patientflow",
};

const RUN_ID = Date.now();
const results = [];
const createdUserIds = []; // for cleanup
const createdDoctorIds = [];
let createdPatientId = null;

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

// "Today" as PKT sees it, YYYY-MM-DD. Used both when booking (as
// appointmentDate) and when querying the doctor's list (as the
// required `date` param) so both sides agree on the same calendar
// day regardless of what UTC hour the test happens to run at.
function todayPKT() {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function registerDoctor(suffix) {
  const payload = {
    fullname: `QA Test Doctor ${suffix}`,
    email: `qa.appt.doctor.${suffix}.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `030${String(RUN_ID).slice(-8)}`, // 03 + 9 digits, unique-ish per run
    clinicName: `QA Test Clinic ${suffix}`,
    clinicAddress: "123 Test Street, Test City, Test Province",
    specialization: "General Medicine",
    licenseNumber: `QA-LIC-${suffix}-${RUN_ID}`,
    experience: "5",
    consultationFee: "1000",
  };
  const res = await apiCall("/auth/register-doctor", { method: "POST", body: payload });
  if (res.status !== 201) {
    throw new Error(`Failed to register test doctor ${suffix}: ${res.status} ${res.data?.message}`);
  }
  createdUserIds.push(res.data.data.user._id);
  return { email: payload.email, password: payload.password, userId: res.data.data.user._id };
}

async function registerPatient() {
  const payload = {
    fullname: "QA Test Patient",
    email: `qa.appt.patient.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `031${String(RUN_ID).slice(-8)}`,
    dateOfBirth: "1995-06-15",
    gender: "male",
    bloodGroup: "O+",
  };
  const res = await apiCall("/auth/register-patient", { method: "POST", body: payload });
  if (res.status !== 201) {
    throw new Error(`Failed to register test patient: ${res.status} ${res.data?.message}`);
  }
  createdUserIds.push(res.data.data.user._id);
  return { email: payload.email, password: payload.password, userId: res.data.data.user._id };
}

async function login(email, password) {
  const res = await apiCall("/auth/login", { method: "POST", body: { email, password } });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${res.data?.message}`);
  }
  return res.cookie;
}

// GET /dashboard/doctor is the confirmed way this app's own frontend
// resolves a logged-in doctor's real Doctor._id (see loadDashboard()
// in doctor-script.js) — reused here for the same purpose.
async function getDoctorId(cookie) {
  const res = await apiCall("/dashboard/doctor", { cookie });
  if (res.status !== 200) {
    throw new Error(`Could not resolve doctor._id via /dashboard/doctor: ${res.status} ${res.data?.message}`);
  }
  return res.data.doctor._id;
}

async function run() {
  console.log(`\nRunning against: ${CONFIG.BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}\n`);

  // ---- Setup: register 3 doctors (A, B, C) and 1 patient ----
  console.log("Setting up test accounts...");
  const docA = await registerDoctor("A");
  const docB = await registerDoctor("B");
  const docC = await registerDoctor("C");
  const patient = await registerPatient();

  const cookieA = await login(docA.email, docA.password);
  const cookieB = await login(docB.email, docB.password);
  const cookieC = await login(docC.email, docC.password);
  const cookiePatient = await login(patient.email, patient.password);

  const doctorAId = await getDoctorId(cookieA);
  const doctorBId = await getDoctorId(cookieB);
  const doctorCId = await getDoctorId(cookieC);
  createdDoctorIds.push(doctorAId, doctorBId, doctorCId);

  const dateStr = todayPKT();
  console.log(`Setup complete. Doctor A: ${doctorAId}, Doctor B: ${doctorBId}, Doctor C: ${doctorCId}`);
  console.log(`Using calendar day (PKT): ${dateStr}\n`);

  console.log("Appointment Tests");

  // ---------------------------------------------------------
  // 1. Authenticated patient books an appointment → should succeed
  // ---------------------------------------------------------
  const bookRes = await apiCall("/appointments/book", {
    method: "POST",
    cookie: cookiePatient,
    body: { doctorId: doctorAId, appointmentDate: dateStr, bookFor: "self" },
  });
  record(
    "Book appointment (valid)",
    bookRes.status === 201,
    bookRes.status === 201 ? undefined : `expected 201, got ${bookRes.status}: ${bookRes.data?.message}`,
  );
  const appointmentA = bookRes.data?.data?.appointment;

  // ---------------------------------------------------------
  // 2. Verify the appointment actually exists in the database
  //    (direct Mongoose read, bypassing the API entirely)
  // ---------------------------------------------------------
  let dbAppointment = null;
  if (appointmentA?._id) {
    dbAppointment = await Appointment.findById(appointmentA._id).lean();
  }
  record(
    "Appointment exists in database",
    !!dbAppointment,
    dbAppointment ? undefined : "no matching document found in the Appointment collection for the _id returned by the booking API",
  );

  // ---------------------------------------------------------
  // 3. Verify a valid token number is assigned
  // ---------------------------------------------------------
  const tokenValid = Number.isInteger(appointmentA?.tokenNumber) && appointmentA.tokenNumber >= 1;
  record(
    "Valid token number assigned",
    tokenValid,
    tokenValid ? `token #${appointmentA.tokenNumber}` : `tokenNumber was ${appointmentA?.tokenNumber}`,
  );

  // ---------------------------------------------------------
  // 4. Same patient books ANOTHER active appointment with the SAME
  //    doctor → should be rejected (409)
  // ---------------------------------------------------------
  const dupSameDoctorRes = await apiCall("/appointments/book", {
    method: "POST",
    cookie: cookiePatient,
    body: { doctorId: doctorAId, appointmentDate: dateStr, bookFor: "self" },
  });
  record(
    "Reject duplicate active appointment (same doctor)",
    dupSameDoctorRes.status === 409,
    dupSameDoctorRes.status === 409 ? undefined : `expected 409, got ${dupSameDoctorRes.status}: ${dupSameDoctorRes.data?.message}`,
  );

  // ---------------------------------------------------------
  // 5. Same patient books an active appointment with a DIFFERENT
  //    doctor → should be allowed (no cross-doctor restriction)
  // ---------------------------------------------------------
  const diffDoctorRes = await apiCall("/appointments/book", {
    method: "POST",
    cookie: cookiePatient,
    body: { doctorId: doctorBId, appointmentDate: dateStr, bookFor: "self" },
  });
  record(
    "Allow active appointment with a different doctor",
    diffDoctorRes.status === 201,
    diffDoctorRes.status === 201 ? undefined : `expected 201, got ${diffDoctorRes.status}: ${diffDoctorRes.data?.message}`,
  );
  const appointmentB = diffDoctorRes.data?.data?.appointment;

  // ---------------------------------------------------------
  // 6. Verify the doctor can see their appointment
  // ---------------------------------------------------------
  const doctorListRes = await apiCall(`/appointments/doctor?date=${dateStr}&all=true`, { cookie: cookieA });
  const listedAppointments = Array.isArray(doctorListRes.data?.appointments) ? doctorListRes.data.appointments : [];
  const doctorCanSeeIt = listedAppointments.some((a) => a._id === appointmentA?._id);
  record(
    "Doctor can see their appointment",
    doctorCanSeeIt,
    doctorCanSeeIt
      ? undefined
      : `appointment not found in GET /appointments/doctor?date=${dateStr} response (status ${doctorListRes.status}) — could be a genuine bug, or a PKT day-boundary mismatch between how this script computed "${dateStr}" and how pktDayBoundsUTC() computes it server-side`,
  );

  // ---------------------------------------------------------
  // 7. Appointment moves waiting → in-progress
  // ---------------------------------------------------------
  const toInProgressRes = await apiCall(`/appointments/${appointmentA?._id}/status`, {
    method: "PATCH",
    cookie: cookieA,
    body: { status: "in-progress" },
  });
  record(
    "Transition waiting -> in-progress",
    toInProgressRes.status === 200 && toInProgressRes.data?.data?.status === "in-progress",
    toInProgressRes.status === 200
      ? (toInProgressRes.data?.data?.status === "in-progress" ? undefined : `status is "${toInProgressRes.data?.data?.status}", expected "in-progress"`)
      : `expected 200, got ${toInProgressRes.status}: ${toInProgressRes.data?.message}`,
  );

  // ---------------------------------------------------------
  // 8. Appointment moves in-progress → completed
  // ---------------------------------------------------------
  const toCompletedRes = await apiCall(`/appointments/${appointmentA?._id}/status`, {
    method: "PATCH",
    cookie: cookieA,
    body: { status: "completed" },
  });
  record(
    "Transition in-progress -> completed",
    toCompletedRes.status === 200 && toCompletedRes.data?.data?.status === "completed",
    toCompletedRes.status === 200
      ? (toCompletedRes.data?.data?.status === "completed" ? undefined : `status is "${toCompletedRes.data?.data?.status}", expected "completed"`)
      : `expected 200, got ${toCompletedRes.status}: ${toCompletedRes.data?.message}`,
  );

  // 9. Appointment cancellation (use appointmentB, still "waiting")
  const cancelRes = await apiCall(`/appointments/${appointmentB?._id}/cancel`, {
    method: "PATCH",
    cookie: cookiePatient,
  });
  record(
    "Cancel appointment",
    cancelRes.status === 200 && cancelRes.data?.data?.status === "cancelled",
    cancelRes.status === 200
      ? (cancelRes.data?.data?.status === "cancelled" ? undefined : `status is "${cancelRes.data?.data?.status}", expected "cancelled"`)
      : `expected 200, got ${cancelRes.status}: ${cancelRes.data?.message}`,
  );

  // 10. Invalid doctor ID → 400 "Invalid doctor id"
  const badDoctorIdRes = await apiCall("/appointments/book", {
    method: "POST",
    cookie: cookiePatient,
    body: { doctorId: "not-a-valid-object-id", appointmentDate: dateStr, bookFor: "self" },
  });
  record(
    "Reject invalid doctor ID",
    badDoctorIdRes.status === 400,
    badDoctorIdRes.status === 400 ? undefined : `expected 400, got ${badDoctorIdRes.status}: ${badDoctorIdRes.data?.message}`,
  );

  // 11. Invalid appointment ID → 400 "Invalid appointment id"
  const badApptIdRes = await apiCall("/appointments/not-a-valid-object-id/cancel", {
    method: "PATCH",
    cookie: cookiePatient,
  });
  record(
    "Reject invalid appointment ID",
    badApptIdRes.status === 400,
    badApptIdRes.status === 400 ? undefined : `expected 400, got ${badApptIdRes.status}: ${badApptIdRes.data?.message}`,
  );

  // 12. Unauthorized access to ANOTHER doctor's appointment
  const crossDoctorRes = await apiCall(`/appointments/${appointmentA?._id}/status`, {
    method: "PATCH",
    cookie: cookieC,
    body: { status: "cancelled" },
  });
  record(
    "Reject unauthorized cross-doctor access",
    crossDoctorRes.status === 403,
    crossDoctorRes.status === 403 ? undefined : `expected 403, got ${crossDoctorRes.status}: ${crossDoctorRes.data?.message}`,
  );


  const [raceRes1, raceRes2] = await Promise.all([
    apiCall("/appointments/book", {
      method: "POST",
      cookie: cookiePatient,
      body: { doctorId: doctorCId, appointmentDate: dateStr, bookFor: "self" },
    }),
    apiCall("/appointments/book", {
      method: "POST",
      cookie: cookiePatient,
      body: { doctorId: doctorCId, appointmentDate: dateStr, bookFor: "self" },
    }),
  ]);
  const successCount = [raceRes1, raceRes2].filter((r) => r.status === 201).length;
  const raceSafe = successCount === 1;
  record(
    "Concurrent duplicate bookings do not both succeed",
    raceSafe,
    raceSafe
      ? undefined
      : successCount === 2
        ? "BOTH concurrent requests succeeded (201/201) — this is a real race condition: the duplicate check (a plain findOne before the transaction) is not atomic, so two near-simultaneous requests can both pass it before either commits. This is an application logic gap, not a test bug — not modifying your code, per your instructions."
        : `expected exactly 1 success, got ${successCount} (statuses: ${raceRes1.status}, ${raceRes2.status})`,
  );

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}\n`);

  if (failed > 0) {
    console.log("Failed test details:");
    results.filter((r) => !r.passed).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`));
  }

  return failed;
}

async function cleanup() {
  console.log("\nCleaning up test data (direct DB access — no delete endpoints exist in the API)...");
  try {
    const apptResult = await Appointment.deleteMany({ doctor: { $in: createdDoctorIds } });
    const queueResult = await Queue.deleteMany({ doctor: { $in: createdDoctorIds } });
    const doctorResult = await Doctor.deleteMany({ _id: { $in: createdDoctorIds } });
    const patientResult = createdPatientId ? await Patient.deleteMany({ _id: createdPatientId }) : { deletedCount: 0 };
    const userResult = await User.deleteMany({ _id: { $in: createdUserIds } });
    console.log(
      `Removed: ${apptResult.deletedCount} appointment(s), ${queueResult.deletedCount} queue(s), ${doctorResult.deletedCount} doctor(s), ${patientResult.deletedCount} patient(s), ${userResult.deletedCount} user(s).`,
    );
  } catch (err) {
    console.error("Cleanup failed:", err.message);
    console.error("Test data may remain in the database — it is clearly namespaced with this run's timestamp and test emails, so it's safe to remove manually if needed.");
  }
}

async function main() {
  await mongoose.connect(CONFIG.MONGO_URI);
  console.log("Connected to MongoDB for direct verification/cleanup.");

  let failed = 1;
  try {
    failed = await run();
    const patientDoc = await Patient.findOne({ user: { $in: createdUserIds } });
    if (patientDoc) createdPatientId = patientDoc._id;
  } catch (err) {
    console.error("\nTest run crashed:", err.message);
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();