
const BASE_URL = process.env.BASE_URL || "http://localhost:8000";
const RUN_ID = Date.now();
const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
}

async function call(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, opts);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: res.headers };
}

async function registerAndLogin(role) {
  const email = `qa.ratelimit.${role}.${RUN_ID}@example.com`;
  const password = "TestPass123!";
  const body = role === "doctor"
    ? {
        fullname: "QA RateLimit Doctor",
        email, password,
        phone: `03${String(RUN_ID).slice(-9)}`,
        clinicName: "QA RateLimit Clinic",
        clinicAddress: "1 RateLimit Rd, Test City, Test Province",
        specialization: "General Medicine",
        licenseNumber: `QA-RL-${RUN_ID}`,
        experience: "5",
        consultationFee: "1000",
      }
    : {
        fullname: "QA RateLimit Patient",
        email, password,
        phone: `034${String(RUN_ID).slice(-8)}`,
        dateOfBirth: "1995-06-15",
        gender: "male",
        bloodGroup: "O+",
      };
  const regPath = role === "doctor" ? "/auth/register-doctor" : "/auth/register-patient";
  const reg = await call(regPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (reg.status !== 201) throw new Error(`setup: register ${role} failed (${reg.status}) - if this is 429, the register limit is already exhausted; restart the server and re-run`);

  const login = await call("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const setCookie = login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookie.join("; ").split(",").map((c) => c.trim().split(";")[0]).join("; ");
  return cookie;
}

async function run() {
  console.log(`\nRunning against: ${BASE_URL}`);
  console.log(`Run ID: ${RUN_ID}\n`);

  // ---- Login rate limit: 5 allowed, 6th blocked ----
  const loginEmail = `qa.ratelimit.loginprobe.${RUN_ID}@example.com`;
  const attempts = [];
  for (let i = 1; i <= 6; i++) {
    const res = await call("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail, password: "wrong" }) });
    attempts.push(res.status);
  }
  const first5NotBlocked = attempts.slice(0, 5).every((s) => s !== 429);
  const sixthBlocked = attempts[5] === 429;
  record("Login rate limit", first5NotBlocked && sixthBlocked, `statuses: [${attempts.join(",")}] - expected first 5 not 429, 6th to be 429`);

  // ---- Registration rate limit: 6th register attempt (same IP) blocked ----
  const regAttempts = [];
  for (let i = 1; i <= 6; i++) {
    const res = await call("/auth/register-patient", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullname: "QA RL Probe",
        email: `qa.ratelimit.regprobe.${i}.${RUN_ID}@example.com`,
        password: "TestPass123!",
        phone: `035${String(RUN_ID).slice(-7)}${i}`,
        dateOfBirth: "1995-06-15",
        gender: "male",
        bloodGroup: "O+",
      }),
    });
    regAttempts.push(res.status);
  }
  const regSixthBlocked = regAttempts[5] === 429;
  record("Registration rate limit", regSixthBlocked, `statuses: [${regAttempts.join(",")}] - expected 6th (index 5) to be 429`);

  // ---- Forgot password: SKIPPED, route never confirmed ----
  record("Forgot password rate limit", null, "SKIPPED - Forgotpassword.routes.js was never shared, real endpoint path unknown");

  // ---- Appointment booking rate limit ----
  const doctorCookie = await registerAndLogin("doctor");
  const patientCookie = await registerAndLogin("patient");
  const dashRes = await call("/dashboard/doctor", { headers: { Cookie: doctorCookie } });
  const doctorId = dashRes.json?.data?.doctor?._id;

  const bookAttempts = [];
  for (let i = 0; i < 11; i++) {
    const res = await call("/appointments/book", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: patientCookie },
      body: JSON.stringify({ doctorId, appointmentDate: "2026-09-14", bookFor: "other", patientName: `RL Booking ${i}`, patientPhone: `06${String(RUN_ID).slice(-8)}${i}` }),
    });
    bookAttempts.push(res.status);
  }
  const someBookingBlocked = bookAttempts.includes(429);
  const earlyBookingsWorked = bookAttempts.slice(0, 10).some((s) => s === 201);
  record("Appointment booking rate limit", someBookingBlocked && earlyBookingsWorked, `statuses: [${bookAttempts.join(",")}] - expected some 201s then a 429 by request 11`);

  // ---- Queue: normal usage works, excessive is limited ----
  const queueAttempts = [];
  for (let i = 0; i < 65; i++) {
    const res = await call(`/queue/${doctorId}`, { headers: { Cookie: doctorCookie } });
    queueAttempts.push(res.status);
  }
  const queueEarlyOk = queueAttempts.slice(0, 5).every((s) => s === 200);
  const queueEventuallyBlocked = queueAttempts.includes(429);
  record("Queue rate limit", queueEarlyOk && queueEventuallyBlocked, `first 5 ok: ${queueEarlyOk}, hit 429 within 65 calls: ${queueEventuallyBlocked}`);

  // ---- Dashboard: normal works, excessive limited ----
  const dashAttempts = [];
  for (let i = 0; i < 65; i++) {
    const res = await call("/dashboard/doctor", { headers: { Cookie: doctorCookie } });
    dashAttempts.push(res.status);
  }
  const dashEarlyOk = dashAttempts.slice(0, 5).every((s) => s === 200);
  const dashEventuallyBlocked = dashAttempts.includes(429);
  record("Dashboard rate limit", dashEarlyOk && dashEventuallyBlocked, `first 5 ok: ${dashEarlyOk}, hit 429 within 65 calls: ${dashEventuallyBlocked}`);

  // ---- Admin: SKIPPED, routes never confirmed ----
  record("Admin rate limit", null, "SKIPPED - admin*.routes.js were never shared, real endpoint paths unknown");

  // ---- Global API fallback: hit a normal GET repeatedly beyond specific limiter ----
  const globalAttempts = [];
  for (let i = 0; i < 205; i++) {
    const res = await call("/doctor/getalldoctors", { headers: { Cookie: patientCookie } });
    globalAttempts.push(res.status);
    if (res.status === 429) break;
  }
  record("Global API rate limit", globalAttempts.includes(429), `reached 429 after ${globalAttempts.length} requests`);

  // ---- 429 response format ----
  const overflowRes = await call("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail, password: "wrong" }) });
  const formatOk = overflowRes.status === 429 && overflowRes.json?.success === false && typeof overflowRes.json?.message === "string";
  record("429 response format", formatOk, formatOk ? undefined : `got status ${overflowRes.status}, body ${JSON.stringify(overflowRes.json)}`);

  // ---- Headers ----
  const headerCheck = await call("/doctor/getalldoctors", { headers: { Cookie: patientCookie } });
  const hasHeaders = headerCheck.headers.get("ratelimit-limit") !== null || headerCheck.headers.get("x-ratelimit-limit") !== null;
  record("Rate-limit headers", hasHeaders, hasHeaders ? undefined : "no RateLimit-* or X-RateLimit-* headers found");

  // ---- Bypass attempts: query param / method change don't evade the limiter ----
  const bypassAttempt = await call(`/auth/login?bypass=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: loginEmail, password: "wrong" }) });
  record("Cannot bypass via query parameter", bypassAttempt.status === 429, bypassAttempt.status === 429 ? undefined : `expected 429, got ${bypassAttempt.status} - query param may have evaded the limiter`);

  // ---- Summary ----
  console.log("========================================");
  console.log("PatientFlow Rate Limit Tests");
  console.log("========================================\n");
  for (const r of results) {
    const icon = r.passed === null ? "-" : r.passed ? "✓" : "✗";
    console.log(`${icon} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const tested = results.filter((r) => r.passed !== null);
  const passed = tested.filter((r) => r.passed).length;
  const failed = tested.filter((r) => !r.passed).length;
  const skipped = results.length - tested.length;
  console.log("\n========================================");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (skipped) console.log(`Skipped: ${skipped} (routes not available to test)`);
  console.log("========================================\n");
  return failed;
}

run().then((failed) => process.exit(failed > 0 ? 1 : 0));