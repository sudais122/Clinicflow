/* ============================================================
   Automated test for the 15-minute auto-reset-idle-queue feature.
   Pure API calls via fetch — no browser/UI involved.

   Run: node test-auto-reset-queue.js

   PREREQUISITE — this test will fail at Step 4 unless GET /queue/me
   actually returns queueEmptyAt and autoResetAt in its response.
   That was a separate instruction (app-wiring-INSTRUCTIONS.txt,
   point 2) for whichever controller handles that route — I don't
   have that file's source, so confirm it's been added before
   running this.

   BEFORE RUNNING — for a fast test cycle instead of waiting 15 real
   minutes, temporarily lower BOTH of these in
   src/config/queueResetConfig.js, then restart your server:

     QUEUE_AUTO_RESET_DELAY_MS = Number(process.env.QUEUE_AUTO_RESET_DELAY_MINUTES || 0.1) * 60 * 1000;
     QUEUE_AUTO_RESET_CHECK_INTERVAL_MS = 5 * 1000;   // was 60 * 1000

   That gives a ~6-second grace period checked every 5 seconds — the
   script below waits up to WAIT_TIMEOUT_MS for the reset to actually
   happen, polling every 3 seconds. Put both values back to their
   real settings (15 min / 60s) when you're done testing.

   ADJUST before running: BASE_URL, DOCTOR_EMAIL/PASSWORD,
   PATIENT_EMAIL/PASSWORD — real accounts, and the doctor must be on
   an active Practice plan OR under the Free daily limit (this test
   only books 2 appointments, so Free is fine).
   ============================================================ */

const BASE_URL = "http://localhost:8000";
const DOCTOR_EMAIL = "test1@gmail.com";       // ADJUST
const DOCTOR_PASSWORD = "Doctor@123";           // ADJUST
const PATIENT_EMAIL = "khansb17798@gmail.com";      // ADJUST
const PATIENT_PASSWORD = "Patient@123";          // ADJUST

const WAIT_TIMEOUT_MS = 90 * 1000; // give the scheduler up to 90s to fire, assuming you shortened the delay per the note above
const POLL_INTERVAL_MS = 3 * 1000;

let doctorCookie = "";
let patientCookie = "";
let doctorId = "";

