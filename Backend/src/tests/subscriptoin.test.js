/* PatientFlow — Subscription Plan Access Test Suite
   Placement: src/scripts/test-subscription.js, same depth as controllers/.
   Run: node src/scripts/test-subscription.js

   ASSUMPTION (not directly confirmed - no Subscription model or
   planLimits.js seen): "Pro" = { plan: "paid", status: "active" },
   "Expired Pro" = { plan: "paid", status: "expired" }. Pro/Expired
   test doctors are created by writing this directly via Mongoose
   after registration, since there's no REST-only way to upgrade a
   plan (that's an admin-approval flow not covered here). This only
   affects test setup, not the code under test. If this assumption
   is wrong, Pro-plan tests will fail with expected-200-got-403,
   which points straight back to this comment.

   This suite intentionally never calls a frontend/UI layer -
   everything is checked at the API level, since that's the actual
   security boundary the task asks to verify. */

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

function prevMonthStr(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 15)); // safely mid-month, previous month
  return d.toISOString().slice(0, 7);
}

async function registerDoctor(suffix) {
  const payload = {
    fullname: `QA Plan Doctor ${suffix}`,
    email: `qa.plan.doctor.${suffix}.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `051${String(RUN_ID).slice(-8)}${suffix.charCodeAt(0) % 10}`,
    clinicName: `QA Plan Clinic ${suffix}`,
    clinicAddress: "1 Plan Street, Test City, Test Province",
    specialization: "General Medicine",
    licenseNumber: `QA-PLN-${suffix}-${RUN_ID}`,
    experience: "5",
    consultationFee: "1000",
  };
  const res = await apiCall("/auth/register-doctor", { method: "POST", body: payload });
  if (res.status !== 201) throw new Error(`register doctor ${suffix} failed: ${res.status} ${res.data?.message}`);
  createdUserIds.push(res.data.data.user._id);
  return { email: payload.email, password: payload.password, doctorId: res.data.data.doctor.doctorId, docMongoId: res.data.data.doctor._id };
}

async function registerPatient() {
  const payload = {
    fullname: "QA Plan Patient",
    email: `qa.plan.patient.${RUN_ID}@example.com`,
    password: "TestPass123!",
    phone: `052${String(RUN_ID).slice(-8)}`,
    dateOfBirth: "1995-06-15",
    gender: "male",
    bloodGroup: "O+",
  };
  const res = await apiCall("/auth/register-patient", { method: "POST", body: payload });
  if (res.status !== 201) throw new Error(`register patient failed: ${res.status} ${res.data?.message}`);
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

async function setSubscription(doctorMongoId, plan, status) {
  await Subscription.updateOne({ doctor: doctorMongoId }, { $set: { plan, status } });
}

async function run() {
  console.log(`\nRunning against: ${CONFIG.BASE_URL}\nRun ID: ${RUN_ID}\n`);

  console.log("Setting up test doctors...");
  const freeDoc = await registerDoctor("Free");
  const proDoc = await registerDoctor("Pro");
  const expiredDoc = await registerDoctor("Expired");
  const patient = await registerPatient();

  const cookieFree = await login(freeDoc.email, freeDoc.password);
  const cookiePro = await login(proDoc.email, proDoc.password);
  const cookieExpired = await login(expiredDoc.email, expiredDoc.password);
  const cookiePatient = await login(patient.email, patient.password);

  const freeDoctorId = await getDoctorId(cookieFree);
  const proDoctorId = await getDoctorId(cookiePro);
  const expiredDoctorId = await getDoctorId(cookieExpired);
  createdDoctorIds.push(freeDoctorId, proDoctorId, expiredDoctorId);

  await setSubscription(proDoctorId, "paid", "active");
  await setSubscription(expiredDoctorId, "paid", "expired");

  const dateStr = todayPKT();
  const monthStr = dateStr.slice(0, 7);
  const prevMonth = prevMonthStr(monthStr);

  // give the Pro doctor real data to verify counts/revenue against
  const book1 = await apiCall("/appointments/book", { method: "POST", cookie: cookiePatient, body: { doctorId: proDoctorId, appointmentDate: dateStr, bookFor: "self" } });
  const appt1 = book1.data?.data?.appointment;
  const patient2 = await registerPatient();
  const cookieP2 = await login(patient2.email, patient2.password);
  const book2 = await apiCall("/appointments/book", { method: "POST", cookie: cookieP2, body: { doctorId: proDoctorId, appointmentDate: dateStr, bookFor: "self" } });
  const appt2 = book2.data?.data?.appointment;
  await apiCall(`/appointments/${appt1?._id}/pay`, { method: "PATCH", cookie: cookiePro });

  console.log(`Free: ${freeDoctorId} | Pro: ${proDoctorId} | Expired: ${expiredDoctorId}`);
  console.log(`Testing month: ${monthStr}\n`);

  console.log("Subscription Plan Tests");

  // --- Free Plan ---
  const freeRes = await apiCall(`/appointments/monthly-summary?month=${monthStr}`, { cookie: cookieFree });
  record("Free doctor cannot access monthly analytics API", freeRes.status === 403, freeRes.status === 403 ? undefined : `expected 403, got ${freeRes.status}`);
  record(
    "Free doctor gets the upgrade/locked message",
    freeRes.status === 403 && /practice plan/i.test(freeRes.data?.message || ""),
    /practice plan/i.test(freeRes.data?.message || "") ? undefined : `message was "${freeRes.data?.message}"`,
  );
  record("Backend rejects direct API call as Free doctor", freeRes.status === 403, freeRes.status === 403 ? undefined : `expected 403, got ${freeRes.status}`);

  // --- Pro Plan ---
  const proRes = await apiCall(`/appointments/monthly-summary?month=${monthStr}`, { cookie: cookiePro });
  record("Pro doctor can access monthly analytics", proRes.status === 200, proRes.status === 200 ? undefined : `expected 200, got ${proRes.status}: ${proRes.data?.message} (check the Subscription field assumption noted at top of this file)`);

  const apptCountCorrect = proRes.data?.data?.totalAppointments === 2;
  record("Monthly appointment count returned correctly", apptCountCorrect, apptCountCorrect ? undefined : `expected 2, got ${proRes.data?.data?.totalAppointments}`);

  const expectedRevenue = 1000; // one of the two appointments marked paid
  const revenueCorrect = proRes.data?.data?.totalRevenue === expectedRevenue;
  record("Monthly revenue returned correctly", revenueCorrect, revenueCorrect ? undefined : `expected ${expectedRevenue}, got ${proRes.data?.data?.totalRevenue}`);

  const prevMonthRes = await apiCall(`/appointments/monthly-summary?month=${prevMonth}`, { cookie: cookiePro });
  const prevMonthEmpty = prevMonthRes.data?.data?.totalAppointments === 0 && prevMonthRes.data?.data?.totalRevenue === 0;
  record("Changing month updates values correctly", prevMonthEmpty, prevMonthEmpty ? undefined : `previous month (${prevMonth}) should be empty, got appointments=${prevMonthRes.data?.data?.totalAppointments}, revenue=${prevMonthRes.data?.data?.totalRevenue}`);

  // --- Expired Pro ---
  const expiredRes = await apiCall(`/appointments/monthly-summary?month=${monthStr}`, { cookie: cookieExpired });
  record("Expired Pro doctor loses monthly analytics access", expiredRes.status === 403, expiredRes.status === 403 ? undefined : `expected 403, got ${expiredRes.status}`);
  record(
    "Expired Pro doctor gets the upgrade/locked state",
    expiredRes.status === 403 && /practice plan/i.test(expiredRes.data?.message || ""),
    /practice plan/i.test(expiredRes.data?.message || "") ? undefined : `message was "${expiredRes.data?.message}"`,
  );

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log("\nSubscription Plan Tests");
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