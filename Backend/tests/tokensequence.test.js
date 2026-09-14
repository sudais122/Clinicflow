
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
    fullname: `QA Token Doctor ${suffix}`,
    email: `qa.token.doctor.${suffix}.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `032${String(RUN_ID).slice(-8)}${suffix.charCodeAt(0) % 10}`,
    clinicName: `QA Token Clinic ${suffix}`,
    clinicAddress: "456 Test Avenue, Test City, Test Province",
    specialization: "General Medicine",
    licenseNumber: `QA-TOK-${suffix}-${RUN_ID}`,
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

async function registerPatient() {
  const payload = {
    fullname: "QA Token Patient",
    email: `qa.token.patient.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `033${String(RUN_ID).slice(-8)}`,
    dateOfBirth: "1995-06-15",
    gender: "male",
    bloodGroup: "O+",
  };
  const res = await apiCall("/auth/register-patient", { method: "POST", body: payload });
  if (res.status !== 201) {
    throw new Error(`Failed to register test patient: ${res.status} ${res.data?.message}`);
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

// bookFor:"other" with a distinct name/phone each time — used
// throughout this suite so multiple bookings against the SAME doctor
// don't collide with the "duplicate active appointment" 409 rule,
// which is a different concern from what this suite is testing.
async function bookOther(cookie, doctorId, dateStr, label, phoneSuffix) {
  return apiCall("/appointments/book", {
    method: "POST",
    cookie,
    body: {
      doctorId,
      appointmentDate: dateStr,
      bookFor: "other",
      patientName: `Token Test ${label}`,
      patientPhone: `034${String(RUN_ID).slice(-7)}${phoneSuffix}`,
    },
  });
}

async function getDoctorList(cookie, dateStr) {
  const res = await apiCall(`/appointments/doctor?date=${dateStr}&all=true`, { cookie });
  return Array.isArray(res.data?.appointments) ? res.data.appointments : [];
}

async function run() {
  console.log(`\nRunning against: ${CONFIG.BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}\n`);

  console.log("Setting up test accounts...");
  const docA = await registerDoctor("A");
  const docB = await registerDoctor("B");
  const patient = await registerPatient();

  const cookieA = await login(docA.email, docA.password);
  const cookieB = await login(docB.email, docB.password);
  const cookiePatient = await login(patient.email, patient.password);

  const doctorAId = await getDoctorId(cookieA);
  const doctorBId = await getDoctorId(cookieB);
  createdDoctorIds.push(doctorAId, doctorBId);

  const dateStr = todayPKT();
  console.log(`Doctor A: ${doctorAId}`);
  console.log(`Doctor B: ${doctorBId}`);
  console.log(`Calendar day (PKT): ${dateStr}\n`);

  console.log("Token Sequence Tests");

  // ---------------------------------------------------------
  // 1-3. First three appointments for Doctor A get tokens 1, 2, 3
  // ---------------------------------------------------------
  const book1 = await bookOther(cookiePatient, doctorAId, dateStr, "One", "01");
  record(
    "First appointment gets token 1",
    book1.status === 201 && book1.data?.data?.appointment?.tokenNumber === 1,
    book1.status === 201
      ? `token was ${book1.data?.data?.appointment?.tokenNumber}`
      : `booking failed: ${book1.status} ${book1.data?.message}`,
  );
  const appt1 = book1.data?.data?.appointment;

  const book2 = await bookOther(cookiePatient, doctorAId, dateStr, "Two", "02");
  record(
    "Second appointment gets token 2",
    book2.status === 201 && book2.data?.data?.appointment?.tokenNumber === 2,
    book2.status === 201
      ? `token was ${book2.data?.data?.appointment?.tokenNumber}`
      : `booking failed: ${book2.status} ${book2.data?.message}`,
  );
  const appt2 = book2.data?.data?.appointment;

  const book3 = await bookOther(cookiePatient, doctorAId, dateStr, "Three", "03");
  record(
    "Third appointment gets token 3",
    book3.status === 201 && book3.data?.data?.appointment?.tokenNumber === 3,
    book3.status === 201
      ? `token was ${book3.data?.data?.appointment?.tokenNumber}`
      : `booking failed: ${book3.status} ${book3.data?.message}`,
  );
  const appt3 = book3.data?.data?.appointment;

  // ---------------------------------------------------------
  // 4. Verify tokens are assigned in the correct sequence
  // ---------------------------------------------------------
  const listAfterThree = await getDoctorList(cookieA, dateStr);
  const tokensAfterThree = listAfterThree.map((a) => a.tokenNumber).sort((a, b) => a - b);
  const sequenceCorrect = JSON.stringify(tokensAfterThree) === JSON.stringify([1, 2, 3]);
  record(
    "Tokens assigned in correct sequence",
    sequenceCorrect,
    sequenceCorrect ? undefined : `expected [1,2,3], got [${tokensAfterThree.join(",")}]`,
  );

  // ---------------------------------------------------------
  // 5 & 6. Complete token 1 via the real Serve flow, verify token 2
  // becomes the next (currently-serving) patient.
  //
  // nextPatient's own logic: the FIRST call only advances nowServing
  // and marks the new current token in-progress (nothing to complete
  // yet, since nowServing started at 0). The SECOND call is what
  // actually completes token 1 (the one just served) while advancing
  // to and starting token 2. This is not a quirk of this test — it's
  // exactly how PATCH /queue/next is written.
  // ---------------------------------------------------------
  const startClinicRes = await apiCall("/queue/start", { method: "PATCH", cookie: cookieA });
  if (startClinicRes.status !== 200) {
    record("Complete token 1", false, `could not open the clinic to test Serve: ${startClinicRes.status} ${startClinicRes.data?.message}`);
    record("Token 2 becomes next patient", false, "skipped — clinic could not be opened");
  } else {
    await apiCall("/queue/next", { method: "PATCH", cookie: cookieA }); // 1st call: nowServing 0 -> 1, token1 in-progress
    const serveRes2 = await apiCall("/queue/next", { method: "PATCH", cookie: cookieA }); // 2nd call: completes token1, nowServing 1 -> 2, token2 in-progress

    const listAfterServe = await getDoctorList(cookieA, dateStr);
    const token1After = listAfterServe.find((a) => a.tokenNumber === 1);
    const token2After = listAfterServe.find((a) => a.tokenNumber === 2);

    record(
      "Complete token 1",
      token1After?.status === "completed",
      token1After?.status === "completed" ? undefined : `token 1 status is "${token1After?.status}", expected "completed"`,
    );

    const nowServingIs2 = serveRes2.data?.data?.currentToken === 2;
    const token2InProgress = token2After?.status === "in-progress";
    record(
      "Token 2 becomes next patient",
      nowServingIs2 && token2InProgress,
      nowServingIs2 && token2InProgress
        ? undefined
        : `queue.nowServing after serve = ${serveRes2.data?.data?.currentToken} (expected 2), token 2 status = "${token2After?.status}" (expected "in-progress")`,
    );
  }

  // ---------------------------------------------------------
  // 7. Cancel token 3 (still "waiting"), verify token handling
  //    stays correct — the cancelled token is not reused, and a new
  //    booking continues the sequence from lastToken, not from a
  //    gap left by the cancellation.
  // ---------------------------------------------------------
  const cancelRes = await apiCall(`/appointments/${appt3?._id}/cancel`, { method: "PATCH", cookie: cookiePatient });
  const book4 = await bookOther(cookiePatient, doctorAId, dateStr, "Four", "04");
  const cancelHandledCorrectly =
    cancelRes.status === 200 &&
    cancelRes.data?.data?.status === "cancelled" &&
    book4.status === 201 &&
    book4.data?.data?.appointment?.tokenNumber === 4;
  record(
    "Cancellation does not disrupt token sequence",
    cancelHandledCorrectly,
    cancelHandledCorrectly
      ? undefined
      : `cancel status ${cancelRes.status} (appointment status "${cancelRes.data?.data?.status}"), new booking got token ${book4.data?.data?.appointment?.tokenNumber} (expected 4, continuing past the cancelled token 3, not reusing it)`,
  );

  // ---------------------------------------------------------
  // 8. Completed appointments are not renumbered
  // ---------------------------------------------------------
  const listAfterCancel = await getDoctorList(cookieA, dateStr);
  const token1Final = listAfterCancel.find((a) => a._id === appt1?._id);
  record(
    "Completed appointment token unchanged",
    token1Final?.tokenNumber === 1,
    token1Final?.tokenNumber === 1 ? undefined : `token 1's appointment now shows tokenNumber ${token1Final?.tokenNumber}`,
  );

  // ---------------------------------------------------------
  // 9. Refreshing/reloading does not change token numbers
  //    (two independent GETs should return identical token sets)
  // ---------------------------------------------------------
  const readA = await getDoctorList(cookieA, dateStr);
  const readB = await getDoctorList(cookieA, dateStr);
  const tokensA = readA.map((a) => `${a._id}:${a.tokenNumber}`).sort();
  const tokensB = readB.map((a) => `${a._id}:${a.tokenNumber}`).sort();
  const stableAcrossReads = JSON.stringify(tokensA) === JSON.stringify(tokensB);
  record(
    "Token numbers stable across repeated reads",
    stableAcrossReads,
    stableAcrossReads ? undefined : "two consecutive reads of the same day returned different token assignments",
  );

  // ---------------------------------------------------------
  // 10. Two different doctors have independent token sequences
  // ---------------------------------------------------------
  const bookForB = await apiCall("/appointments/book", {
    method: "POST",
    cookie: cookiePatient,
    body: { doctorId: doctorBId, appointmentDate: dateStr, bookFor: "self" },
  });
  record(
    "Doctors have independent token sequences",
    bookForB.status === 201 && bookForB.data?.data?.appointment?.tokenNumber === 1,
    bookForB.status === 201
      ? `Doctor B's first appointment got token ${bookForB.data?.data?.appointment?.tokenNumber} (expected 1, independent of Doctor A currently being at token 4+)`
      : `booking failed: ${bookForB.status} ${bookForB.data?.message}`,
  );

  // ---------------------------------------------------------
  // 11. Concurrent bookings against the same doctor — detect
  //     duplicate token numbers under race conditions.
  //     Uses bookFor:"other" with distinct names so the "duplicate
  //     active appointment" rule (a different concern) never
  //     interferes with what's being measured here: whether the
  //     tokenNumber = lastToken+1 assignment inside the transaction
  //     is actually safe against concurrent writers.
  // ---------------------------------------------------------
  const concurrentCount = 5;
  const concurrentResults = await Promise.all(
    Array.from({ length: concurrentCount }, (_, i) =>
      bookOther(cookiePatient, doctorBId, dateStr, `Race${i}`, `${10 + i}`),
    ),
  );
  const concurrentTokens = concurrentResults
    .filter((r) => r.status === 201)
    .map((r) => r.data.data.appointment.tokenNumber);
  const allSucceeded = concurrentResults.every((r) => r.status === 201);
  const uniqueTokens = new Set(concurrentTokens);
  const noDuplicates = uniqueTokens.size === concurrentTokens.length;
  record(
    "Concurrent bookings produce no duplicate tokens",
    allSucceeded && noDuplicates,
    allSucceeded && noDuplicates
      ? `tokens assigned: [${concurrentTokens.sort((a, b) => a - b).join(",")}]`
      : !allSucceeded
        ? `not all concurrent bookings succeeded: statuses [${concurrentResults.map((r) => r.status).join(",")}]`
        : `DUPLICATE TOKENS DETECTED: [${concurrentTokens.join(",")}] — this is a genuine race condition in tokenNumber assignment under concurrency, not a test artifact. Not modifying application code, per your instructions.`,
  );

  // ---------------------------------------------------------
  // Summary — exact format requested
  // ---------------------------------------------------------
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log("\nToken Sequence Tests");
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
  console.log("Connected to MongoDB for cleanup.");

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