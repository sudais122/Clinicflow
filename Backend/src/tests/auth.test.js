/* ============================================================
   PatientFlow — Authentication System Test Suite
   Pure Node.js + native fetch. No test framework dependency.

   Run: node test-auth.js

   Every path/field/status-code below is now taken directly from your
   real auth.routes.js, auth.controller.js, and auth.middlewares.js —
   not guessed. The one remaining assumption is the router's mount
   prefix ("/auth"), inferred from doctor-script.js's
   ENDPOINTS.logout matching this router's /logout route. If that's
   wrong, fix ROUTE_PREFIX below — everything else should be accurate.
   ============================================================ */

const CONFIG = {
  BASE_URL: process.env.BASE_URL || "http://localhost:8000",
  ROUTE_PREFIX: "/auth", // the one inferred value — adjust if your app.js mounts this router elsewhere

  REGISTER_PATIENT_PATH: "/register-patient", // confirmed in auth.routes.js
  LOGIN_PATH: "/login", // confirmed
  LOGOUT_PATH: "/logout", // confirmed, requires verifyJWT

  // Confirmed real, patient-accessible protected route (patient.routes.js)
  PROTECTED_PATH: "/patient/me",
};

// ---- Test data — matches registerPatient's real validation exactly:
// fullname: letters+spaces only, 3-50 chars
// phone: exactly /^03\d{9}$/ (11 digits, starts with 03)
// password: lowercase+uppercase+digit+special char, 8+ chars
// dateOfBirth: valid date in the past
// gender: male|female|other
// bloodGroup: one of the 8 standard groups
// Namespaced with a run-specific timestamp so re-running never
// collides with a previous run or real data.
const RUN_ID = Date.now();
const TEST_USER = {
  fullname: "QA Test Patient",
  email: `qa.auth.test.${RUN_ID}@example.com`,
  password: "TestPass123!",
  phone: "03000000011",
  dateOfBirth: "1995-06-15",
  gender: "male",
  bloodGroup: "O+",
};

const results = [];

