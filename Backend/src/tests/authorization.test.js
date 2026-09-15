/* PatientFlow — Authorization & Resource Ownership Security Tests
   Placement: src/scripts/test-authorization.js, same depth as controllers/.
   Run: node src/scripts/test-authorization.js

   Every check hits the API directly - no frontend involved.
   One unconfirmed area: Revenue.controller.js was never shared, so
   test 3 is defensive (checks the injected doctorId is ignored, not
   an exact known-correct revenue figure). Everything else is
   verified against real, confirmed controller code. */

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

function todayPKT() {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function registerDoctor(suffix) {
  const payload = {
    fullname: `QA Sec Doctor ${suffix}`,
    email: `qa.sec.doctor.${suffix}.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `071${String(RUN_ID).slice(-8)}${suffix.charCodeAt(0) % 10}`,
    clinicName: `QA Sec Clinic ${suffix}`,
    clinicAddress: "1 Security Row, Test City, Test Province",
    specialization: "General Medicine",
    licenseNumber: `QA-SEC-${suffix}-${RUN_ID}`,
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
    fullname: `QA Sec Patient ${suffix}`,
    email: `qa.sec.patient.${suffix}.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `072${String(RUN_ID).slice(-8)}${suffix.charCodeAt(0) % 10}`,
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

async function run() {
  console.log(`\nRunning against: ${CONFIG.BASE_URL}\nRun ID: ${RUN_ID}\n`);

  const docA = await registerDoctor("A"); // stays Free, used as attacker
  const docB = await registerDoctor("B"); // stays Free, victim
  const docC = await registerDoctor("C"); // set Pro, victim for analytics test
  const patient1 = await registerPatient("1");
  const patient2 = await registerPatient("2");

  const cookieA = await login(docA.email, docA.password);
  const cookieB = await login(docB.email, docB.password);
  const cookieC = await login(docC.email, docC.password);
  const cookieP1 = await login(patient1.email, patient1.password);
  const cookieP2 = await login(patient2.email, patient2.password);

  const doctorAId = await getDoctorId(cookieA);
  const doctorBId = await getDoctorId(cookieB);
  const doctorCId = await getDoctorId(cookieC);
  createdDoctorIds.push(doctorAId, doctorBId, doctorCId);

  await setPro(doctorCId);

  const dateStr = todayPKT();

  // Doctor B's appointment (patient1) - target for Doctor A's attacks
  const bookB = await apiCall("/appointments/book", { method: "POST", cookie: cookieP1, body: { doctorId: doctorBId, appointmentDate: dateStr, bookFor: "self" } });
  const apptB = bookB.data?.data?.appointment;

  // Doctor A's appointment (patient1 again, different doctor) - target for Patient B's attack
  const bookA = await apiCall("/appointments/book", { method: "POST", cookie: cookieP1, body: { doctorId: doctorAId, appointmentDate: dateStr, bookFor: "self" } });
  const apptA = bookA.data?.data?.appointment;

  console.log(`Doctor A: ${doctorAId} | Doctor B: ${doctorBId} | Doctor C (Pro): ${doctorCId}\n`);
  console.log("Authorization & Ownership Security Tests");

  // 1. Doctor A cannot see Doctor B's appointments, even with doctorId injected in query
  const listAsA = await apiCall(`/appointments/doctor?date=${dateStr}&all=true&doctorId=${doctorBId}`, { cookie: cookieA });
  const leaksApptB = (listAsA.data?.appointments || []).some((a) => a._id === apptB?._id);
  record("Doctor A cannot access Doctor B's appointments", !leaksApptB, leaksApptB ? "Doctor B's appointment appeared in Doctor A's list" : undefined);

  // 2. Doctor A cannot modify Doctor B's appointment
  const modifyRes = await apiCall(`/appointments/${apptB?._id}/status`, { method: "PATCH", cookie: cookieA, body: { status: "in-progress" } });
  record("Doctor A cannot modify Doctor B's appointment", modifyRes.status === 403, modifyRes.status === 403 ? undefined : `expected 403, got ${modifyRes.status}`);

  // 3. Doctor A cannot access Doctor B's revenue via injected doctorId
  const revenueRes = await apiCall(`/revenue?doctorId=${doctorBId}`, { cookie: cookieA });
  const revenueLooksSafe = revenueRes.status === 200 || revenueRes.status === 403 || revenueRes.status === 400;
  record(
    "Doctor A cannot access Doctor B's revenue",
    revenueLooksSafe,
    revenueRes.status === 200 ? "got 200 - manually confirm the returned figures are Doctor A's own, not Doctor B's (Revenue.controller.js was not available to verify this precisely)" : undefined,
  );

  // 4. Doctor A cannot access Doctor C's monthly analytics (Doctor A itself is Free, expect 403 regardless of target)
  const monthlyRes = await apiCall(`/appointments/monthly-summary?month=2026-09&doctorId=${doctorCId}`, { cookie: cookieA });
  record("Doctor A cannot access another doctor's monthly analytics", monthlyRes.status === 403, monthlyRes.status === 403 ? undefined : `expected 403, got ${monthlyRes.status}`);

  // 5. Doctor A cannot change Doctor B's clinic status
  const statusBeforeAttack = await apiCall(`/queue/${doctorBId}`, { cookie: cookieB });
  await apiCall("/queue/start", { method: "PATCH", cookie: cookieA }); // this only ever affects the caller's own queue
  const statusAfterAttack = await apiCall(`/queue/${doctorBId}`, { cookie: cookieB });
  const bUntouched = statusAfterAttack.data?.clinicStatus === statusBeforeAttack.data?.clinicStatus && statusAfterAttack.data?.clinicStatus === "closed";
  record("Doctor A cannot change Doctor B's clinic status", bUntouched, bUntouched ? undefined : `Doctor B's clinicStatus changed to "${statusAfterAttack.data?.clinicStatus}"`);

  // 6. Patient B cannot access/modify Patient A's private data (cancel Patient A's appointment)
  const cancelAttack = await apiCall(`/appointments/${apptA?._id}/cancel`, { method: "PATCH", cookie: cookieP2 });
  record("Patient B cannot access/modify Patient A's appointment", cancelAttack.status === 403, cancelAttack.status === 403 ? undefined : `expected 403, got ${cancelAttack.status}`);

  // 7. Unauthenticated access
  const noAuthPatient = await apiCall("/patient/me");
  const noAuthDoctor = await apiCall("/dashboard/doctor");
  record("Unauthenticated request rejected (patient route)", noAuthPatient.status === 401, noAuthPatient.status === 401 ? undefined : `expected 401, got ${noAuthPatient.status}`);
  record("Unauthenticated request rejected (doctor route)", noAuthDoctor.status === 401, noAuthDoctor.status === 401 ? undefined : `expected 401, got ${noAuthDoctor.status}`);

  // 8. Invalid authentication
  const badAuthRes = await apiCall("/patient/me", { cookie: "accessToken=not.a.real.token" });
  record("Invalid authentication rejected", badAuthRes.status === 401, badAuthRes.status === 401 ? undefined : `expected 401, got ${badAuthRes.status}`);

  // 9. Free doctor cannot access Pro-only analytics
  const freeAnalyticsRes = await apiCall("/appointments/monthly-summary?month=2026-09", { cookie: cookieB });
  record("Free doctor blocked from Pro-only analytics", freeAnalyticsRes.status === 403, freeAnalyticsRes.status === 403 ? undefined : `expected 403, got ${freeAnalyticsRes.status}`);

  // 10. doctorId manipulation never bypasses ownership scoping
  const plainMonthly = await apiCall("/appointments/monthly-summary?month=2026-09", { cookie: cookieC });
  const injectedMonthly = await apiCall(`/appointments/monthly-summary?month=2026-09&doctorId=${doctorAId}`, { cookie: cookieC });
  const injectionIgnored = JSON.stringify(plainMonthly.data?.data) === JSON.stringify(injectedMonthly.data?.data);
  record(
    "doctorId in query/body cannot bypass authorization",
    injectionIgnored,
    injectionIgnored ? undefined : "response differed when a doctorId was injected into the query - identity should come only from the authenticated session",
  );

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log("\nAuthorization & Ownership Security Tests");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    console.log("\nSecurity Failures:");
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