function extractCookie(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
  return raw.filter(Boolean).join("; ").split(",").map((c) => c.trim().split(";")[0]).join("; ");
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Login failed for ${email}: ${json.message}`);
  const cookie = extractCookie(res);
  return { cookie, data: json.data };
}

async function apiCall(method, path, cookie, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, ok: res.ok, data: json?.data, message: json?.message };
}

function log(label, value) {
  console.log(`  ${label}:`, value);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`\n❌ FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getQueueMe() {
  // Using /queue/status/:doctorId (getQueueStatus) rather than
  // /queue/me — the latter isn't actually in the queue.controller.js
  // you shared (it's not in that file's export list), so its real
  // source is still unknown. getQueueStatus is confirmed real, and
  // now returns queueEmptyAt/autoResetAt too (see the updated
  // queue.controller.js).
  //
  // NOTE: the exact route path here ("/queue/status/:doctorId") is a
  // guess — queue.routes.js was never shared, so I don't know what
  // path getQueueStatus is actually mounted at. If this 404s, check
  // your routes file for whatever path maps to getQueueStatus and
  // update this line to match.
  return apiCall("GET", `/queue/status/${doctorId}`, doctorCookie);
}

async function bookAndCompleteOne(label) {
  console.log(`\n--- ${label}: booking + completing one appointment ---`);

  const bookRes = await apiCall("POST", "/appointments/book", patientCookie, {
    doctorId,
    appointmentDate: new Date().toISOString(),
    bookFor: "self",
  });
  if (!bookRes.ok) {
    console.error(`\n❌ Booking request failed — status ${bookRes.status}, message: ${bookRes.message}`);
    console.error("Full response data:", JSON.stringify(bookRes.data, null, 2));
  }
  assert(bookRes.ok, `${label}: booking succeeded`);
  log("token", bookRes.data?.queue?.yourToken);

  // Serve twice: first call advances to this token (marks in-progress,
  // nothing to complete yet since nowServing was behind it), second
  // call completes it and advances past (no next waiting appointment
  // means active count drops to 0 here).
  const serve1 = await apiCall("PATCH", "/queue/next", doctorCookie);
  if (!serve1.ok) console.error(`Serve #1 failed — status ${serve1.status}, message: ${serve1.message}`);
  assert(serve1.ok, `${label}: first /queue/next (advance to token) succeeded`);

  const serve2 = await apiCall("PATCH", "/queue/next", doctorCookie);
  if (!serve2.ok) console.error(`Serve #2 failed — status ${serve2.status}, message: ${serve2.message}`);
  assert(serve2.ok, `${label}: second /queue/next (complete token) succeeded`);
}

async function run() {
  console.log("=== Step 1: Login as doctor and patient ===");
  const doctorLogin = await login(DOCTOR_EMAIL, DOCTOR_PASSWORD);
  doctorCookie = doctorLogin.cookie;
  assert(!!doctorCookie, "Doctor login succeeded");

  // IMPORTANT: doctorId used for booking must be the Doctor
  // collection's own _id, NOT the User._id the login endpoint
  // returns — Doctor and User are separate collections in this
  // schema (bookAppointment does Doctor.findById(doctorId), and
  // Appointment.doctor references the Doctor collection). Fetch the
  // real one from the dashboard endpoint.
  const dashboardRes = await apiCall("GET", "/dashboard/doctor", doctorCookie);
  assert(dashboardRes.ok, "Fetched doctor dashboard to resolve the real Doctor._id");
  doctorId = dashboardRes.data?.doctor?._id;
  assert(!!doctorId, "Resolved doctor._id (Doctor collection, not User collection) for booking");
  log("doctorId (Doctor collection)", doctorId);

  const patientLogin = await login(PATIENT_EMAIL, PATIENT_PASSWORD);
  patientCookie = patientLogin.cookie;
  assert(!!patientCookie, "Patient login succeeded");

  console.log("\n=== Step 2: Open the clinic ===");
  const openRes = await apiCall("PATCH", "/queue/start", doctorCookie);
  assert(openRes.ok, "Clinic opened");

  console.log("\n=== Step 3: Complete the only active appointment ===");
  await bookAndCompleteOne("First appointment");

  console.log("\n=== Step 4: Confirm queueEmptyAt / autoResetAt got set ===");
  await sleep(500); // brief pause — the sync call is fire-and-forget, non-blocking
  const afterEmpty = await getQueueMe();
  log("queueEmptyAt", afterEmpty.data?.queueEmptyAt);
  log("autoResetAt", afterEmpty.data?.autoResetAt);
  assert(!!afterEmpty.data?.queueEmptyAt, "queueEmptyAt is set after the queue became empty");
  assert(!!afterEmpty.data?.autoResetAt, "autoResetAt is set (backend exposes the computed reset time)");

  console.log("\n=== Step 5: Book a NEW appointment — should cancel the pending reset ===");
  const secondBooking = await apiCall("POST", "/appointments/book", patientCookie, {
    doctorId,
    appointmentDate: new Date().toISOString(),
    bookFor: "self",
  });
  if (!secondBooking.ok) {
    console.error(`\n❌ Second booking failed — status ${secondBooking.status}, message: ${secondBooking.message}`);
  }
  assert(secondBooking.ok, "Second booking succeeded");

  await sleep(500);
  const afterNewBooking = await getQueueMe();
  log("queueEmptyAt", afterNewBooking.data?.queueEmptyAt);
  assert(
    afterNewBooking.data?.queueEmptyAt === null || afterNewBooking.data?.queueEmptyAt === undefined,
    "queueEmptyAt was cleared after a new active appointment arrived (Step 12/18 of the spec)",
  );

  console.log("\n=== Step 6: Complete this one too, to re-arm the countdown ===");
  const serve1b = await apiCall("PATCH", "/queue/next", doctorCookie);
  assert(serve1b.ok, "Advance to second token succeeded");
  const serve2b = await apiCall("PATCH", "/queue/next", doctorCookie);
  assert(serve2b.ok, "Complete second token succeeded");

  await sleep(500);
  const reArmed = await getQueueMe();
  assert(!!reArmed.data?.queueEmptyAt, "queueEmptyAt is set again after completing the second appointment");
  const autoResetAt = new Date(reArmed.data.autoResetAt);
  console.log(`\nWaiting for the scheduler to fire at ${autoResetAt.toISOString()}...`);
  console.log("(If this hangs past the timeout, your grace period is probably still 15 real minutes —");
  console.log(" see the note at the top of this file about temporarily shortening it for testing.)");

  console.log("\n=== Step 7: Poll until the automatic reset actually happens ===");
  const start = Date.now();
  let resetConfirmed = false;
  while (Date.now() - start < WAIT_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await getQueueMe();
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`  [${elapsed}s] queueEmptyAt=${poll.data?.queueEmptyAt} lastToken=${poll.data?.lastToken} nowServing=${poll.data?.nowServing}`);
    if (poll.data?.queueEmptyAt === null && poll.data?.lastToken === 0 && poll.data?.nowServing === 0) {
      resetConfirmed = true;
      break;
    }
  }
  assert(resetConfirmed, "Queue was automatically reset (lastToken=0, nowServing=0, queueEmptyAt=null) within the timeout");

  console.log("\n=== Step 8: Confirm the clinic is STILL OPEN (auto-reset must never close it) ===");
  const finalState = await getQueueMe();
  log("clinicStatus", finalState.data?.clinicStatus);
  assert(finalState.data?.clinicStatus === "open", "Clinic remains open after the automatic reset — Close Clinic was never triggered");

  console.log("\n🎉 All checks passed.");
}

run().catch((err) => {
  console.error("\n❌ Test crashed:", err.message);
  process.exit(1);
});