function record(name, passed, detail) {
  results.push({ name, passed, detail });
  const icon = passed ? "✓" : "✗";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function apiCall(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;

  const res = await fetch(`${CONFIG.BASE_URL}${CONFIG.ROUTE_PREFIX}${path}`, {
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

// PROTECTED_PATH lives OUTSIDE the /auth prefix (it's under
// /patient/*), so it needs a separate raw call rather than going
// through apiCall's auto-prefixing.
async function callProtected({ cookie } = {}) {
  const headers = {};
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${CONFIG.BASE_URL}${CONFIG.PROTECTED_PATH}`, { headers });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no JSON body */
  }
  return { status: res.status, ok: res.ok, data: json };
}

async function run() {
  console.log(`\nRunning against: ${CONFIG.BASE_URL}${CONFIG.ROUTE_PREFIX}`);
  console.log(`Protected route under test: ${CONFIG.PROTECTED_PATH}`);
  console.log(`Test user: ${TEST_USER.email}\n`);
  console.log("Authentication Tests");

  let sessionCookie = "";

  // ---------------------------------------------------------
  // 1. Register a new user with valid data → should succeed (201)
  // ---------------------------------------------------------
  const regRes = await apiCall(CONFIG.REGISTER_PATIENT_PATH, {
    method: "POST",
    body: TEST_USER,
  });
  record(
    "Register valid user",
    regRes.status === 201,
    regRes.status === 201 ? undefined : `expected 201, got ${regRes.status}: ${regRes.data?.message || "no message"}`,
  );

  // ---------------------------------------------------------
  // 2. Register with an already-registered email → should fail (409)
  // ---------------------------------------------------------
  const dupRes = await apiCall(CONFIG.REGISTER_PATIENT_PATH, {
    method: "POST",
    body: TEST_USER, // exact same payload, same email
  });
  record(
    "Reject duplicate email",
    dupRes.status === 409,
    dupRes.status === 409 ? undefined : `expected 409, got ${dupRes.status}: ${dupRes.data?.message || "no message"}`,
  );

  // ---------------------------------------------------------
  // 3. Login with correct credentials → should succeed (200)
  // ---------------------------------------------------------
  const loginRes = await apiCall(CONFIG.LOGIN_PATH, {
    method: "POST",
    body: { email: TEST_USER.email, password: TEST_USER.password },
  });
  record(
    "Login valid credentials",
    loginRes.status === 200,
    loginRes.status === 200 ? undefined : `expected 200, got ${loginRes.status}: ${loginRes.data?.message || "no message"}`,
  );
  sessionCookie = loginRes.cookie;

  // ---------------------------------------------------------
  // 4. Login with incorrect password → should fail (401, "Invalid credentials")
  // ---------------------------------------------------------
  const wrongPassRes = await apiCall(CONFIG.LOGIN_PATH, {
    method: "POST",
    body: { email: TEST_USER.email, password: "DefinitelyWrongPassword999!" },
  });
  record(
    "Reject wrong password",
    wrongPassRes.status === 401,
    wrongPassRes.status === 401 ? undefined : `expected 401, got ${wrongPassRes.status}: ${wrongPassRes.data?.message || "no message"}`,
  );

  // ---------------------------------------------------------
  // 5. Login with a non-existent email → should fail (404, "User does not exist")
  // ---------------------------------------------------------
  const unknownRes = await apiCall(CONFIG.LOGIN_PATH, {
    method: "POST",
    body: { email: `nobody.${RUN_ID}@example.com`, password: "whatever123!A" },
  });
  record(
    "Reject unknown user",
    unknownRes.status === 404,
    unknownRes.status === 404 ? undefined : `expected 404, got ${unknownRes.status}: ${unknownRes.data?.message || "no message"}`,
  );

  // ---------------------------------------------------------
  // 6. Access a protected endpoint without authentication → 401
  //    (verifyJWT throws exactly 401 "Unauthorized request" when no
  //    token is present at all — confirmed in auth.middlewares.js)
  // ---------------------------------------------------------
  const noAuthRes = await callProtected();
  record(
    "Reject unauthenticated request",
    noAuthRes.status === 401,
    noAuthRes.status === 401 ? undefined : `expected 401, got ${noAuthRes.status}`,
  );

  // ---------------------------------------------------------
  // 7. Access a protected endpoint with an invalid token → 401
  //    (verifyJWT's jwt.verify() throws, caught and re-thrown as 401
  //    "Invalid access token" — confirmed)
  // ---------------------------------------------------------
  const invalidAuthRes = await callProtected({
    cookie: "accessToken=this.is.not.a.real.jwt.token",
  });
  record(
    "Reject invalid authentication",
    invalidAuthRes.status === 401,
    invalidAuthRes.status === 401 ? undefined : `expected 401, got ${invalidAuthRes.status}`,
  );

  // ---------------------------------------------------------
  // 8. Authenticated user can access their own protected resource (200)
  // ---------------------------------------------------------
  const ownResourceRes = await callProtected({ cookie: sessionCookie });
  record(
    "Protected resource access",
    ownResourceRes.status === 200,
    ownResourceRes.status === 200 ? undefined : `expected 200, got ${ownResourceRes.status}: ${ownResourceRes.data?.message || "no message"}`,
  );

  // ---------------------------------------------------------
  // 9. Logout / session invalidation
  //
  // IMPORTANT — read this before treating a failure here as a test
  // bug: your logout controller clears the stored refreshToken in
  // the DB and clears both cookies client-side, but verifyJWT never
  // checks refreshToken for the access token — it only checks the
  // JWT's own signature/expiry and looks the user up by ID. That
  // means a captured access token (like the one this script grabbed
  // during login) keeps working after logout until it naturally
  // expires. This test re-uses that captured cookie on purpose, to
  // check TRUE server-side invalidation, not just "logout returned
  // 200". If this fails, it is accurately reporting that access
  // tokens aren't revoked on logout — a real architectural property
  // of this implementation, not a bug in the test.
  // ---------------------------------------------------------
  const logoutRes = await apiCall(CONFIG.LOGOUT_PATH, {
    method: "POST",
    cookie: sessionCookie,
  });

  if (logoutRes.status !== 200) {
    record("Logout", false, `logout call itself failed: expected 200, got ${logoutRes.status}: ${logoutRes.data?.message || "no message"}`);
  } else {
    const afterLogoutRes = await callProtected({ cookie: sessionCookie });
    const trulyInvalidated = afterLogoutRes.status === 401;
    record(
      "Logout",
      trulyInvalidated,
      trulyInvalidated
        ? undefined
        : `logout returned 200, but the SAME access token cookie still returns ${afterLogoutRes.status} (not 401) when reused afterward — see the comment above this test in the script for why this happens and what it means`,
    );
  }

  // ---------------------------------------------------------
  // Summary
  // ---------------------------------------------------------
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}\n`);

  if (failed > 0) {
    console.log("Failed test details:");
    results.filter((r) => !r.passed).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\nTest run crashed:", err.message);
  console.error("Usually means BASE_URL is unreachable, or a request threw before completing.");
  process.exit(1);
});