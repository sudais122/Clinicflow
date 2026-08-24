/* ============================================================
   ClinicFlow — Doctor Dashboard (behavior)
   NOW WIRED TO THE REAL BACKEND. Every network call is grouped
   under ENDPOINTS / api*() below — if a path is wrong for your
   server, fix it in ONE place.

   ASSUMPTIONS (please verify / adjust):
   1. All routes are mounted under API_PREFIX = "/api/v1".
   2. queue.routes.js  -> "/api/v1/queue"
      doctor.routes.js -> "/api/v1/doctor"
      doctorDashboard.routes.js -> "/api/v1/dashboard"  (matches the
         "GET /dashboard/doctor" comment in the controller)
      appointment routes -> "/api/v1/appointments" with:
         GET   /appointments/doctor            (getDoctorAppointments)
         PATCH /appointments/:id/status         (updateAppointmentStatus)
      These two appointment paths are GUESSES — appointment.routes.js
      wasn't provided. Update ENDPOINTS.appointments below if different.
   3. Auth is cookie-based (JWT in an httpOnly cookie), so every fetch
      uses `credentials: "include"`. No Authorization header is sent.
   4. MISSING BACKEND ROUTE: there is currently no self-service
      "get my own queue" endpoint — only `GET /queue/:doctorId`, and
      the frontend never learns its own Mongo _id (only the human
      readable `doctorId` code comes back from the dashboard route).
      This file calls `GET /queue/me` for that. Please add it
      server-side, e.g.:
        router.get("/me", async (req, res, next) => {
          const { queue } = await getOwnQueue(req.user._id); // reuse existing helper
          res.json(new ApiResponse(200, queue, "Own queue fetched"));
        });
      If that route 404s, this file falls back to whatever the
      dashboard endpoint already gives us (clinicStatus + nowServing)
      and leaves lastToken / delay / estimatedTimePerPatient at
      their last-known values.
   5. `cancelAppointment` is patient-only (checks Patient ownership),
      so the doctor dashboard's "Cancel Appointment" button calls
      `updateAppointmentStatus` with `{ status: "cancelled" }` instead.
   6. Subscription + notifications have no backend routes in what was
      shared, so those two panels are left mocked — clearly marked
      below — until those endpoints exist.
   7. Realtime: socket.io-client must be loaded on the page
      (e.g. `<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>`
      in doctor-dashboard.html, before this script) for the socket
      block near the bottom to activate. If `io` isn't found, the
      dashboard still works — it just won't get push updates and will
      rely on refetching after each action.

   QUEUE LIFECYCLE (fixed):
   "No patients waiting" and "clinic closed" are NOT the same state.
   Finishing the last patient marks THAT APPOINTMENT completed via
   PATCH /appointments/:id/status — nothing more. It never touches
   clinicStatus. Closing the clinic is a separate, explicit doctor
   action (the "Close Clinic" button -> toggleClinic() -> PATCH
   /queue/end), independent of how many patients were served.
   See serveNext() / renderQueue() below.

   DATE SCOPING (fixed):
   loadAppointments() previously never received the selected date at
   all — loadAll() called it with zero arguments, and even if it had,
   GET /appointments/doctor never read a date query param on the
   backend. Every appointment the doctor ever had was fetched
   regardless of which day was selected, so navigating days (Previous
   Day / Next Day / the date picker) never actually changed what
   showed up in Overview's "Today's Appointments", the Queue page, or
   the Appointments table. Both are fixed now: loadAll() resolves the
   selected date via loadDashboard() first, then passes THAT exact
   date into loadAppointments(), which appends it as ?date=... — and
   the backend controller needs the matching fix (see
   getDoctorAppointments) to actually filter by it.
   ============================================================ */

const CFG = window.CLINICFLOW_CONFIG || {};
const API_BASE = CFG.API_BASE || "http://localhost:8000";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ENDPOINTS = {
  dashboard: () => `${API_BASE}/dashboard/doctor`,
  doctorProfileUpdate: () => `${API_BASE}/doctor/profile`,
  doctorMe: () => `${API_BASE}/doctor/getdrprofile`,
  queueStart: () => `${API_BASE}/queue/start`,
  queueNext: () => `${API_BASE}/queue/next`,
  queueDelay: () => `${API_BASE}/queue/delay`,
  queueTime: () => `${API_BASE}/queue/time`,
  queueEnd: () => `${API_BASE}/queue/end`,
  queueReset: () => `${API_BASE}/queue/reset`,
  queueMe: () => `${API_BASE}/queue/me`,
  appointmentsDoctor: () => `${API_BASE}/appointments/doctor`,
  appointmentStatus: (id) => `${API_BASE}/appointments/${id}/status`,
  appointmentPay: (id) => `${API_BASE}/appointments/${id}/pay`,
  revenue: (params) => `${API_BASE}/revenue?${new URLSearchParams(params).toString()}`,
  logout: () => `${API_BASE}/auth/logout`,
  emailChangeRequest: () => `${API_BASE}/auth/email/request`,
  emailChangeVerify: () => `${API_BASE}/auth/email/verify`,
};

/* ---------- fetch helpers ---------- */
async function apiCall(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* no JSON body */
  }

  if (!res.ok) {
    const message = payload?.message || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload; // ApiResponse shape: { statusCode, data, message, success }
}
const apiGet = (url) => apiCall(url, { method: "GET" });
const apiPatch = (url, body) => apiCall(url, { method: "PATCH", body });
const apiPost = (url, body) => apiCall(url, { method: "POST", body });

/* ============================================================
   LIVE STATE — replaces the old hard-coded mock objects.
   Populated by loadAll() on init and refreshed after every action.
   ============================================================ */
const DOCTOR = {
  _id: "",
  name: "",
  email: "",
  phone: "",
  spec: "",
  doctorId: "",
  clinic: "",
  address: "",
  fee: 0,
  bio: "",
  experience: 0,
  licenseNumber: "",
  // Account gating — from doctor.model.js. status defaults to
  // "pending" until an admin approves it; isSuspended is a separate
  // flag independent of status (see renderAccountBlocked below).
  status: "pending",
  isSuspended: false,
  suspensionReason: "",
};

const STATE = {
  clinicOpen: false,
  nowServing: 0,
  perPatient: 10,
  delay: 0,
  lastToken: 0,
  selectedDate: null,
  clinicDayLabel: "",
  appointments: [],
  subscription: {
    plan: "Free",
    status: "Active",
    start: "—",
    end: "—",
  },
  notifications: [],
  revenue: {
    range: "28", // "7" | "28" | "custom" — which button is active
    from: "",     // only meaningful when range === "custom"
    to: "",
    totalRevenue: 0,
    paidAppointments: 0,
    averageConsultationFee: 0,
    appointments: [],
    loaded: false,
  },
};

/* ---------- derived helpers over live STATE.appointments ---------- */
const nameFor = (tok) =>
  STATE.appointments.find((a) => a.token === tok)?.patient || "—";
const statusFor = (tok) =>
  STATE.appointments.find((a) => a.token === tok)?.status || "waiting";
const apptFor = (tok) => STATE.appointments.find((a) => a.token === tok);
const nextWaiting = (from) => {
  const tokens = STATE.appointments
    .map((a) => a.token)
    .filter((t) => t > from)
    .sort((a, b) => a - b);
  for (const t of tokens) if (statusFor(t) === "waiting") return t;
  return null;
};
const counts = () => {
  const c = {
    total: STATE.appointments.length,
    waiting: 0,
    "in-progress": 0,
    completed: 0,
    cancelled: 0,
  };
  STATE.appointments.forEach((a) => {
    if (c[a.status] !== undefined) c[a.status]++;
  });
  return c;
};
const waitingCount = () =>
  STATE.appointments.filter((a) => a.status === "waiting").length;
const appts = () => STATE.appointments; // kept for drop-in compatibility with render code

/* LOADERS — pull real data from the backend*/
// Explicit timeZone: "Asia/Karachi" on both formatters — without
// this, these use the BROWSER's local timezone implicitly, which can
// render a different calendar day than the one actually selected via
// the PKT-based backend filter (see getDoctorDashboard /
// getDoctorAppointments). Matches the backend's PKT_OFFSET_MS
// assumption explicitly instead of hoping the browser happens to
// agree.
function formatLongDate(d) {
  return new Date(d).toLocaleDateString("en-US", {
    timeZone: "Asia/Karachi",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
function formatShortDate(d) {
  return new Date(d).toLocaleDateString("en-US", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Adds `delta` days to a "YYYY-MM-DD" string using pure UTC
// arithmetic — Date.UTC()/getUTCDate()/setUTCDate() never consult the
// browser's local timezone at all, so this is correct regardless of
// what timezone the machine running the dashboard happens to be set
// to. This is what datePrev/dateNext use below, replacing the old
// `new Date(str); d.setDate(...); d.toISOString()` pattern, which
// silently depended on the browser's LOCAL timezone matching PKT.
function addDaysToISO(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

async function loadDashboard(dateStr) {
  const url = dateStr
    ? `${ENDPOINTS.dashboard()}?date=${encodeURIComponent(dateStr)}`
    : ENDPOINTS.dashboard();
  const res = await apiGet(url);
  const d = res.data;

  DOCTOR._id = d.doctor?._id || DOCTOR._id;
  DOCTOR.doctorId = d.doctor?.doctorId || DOCTOR.doctorId;
  DOCTOR.name = d.doctor?.fullname || DOCTOR.name;
  DOCTOR.clinic = d.doctor?.clinicName || DOCTOR.clinic;
  DOCTOR.spec = d.doctor?.specialization || DOCTOR.spec;
  // Plain fields on the Doctor document itself — should already be
  // present here the same way clinicName/specialization are, since
  // none of these require a populate/join.
  DOCTOR.status = d.doctor?.status || DOCTOR.status;
  DOCTOR.isSuspended = d.doctor?.isSuspended ?? DOCTOR.isSuspended;
  DOCTOR.suspensionReason = d.doctor?.suspensionReason || "";

  STATE.clinicOpen = d.clinicStatus === "open";
  STATE.nowServing = d.currentServingToken ?? STATE.nowServing;
  // This is the single source of truth for "which day is selected"
  // across the whole dashboard — the backend resolves it (defaults
  // to today if dateStr was undefined) and every other loader below
  // uses THIS value, not the raw dateStr argument, so they can never
  // drift apart from what the stats cards are showing.
  STATE.selectedDate = d.selectedDate;
  STATE.clinicDayLabel = formatLongDate(d.selectedDate);
}

async function loadDoctorProfile() {
  const res = await apiGet(ENDPOINTS.doctorMe());
  const d = res.data;
  DOCTOR.email = d.user?.email || DOCTOR.email;
  DOCTOR.phone = d.user?.phone || DOCTOR.phone;
  DOCTOR.address = d.clinicAddress || DOCTOR.address;
  DOCTOR.fee = d.consultationFee || DOCTOR.fee;
  DOCTOR.bio = d.bio || DOCTOR.bio;
  DOCTOR.experience = d.experience ?? DOCTOR.experience;
  DOCTOR.licenseNumber = d.licenseNumber || DOCTOR.licenseNumber;
}

async function loadQueueMe() {
  try {
    const res = await apiGet(ENDPOINTS.queueMe());
    const q = res.data;
    applyQueueDoc(q);
  } catch (err) {
    // Route not implemented yet on the backend — degrade gracefully.
    console.warn(
      "GET /queue/me unavailable, falling back to dashboard-only queue data:",
      err.message,
    );
  }
}

function applyQueueDoc(q) {
  if (!q) return;
  STATE.clinicOpen = q.clinicStatus === "open";
  STATE.nowServing = q.nowServing ?? STATE.nowServing;
  STATE.lastToken = q.lastToken ?? STATE.lastToken;
  STATE.perPatient = q.estimatedTimePerPatient ?? STATE.perPatient;
  STATE.delay = q.delayInMinutes ?? STATE.delay;
}

// dateStr is now REQUIRED-in-practice: loadAll() always passes
// STATE.selectedDate (resolved by loadDashboard) so this stays in
// sync with the stats cards. Left optional here only so this
// function can still be called standalone (e.g. after cancelling an
// appointment) without having to re-derive the date at each call site.
async function loadAppointments(dateStr) {
  const url = dateStr
    ? `${ENDPOINTS.appointmentsDoctor()}?date=${encodeURIComponent(dateStr)}`
    : ENDPOINTS.appointmentsDoctor();
  const res = await apiGet(url);
  const list = res.data || [];
  STATE.appointments = list
    .map((a) => ({
      id: a._id,
      appointmentId: a.appointmentId,
      token: a.tokenNumber,
      patient: a.patientName || a.patient?.user?.fullname || "Unknown patient",
      status: a.status,
      date: formatShortDate(a.appointmentDate),
      clinic: DOCTOR.clinic,
      createdAt: formatShortDate(a.createdAt),
      fee: a.consultationFee ?? 0,
      paymentStatus: a.paymentStatus || "unpaid",
      paidAt: a.paidAt || null,
    }))
    .sort((a, b) => a.token - b.token);

  if (STATE.appointments.length) {
    STATE.lastToken = Math.max(
      STATE.lastToken,
      ...STATE.appointments.map((a) => a.token),
    );
  }
}

async function loadAll(dateStr) {
  await loadDashboard(dateStr);
  // Use STATE.selectedDate (the backend-resolved date), not the raw
  // dateStr argument — this is what was silently missing before, and
  // is why the appointments list/table never actually changed when
  // navigating days.
  await Promise.all([
    loadQueueMe(),
    loadAppointments(STATE.selectedDate),
    loadDoctorProfile(),
  ]);
}

// Loads STATE.revenue for whichever range is currently active.
// Called lazily — only when the Revenue view is actually opened or a
// range button is clicked — not as part of loadAll(), since revenue
// isn't needed for the Overview/Queue/Appointments pages at all
// (only a tiny summary card on Overview needs SOME numbers, and that
// reuses this same loader on first render).
async function loadRevenue() {
  const r = STATE.revenue;
  const params =
    r.range === "custom"
      ? { from: r.from, to: r.to }
      : { range: r.range };

  const res = await apiGet(ENDPOINTS.revenue(params));
  const d = res.data;

  r.totalRevenue = d.totalRevenue ?? 0;
  r.paidAppointments = d.paidAppointments ?? 0;
  r.averageConsultationFee = d.averageConsultationFee ?? 0;
  r.from = d.from || r.from;
  r.to = d.to || r.to;
  r.appointments = d.appointments || [];
  r.loaded = true;
}

/* ---------- ROUTER ---------- */
const TITLES = {
  overview: "Overview",
  appointments: "Appointments",
  queue: "Queue",
  revenue: "Revenue",
  profile: "Profile",
  subscription: "Subscription",
  help: "Help & Support",
};
function showView(name) {
  $$(".view").forEach((v) => (v.hidden = true));
  const v = $("#view-" + name);
  if (v) v.hidden = false;
  $("#pageTitle").textContent = TITLES[name] || "Overview";
  $$("#nav a, .sb-bottom a[data-view]").forEach((a) =>
    a.classList.toggle("active", a.dataset.view === name),
  );
  closeMenus();
  closeSidebar();
  history.replaceState(null, "", "#" + name);
  if (name === "overview") renderOverview();
  if (name === "appointments") renderAppointments();
  if (name === "queue") renderQueue();
  if (name === "revenue") openRevenueView();
  if (name === "profile") renderProfile();
  if (name === "subscription") renderSubscription();
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-view]");
  if (el) {
    e.preventDefault();
    showView(el.dataset.view);
  }
});

/* ---------- OVERVIEW ---------- */
function renderOverview() {
  $("#greeting").textContent =
    `${greetWord()}, ${DOCTOR.name.replace("Dr. ", "Dr. ").split(" ").slice(0, 2).join(" ")}`;
  $("#clinicName").textContent = DOCTOR.clinic;
  $("#todayDate").textContent = STATE.clinicDayLabel;

  const open = STATE.clinicOpen;
  $("#clinicStatusCard").innerHTML = `
    <div class="card clinic-status">
      <div class="cs-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 4h3a2 2 0 0 1 2 2v14M2 20h20M13 20V4L6 6v14" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 12h.01" stroke-linecap="round"/></svg></div>
      <div class="cs-body ${open ? "open" : ""}">
        <div class="k">Clinic Status</div>
        <h2><span class="d"></span> ${open ? "Clinic Open" : "Clinic Closed"}</h2>
        <div class="desc">${open ? "Your clinic is open and the queue is active." : "Your clinic is currently closed."}</div>
        <div class="meta">${DOCTOR.clinic} · ${STATE.clinicDayLabel}</div>
      </div>
      <button class="btn ${open ? "btn-danger-ghost" : "btn-primary"}" id="ovClinicBtn">${open ? "Close Clinic" : "Open Clinic"}</button>
    </div>`;
  $("#ovClinicBtn").onclick = toggleClinic;

  const c = counts();
  $("#statGrid").innerHTML = [
    [
      "Today's Appointments",
      c.total,
      "blue",
      '<rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2v4M16 2v4"/',
    ],
    [
      "Waiting",
      c.waiting,
      "amber",
      '<path d="M6 2h12M6 22h12M8 2c0 5 8 5 8 10s-8 5-8 10"/',
    ],
    [
      "In Progress",
      c["in-progress"],
      "prog",
      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/',
    ],
    [
      "Completed",
      c.completed,
      "green",
      '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/',
    ],
    [
      "Cancelled",
      c.cancelled,
      "red",
      '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/',
    ],
  ]
    .map(
      ([k, v, tone, ic]) => `
    <div class="stat"><div class="st-top"><span class="st-ic ${tone}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic}</svg></span>${k}</div><div class="st-val">${v}</div></div>`,
    )
    .join("");

  renderLiveQueueCard($("#liveQueueCard"), { withActions: true });
  renderSequence($("#seqList"));

  // Render immediately with whatever's cached (zeros on first ever
  // load), then re-render once the real numbers come back — same
  // optimistic-then-refresh pattern as the rest of this dashboard.
  renderRevenueCard($("#revenueCard"));
  if (!STATE.revenue.loaded) {
    loadRevenue()
      .then(() => renderRevenueCard($("#revenueCard")))
      .catch((err) => console.warn("Revenue load failed:", err.message));
  }

  $("#overviewAppts").innerHTML = `
    <div class="aph"><div><h2>Today's Appointments</h2><div class="sub">${STATE.clinicDayLabel}</div></div><span class="count-chip">${c.total}</span></div>
    ${apptTableHTML(appts())}`;
}

// Small summary card — total for the currently active range, paid
// appointment count, and a button into the full Revenue page.
function renderRevenueCard(el) {
  if (!el) return;
  const r = STATE.revenue;
  const scopeLabel =
    r.range === "custom" && r.from && r.to
      ? `${r.from} – ${r.to}`
      : `Last ${r.range} days`;

  el.innerHTML = `
    <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;">
      <div>
        <div style="font-size:11.5px;font-weight:700;letter-spacing:.06em;color:var(--muted,#6b7180);text-transform:uppercase;margin-bottom:6px;">Revenue</div>
        <div style="font-family:'Bricolage Grotesque',sans-serif;font-size:28px;font-weight:800;line-height:1;">PKR ${r.totalRevenue.toLocaleString()}</div>
        <div style="font-size:13px;color:var(--muted,#6b7180);margin-top:6px;">
          ${scopeLabel} · ${r.paidAppointments} paid appointment${r.paidAppointments === 1 ? "" : "s"}
        </div>
      </div>
      <button class="btn btn-primary" id="viewRevenueBtn">View Revenue</button>
    </div>`;
  $("#viewRevenueBtn").onclick = () => showView("revenue");
}

function renderLiveQueueCard(el, { withActions }) {
  const open = STATE.clinicOpen;
  const nx = nextWaiting(STATE.nowServing);
  const delayTxt = STATE.delay > 0 ? `+${STATE.delay} min` : "On time";
  el.innerHTML = `
    <div class="lq-head"><div><h2>Live Queue</h2><div class="sub">Real-time token flow for today's clinic session.</div></div>
      <span class="pill ${open ? "active" : "closed"}"><span class="d"></span> ${open ? "Queue Active" : "Queue Closed"}</span></div>
    <div class="lq-body">
      <div class="now-serving">
        <div class="k">Now Serving</div>
        <div class="big" id="nsTok">${tokenLabel(STATE.nowServing)}</div>
        <div class="pname">${nowServingName()}</div>
        <div class="next-box"><div><div class="k">Next Patient</div><div class="nm">${nx ? nameFor(nx) : "—"}</div></div><div class="tk">${nx ? "#" + nx : "—"}</div></div>
      </div>
      <div class="lq-metrics">
        <div class="lq-metric"><div class="k">Patients Waiting</div><div class="v">${waitingCount()}</div><div class="vsub">In queue now</div></div>
        <div class="lq-metric"><div class="k">Last Token</div><div class="v">#${STATE.lastToken}</div><div class="vsub">Issued today</div></div>
        <div class="lq-metric"><div class="k">Est. Time / Patient</div><div class="v">${STATE.perPatient} min</div><div class="vsub">Average consult…</div></div>
        <div class="lq-metric"><div class="k">Current Delay</div><div class="v ${STATE.delay ? "" : "green"}">${delayTxt}</div><div class="vsub">${STATE.delay ? "Reported delay" : "No delay reported"}</div></div>
      </div>
    </div>
    ${
      withActions
        ? `<div class="lq-actions">
      <button class="btn ${open ? "btn-danger-ghost" : "btn-primary"}" id="lqClinicBtn">${open ? "Close Clinic" : "Open Clinic"}</button>
      <button class="btn btn-ghost" id="lqDelayBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round"/></svg> Add Delay</button>
    </div>`
        : ""
    }`;
  if (withActions) {
    $("#lqClinicBtn").onclick = toggleClinic;
    $("#lqDelayBtn").onclick = openDelayModal;
  }
}

function renderSequence(el) {
  const tokens = STATE.appointments.map((a) => a.token).sort((a, b) => a - b);
  if (!tokens.length) {
    el.innerHTML = `<div class="empty-state"><p>No appointments yet.</p></div>`;
    return;
  }
  const startIdx = Math.max(
    0,
    tokens.findIndex((t) => t >= STATE.nowServing) - 2,
  );
  const windowTokens = tokens.slice(startIdx, startIdx + 6);
  let out = "";
  for (const n of windowTokens) {
    const st = statusFor(n);
    const isServing = n === STATE.nowServing && st === "in-progress";
    const isNext = n === nextWaiting(STATE.nowServing);
    let cls = "",
      label = "Waiting",
      lcls = "";
    if (st === "completed") {
      cls = "completed";
      label = "Completed";
      lcls = "completed";
    } else if (isServing) {
      cls = "serving";
      label = "Now Serving";
      lcls = "serving";
    } else if (isNext) {
      label = "Next";
      lcls = "next";
    } else if (st === "cancelled") {
      label = "Cancelled";
    }
    out += `<div class="seq-row ${cls}"><span class="seq-tok">#${n}</span><span class="seq-name">${nameFor(n)}</span><span class="seq-status ${lcls}">${label}</span></div>`;
  }
  el.innerHTML = out;
}

/* ---------- CLINIC OPEN / CLOSE ----------
   The ONLY two places clinicStatus is ever changed. Whether there
   are patients waiting, in progress, or none at all has no bearing
   on this — closing is always an explicit doctor action. */
async function toggleClinic() {
  if (!STATE.clinicOpen) {
    try {
      const res = await apiPatch(ENDPOINTS.queueStart());
      applyQueueDoc(res.data);
      toast("Clinic opened", "● Queue is now active.");
      refreshAll();
    } catch (err) {
      toast("Couldn't open the clinic", err.message, true);
    }
  } else {
    confirmModal({
      tone: "warn",
      title: "Close the clinic?",
      body: "Are you sure you want to close the clinic? Patients will no longer be served until you reopen.",
      confirmText: "Close Clinic",
      danger: true,
      onConfirm: async () => {
        try {
          const res = await apiPatch(ENDPOINTS.queueEnd());
          applyQueueDoc(res.data);
          toast("Clinic closed", "Your clinic is now closed.");
          refreshAll();
        } catch (err) {
          toast("Couldn't close the clinic", err.message, true);
        }
      },
    });
  }
}

/* ---------- QUEUE CONTROL PAGE ---------- */
function renderQueue() {
  $("#queueSub").textContent =
    `${STATE.clinicDayLabel} · patients are served strictly by token number.`;
  const open = STATE.clinicOpen;
  $("#qcStatusBadge").className = `pill ${open ? "active" : "closed"}`;
  $("#qcStatusBadge").innerHTML =
    `<span class="d"></span> ${open ? "Queue Active" : "Queue Closed"}`;
  $("#qcNow").textContent = tokenLabel(STATE.nowServing);
  $("#qcNowName").textContent = nowServingName();
  const nx = nextWaiting(STATE.nowServing);
  $("#qcNextName").textContent = nx ? nameFor(nx) : "—";
  $("#qcNextTok").textContent = nx ? "#" + nx : "—";

  const delayTxt = STATE.delay > 0 ? `+${STATE.delay} min` : "On time";
  $("#qcMetrics").innerHTML = `
    <div class="lq-metric"><div class="k">Patients Waiting</div><div class="v">${waitingCount()}</div><div class="vsub">In queue now</div></div>
    <div class="lq-metric"><div class="k">Last Token</div><div class="v">#${STATE.lastToken}</div><div class="vsub">Issued today</div></div>
    <div class="lq-metric"><div class="k">Est. Time / Patient</div><div class="v">${STATE.perPatient} min</div><div class="vsub">Average consultation</div></div>
    <div class="lq-metric"><div class="k">Current Delay</div><div class="v ${STATE.delay ? "" : "green"}">${delayTxt}</div><div class="vsub">${STATE.delay ? "Reported delay" : "No delay reported"}</div></div>`;

  $("#qcActions").innerHTML = `
    <button class="btn ${open ? "btn-danger-ghost" : "btn-primary"}" id="qcClinicBtn">${open ? "Close Clinic" : "Open Clinic"}</button>
    <button class="btn btn-ghost" id="qcDelayBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round"/></svg> Add Delay</button>
    <button class="btn btn-ghost" id="qcResetBtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-4v4h4" stroke-linecap="round" stroke-linejoin="round"/></svg> Reset Queue</button>`;
  $("#qcClinicBtn").onclick = toggleClinic;
  $("#qcDelayBtn").onclick = openDelayModal;
  $("#qcResetBtn").onclick = resetQueue;

  $("#svCur").textContent = tokenLabel(STATE.nowServing);
  $("#svCurName").textContent = nowServingName();
  $("#svNext").textContent = nx ? "#" + nx : "—";
  $("#svNextName").textContent = nx ? nameFor(nx) : "—";

  // ---- Serve/Complete button state -----------------------------
  // Three independent facts decide what this button does:
  //   1. is the clinic open at all?
  //   2. is there a patient currently in-progress?
  //   3. is there another patient waiting after them?
  // None of these ever imply "close the clinic" — that stays a
  // separate action the doctor takes with the Close Clinic button.
  const btn = $("#serveNextBtn");
  const current = apptFor(STATE.nowServing);
  const currentInProgress = current && current.status === "in-progress";

  if (!open) {
    btn.disabled = true;
    btn.textContent = "Serve Next Patient →";
    btn.onclick = serveNext;
    $("#serveNote").textContent =
      "Open the clinic to continue serving patients.";
  } else if (!nx && !currentInProgress) {
    // Nobody in progress and nobody waiting — genuinely nothing left
    // to serve right now. This is a normal, valid state; it does
    // NOT mean the clinic should close.
    btn.disabled = true;
    btn.textContent = "All Patients Served";
    btn.onclick = null;
    $("#serveNote").textContent =
      "All patients have been served. The queue stays open — close the clinic whenever you're ready using the button above.";
  } else if (!nx && currentInProgress) {
    // Last patient of the day, still in progress.
    btn.disabled = false;
    btn.textContent = "Complete Current Patient";
    btn.onclick = serveNext;
    $("#serveNote").textContent =
      "This is the last patient in today's queue. Completing them won't close the clinic.";
  } else {
    btn.disabled = false;
    btn.textContent = "Serve Next Patient →";
    btn.onclick = serveNext;
    $("#serveNote").textContent =
      "Completing the current token moves the queue forward.";
  }

  renderSequence($("#qcSeqList"));
}

/* Completes whichever patient is currently in-progress (if any),
   then — only if someone is waiting — advances the queue to them.
   Never touches clinicStatus. This is the single fix for
   "appointment not moving from waiting/in-progress to completed". */
async function serveNext() {
  if (!STATE.clinicOpen) return;

  const current = apptFor(STATE.nowServing);
  const nx = nextWaiting(STATE.nowServing);

  if (!current && !nx) {
    return toast("Queue empty", "No more patients waiting.", true);
  }

  const btn = $("#serveNextBtn");
  const prevLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = nx ? "Serving…" : "Completing…";

  try {
    // Step 1 — explicitly mark the current appointment completed.
    // This PATCH is the piece that was missing: queue/next alone
    // was only ever moving the "now serving" pointer, never the
    // appointment's own status field.
    if (current && current.status === "in-progress") {
      await apiPatch(ENDPOINTS.appointmentStatus(current.id), {
        status: "completed",
      });
    }

    // Step 2 — only advance the queue pointer if someone is waiting.
    if (nx) {
      await apiPatch(ENDPOINTS.queueNext());
      toast("Serving next patient", `Now serving #${nx}.`);
    } else {
      toast("Patient completed", "All patients have been served.");
    }

    await loadAll(STATE.selectedDate);
    refreshAll();
  } catch (err) {
    toast("Couldn't update the queue", err.message, true);
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
}

function resetQueue() {
  confirmModal({
    tone: "warn",
    title: "Reset the queue?",
    body: "This clears today's progress and returns the queue to the first token. This cannot be undone.",
    confirmText: "Reset Queue",
    danger: true,
    onConfirm: async () => {
      try {
        const res = await apiPatch(ENDPOINTS.queueReset());
        applyQueueDoc(res.data);
        toast("Queue reset", "The queue has been reset.");
        await loadAppointments(STATE.selectedDate);
        refreshAll();
      } catch (err) {
        toast("Couldn't reset the queue", err.message, true);
      }
    },
  });
}

/* ---------- ADD DELAY ---------- */
function openDelayModal() {
  openModal(`
    <div class="modal-head"><div><h2>Add Clinic Delay</h2><div class="sub">Extra minutes are added to every patient's wait.</div></div>
      <button class="modal-close" data-close><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <div class="field"><label>Delay in minutes</label><input type="number" id="delayInput" min="0" value="${STATE.delay || 10}"></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="delaySave">Add Delay</button></div>`);
  $("#delaySave").onclick = async () => {
    const v = parseInt($("#delayInput").value, 10);
    if (isNaN(v) || v < 0)
      return toast("Invalid delay", "Enter a valid number of minutes.", true);
    const btn = $("#delaySave");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const res = await apiPatch(ENDPOINTS.queueDelay(), { delay: v });
      applyQueueDoc(res.data);
      closeModal();
      toast("Delay updated", `Current delay set to +${v} min.`);
      refreshAll();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Add Delay";
      toast("Couldn't update the delay", err.message, true);
    }
  };
}

/* ---------- APPOINTMENTS PAGE ---------- */
let apptFilter = "all",
  apptSearch = "";
function renderAppointments() {
  $("#dateCur").textContent = STATE.clinicDayLabel;
  $("#apptDayLabel").textContent = STATE.clinicDayLabel;
  // Keep the date picker's own displayed value in sync with whatever
  // is actually loaded. Without this, Previous Day/Next Day change
  // STATE.selectedDate and reload the data correctly, but the
  // <input type="date"> itself is never touched — it silently drifts
  // out of sync. A native date input only fires "change" when its
  // value actually differs from what's currently shown, so clicking
  // a date in the picker that happens to match its own STALE
  // displayed value does nothing at all, leaving the doctor stuck on
  // whatever day the buttons had navigated to.
  const dateInput = $("#apptDate");
  if (dateInput && STATE.selectedDate) dateInput.value = STATE.selectedDate;
  let list = appts();
  if (apptFilter !== "all") list = list.filter((a) => a.status === apptFilter);
  if (apptSearch) {
    const q = apptSearch.toLowerCase();
    list = list.filter(
      (a) =>
        a.patient.toLowerCase().includes(q) ||
        (a.appointmentId || "").toLowerCase().includes(q),
    );
  }
  // Reflects whichever scope is active: the "All" status tab shows
  // the total for the currently selected clinic day; switching to
  // Waiting/Completed/etc. narrows it to that status; the date
  // picker/Previous/Next Day buttons change which day's appointments
  // this total is drawn from in the first place (see loadAll fix).
  $("#apptCount").textContent = list.length;
  $("#apptTableWrap").innerHTML = list.length
    ? apptTableHTML(list)
    : `<div class="empty-state"><h3>No appointments for this date.</h3><p>Try a different date or filter.</p></div>`;
}
function apptTableHTML(list) {
  return `<table class="appt-table"><thead><tr><th>Token</th><th>Patient</th><th>Appointment Date</th><th>Status</th><th>Payment</th><th>Action</th></tr></thead><tbody>
    ${list
      .map((a) => {
        const paid = a.paymentStatus === "paid";
        const paymentCell = paid
          ? `<span class="pill completed"><span class="d"></span> Paid</span>`
          : `<button class="btn btn-ghost" style="padding:6px 12px;font-size:12.5px;" data-markpaid="${a.id}" data-token="${a.token}">Mark Paid</button>`;
        return `<tr>
      <td class="tk">#${a.token}</td><td class="pt">${a.patient}</td><td class="dt">${a.date}</td>
      <td><span class="pill ${a.status}"><span class="d"></span> ${label(a.status)}</span></td>
      <td>${paymentCell}</td>
      <td class="act"><button class="view-btn" data-details="${a.token}">View</button></td></tr>`;
      })
      .join("")}
  </tbody></table>`;
}
// Inline "Mark Paid" clicks from any appointments table (Overview's
// "Today's Appointments" and the full Appointments page both render
// via apptTableHTML, so one delegated listener covers both).
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-markpaid]");
  if (!btn) return;
  const apptId = btn.dataset.markpaid;
  const tok = btn.dataset.token;
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    await apiPatch(ENDPOINTS.appointmentPay(apptId));
    toast("Marked as paid", `Token #${tok} — payment recorded.`);
    await loadAppointments(STATE.selectedDate);
    STATE.revenue.loaded = false; // revenue totals just changed
    refreshAll();
  } catch (err) {
    toast("Couldn't mark as paid", err.message, true);
    btn.disabled = false;
    btn.textContent = "Mark Paid";
  }
});
$("#apptTabs").addEventListener("click", (e) => {
  const t = e.target.closest(".tab");
  if (!t) return;
  $$("#apptTabs .tab").forEach((x) => x.classList.remove("active"));
  t.classList.add("active");
  apptFilter = t.dataset.filter;
  renderAppointments();
});
$("#apptSearch").addEventListener("input", (e) => {
  apptSearch = e.target.value.trim();
  renderAppointments();
});
$("#apptDate").addEventListener("change", async (e) => {
  const val = e.target.value; // YYYY-MM-DD
  if (!val) return;
  try {
    await loadAll(val);
    refreshAll();
    toast("Date changed", "Showing appointments for the selected clinic day.");
  } catch (err) {
    toast("Couldn't load that date", err.message, true);
  }
});
$("#datePrev").addEventListener("click", async () => {
  const base = STATE.selectedDate || new Date().toISOString().slice(0, 10);
  await loadAll(addDaysToISO(base, -1));
  refreshAll();
  toast("Previous day", "Loaded previous clinic day.");
});
$("#dateNext").addEventListener("click", async () => {
  const base = STATE.selectedDate || new Date().toISOString().slice(0, 10);
  await loadAll(addDaysToISO(base, 1));
  refreshAll();
  toast("Next day", "Loaded next clinic day.");
});

/* ---------- DETAILS SLIDE-OVER ---------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-details]");
  if (el) {
    e.preventDefault();
    openDetails(+el.dataset.details);
  }
});
function openDetails(tok) {
  const a = appts().find((x) => x.token === tok);
  if (!a) return;
  const active = a.status === "waiting" || a.status === "in-progress";
  const ahead = Math.max(tok - STATE.nowServing - 1, 0);
  const live = active
    ? `
    <div class="so-sec">Live queue</div>
    <div class="so-live">
      <div><div class="lk">Current token</div><div class="lv blue">${tokenLabel(STATE.nowServing)}</div></div>
      <div><div class="lk">Patients ahead</div><div class="lv">${ahead}</div></div>
      <div><div class="lk">Estimated wait</div><div class="lv">~${ahead * STATE.perPatient + STATE.delay} min</div></div>
      <div><div class="lk">Status</div><div class="lv">${label(a.status)}</div></div>
    </div>`
    : "";
  const actions = active
    ? `
    <button class="btn btn-danger-ghost" style="width:100%;margin-top:22px" data-cancelappt="${a.id}" data-token="${tok}">Cancel Appointment</button>`
    : "";
  const paid = a.paymentStatus === "paid";
  const payment = `
    <div class="so-sec">Payment</div>
    <div class="so-rows">
      <div class="so-row"><span class="k">Consultation Fee</span><span class="v">PKR ${Number(a.fee || 0).toLocaleString()}</span></div>
      <div class="so-row"><span class="k">Payment</span><span class="v">
        <span class="pill ${paid ? "completed" : "waiting"}"><span class="d"></span> ${paid ? "Paid" : "Unpaid"}</span>
      </span></div>
      ${paid && a.paidAt ? `<div class="so-row"><span class="k">Paid At</span><span class="v">${new Date(a.paidAt).toLocaleString("en-US", { timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit", hour12: true })}</span></div>` : ""}
    </div>
    ${!paid ? `<button class="btn btn-primary" style="width:100%;margin-top:14px" id="markPaidBtn" data-appt-id="${a.id}">Mark as Paid</button>` : ""}`;
  $("#slideover").innerHTML = `
    <div class="so-head"><div class="so-title">Appointment details</div>
      <button class="modal-close" id="soClose"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <span class="pill ${a.status}" style="margin-bottom:16px"><span class="d"></span> ${label(a.status)}</span>
    <div class="so-rows">
      <div class="so-row"><span class="k">Appointment ID</span><span class="v mono">${a.appointmentId || a.id}</span></div>
      <div class="so-row"><span class="k">Patient Name</span><span class="v">${a.patient}</span></div>
      <div class="so-row"><span class="k">Token Number</span><span class="v">#${a.token}</span></div>
      <div class="so-row"><span class="k">Appointment Date</span><span class="v">${a.date}</span></div>
      <div class="so-row"><span class="k">Clinic</span><span class="v">${a.clinic}</span></div>
      <div class="so-row"><span class="k">Created At</span><span class="v">${a.createdAt}</span></div>
    </div>${payment}${live}${actions}`;
  $("#slideover").classList.add("open");
  $("#soBackdrop").classList.add("open");
  $("#soClose").onclick = closeDetails;
  const markPaidBtn = $("#markPaidBtn");
  if (markPaidBtn) {
    markPaidBtn.onclick = async () => {
      markPaidBtn.disabled = true;
      markPaidBtn.textContent = "Saving…";
      try {
        await apiPatch(ENDPOINTS.appointmentPay(markPaidBtn.dataset.apptId));
        toast("Marked as paid", `Token #${a.token} — payment recorded.`);
        await loadAppointments(STATE.selectedDate);
        // Revenue totals just changed — force a refetch next time the
        // Overview/Revenue view is shown rather than showing stale
        // numbers until the doctor happens to switch ranges.
        STATE.revenue.loaded = false;
        openDetails(tok);
        refreshAll();
      } catch (err) {
        toast("Couldn't mark as paid", err.message, true);
        markPaidBtn.disabled = false;
        markPaidBtn.textContent = "Mark as Paid";
      }
    };
  }
}
function closeDetails() {
  $("#slideover").classList.remove("open");
  $("#soBackdrop").classList.remove("open");
}
$("#soBackdrop").addEventListener("click", closeDetails);
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-cancelappt]");
  if (!c) return;
  const apptId = c.dataset.cancelappt;
  const tok = +c.dataset.token;
  closeDetails();
  confirmModal({
    tone: "danger",
    title: "Cancel this appointment?",
    body: "This will mark the appointment as cancelled. This cannot be undone.",
    confirmText: "Confirm Cancellation",
    danger: true,
    onConfirm: async () => {
      try {
        // Doctor-scoped cancellation: updateAppointmentStatus, not the
        // patient-only cancelAppointment endpoint. See assumption #5.
        await apiPatch(ENDPOINTS.appointmentStatus(apptId), {
          status: "cancelled",
        });
        toast("Appointment cancelled", `Token #${tok} has been cancelled.`);
        await loadAppointments(STATE.selectedDate);
        refreshAll();
      } catch (err) {
        toast("Couldn't cancel the appointment", err.message, true);
      }
    },
  });
});

function syncTopbarIdentity() {
  $("#topDoctorName").textContent = DOCTOR.name || "Doctor";
  $("#ddDoctorName").textContent = DOCTOR.name || "Doctor";
  $("#ddDoctorSpec").textContent = DOCTOR.spec || "";
}
/* PROFILE */
function renderProfile() {
  const d = DOCTOR;
  $("#profileCard").innerHTML = `
    <div class="pc-head">
      <div class="pc-avatar">${initials(d.name)}</div>
      <div>
        <div class="pn">${d.name}</div>
        <div class="pmeta">${d.spec} · ${d.clinic}</div>
      </div>
    </div>

    <div class="pc-section"><h3>Practitioner</h3></div>
    <div class="pc-grid">
      <div class="pc-box">
        <div class="fk">Full Name</div>
        <div class="fv">${d.name}</div>
      </div>
<div class="pc-box">
        <div class="fk">Email</div>
        <div class="fv">${d.email || "—"} <button type="button" class="change-email-btn" data-change-email>Change</button></div>
      </div>
      <div class="pc-box">
        <div class="fk">Phone</div>
        <div class="fv">${d.phone || "—"}</div>
      </div>
      <div class="pc-box">
        <div class="fk">Specialization</div>
        <div class="fv">${d.spec || "—"}</div>
      </div>
      <div class="pc-box">
        <div class="fk">Experience</div>
        <div class="fv">${d.experience ? d.experience + " years" : "—"}</div>
      </div>
      <div class="pc-box readonly">
        <div class="fk">License Number</div>
        <div class="fv">${d.licenseNumber || "—"}</div>
      </div>
      <div class="pc-box readonly">
        <div class="fk">Doctor ID</div>
        <div class="fv">${d.doctorId || "—"}</div>
      </div>
    </div>

<div class="pc-section"><h3>Bio</h3></div>
    <div class="pc-bio-card ${d.bio ? "" : "empty"}">
      ${d.bio || "No bio added yet. Click Edit Profile to add one."}
    </div>

    <div class="pc-section"><h3>Clinic</h3></div>
    <div class="pc-grid">
      <div class="pc-box">
        <div class="fk">Clinic Name</div>
        <div class="fv">${d.clinic || "—"}</div>
      </div>
      <div class="pc-box">
        <div class="fk">Clinic Address</div>
        <div class="fv">${d.address || "—"}</div>
      </div>
      <div class="pc-box">
        <div class="fk">Consultation Fee</div>
        <div class="fv">PKR ${Number(d.fee || 0).toLocaleString()}</div>
      </div>
<div class="pc-box">
        <div class="fk">Clinic Status</div>
        <div class="fv">
          <span class="pill ${STATE.clinicOpen ? "active" : "closed"}">
            <span class="d"></span>
            ${STATE.clinicOpen ? "Open" : "Closed"}
          </span>
        </div>
      </div>
      </div>
    </div>`;
}
$("#editProfileBtn").addEventListener("click", () => {
  const d = DOCTOR;
  openModal(`
  <div class="modal-head">
    <div><h2>Edit Profile</h2><div class="sub">Doctor ID and license number cannot be changed.</div></div>
    <button class="modal-close" data-close>✕</button>
  </div>
  <form id="profForm">
    <div class="field"><label>Full Name</label>
      <input name="fullname" value="${d.name}"></div>
    <div class="field"><label>Phone</label>
      <input name="phone" value="${d.phone || ""}"></div>
    <div class="field"><label>Specialization</label>
      <input name="specialization" value="${d.spec}"></div>
    <div class="field"><label>Experience (years)</label>
      <input name="experience" type="number" min="0" value="${d.experience || 0}"></div>
    <div class="field"><label>Clinic Name</label>
      <input name="clinicName" value="${d.clinic}"></div>
    <div class="field"><label>Clinic Address</label>
      <input name="clinicAddress" value="${d.address || ""}"></div>
    <div class="field"><label>Consultation Fee (PKR)</label>
      <input name="consultationFee" type="number" value="${d.fee}"></div>
    <div class="field"><label>Bio</label>
      <textarea name="bio" maxlength="1000" style="min-height:100px">${d.bio || ""}</textarea></div>

    <!-- Read-only fields -->
    <div class="field"><label>Doctor ID (read-only)</label>
      <input value="${d.doctorId}" disabled style="background:var(--line-soft);color:var(--muted)"></div>
    <div class="field"><label>License Number (read-only)</label>
      <input value="${d.licenseNumber || "—"}" disabled style="background:var(--line-soft);color:var(--muted)"></div>

    <div class="modal-foot">
      <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      <button type="submit" class="btn btn-primary" id="profSave">Save Changes</button>
    </div>
  </form>`);
  $("#profForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#profSave");
    btn.disabled = true;
    btn.textContent = "Saving…";
    const fd = Object.fromEntries(new FormData(e.target));
    fd.consultationFee = parseInt(fd.consultationFee, 10) || d.fee;
    fd.experience = parseInt(fd.experience, 10) || 0;
    try {
      const res = await apiPatch(ENDPOINTS.doctorProfileUpdate(), fd);
      const updated = res.data;
      DOCTOR.name = updated.user?.fullname || DOCTOR.name;
      DOCTOR.email = updated.user?.email || DOCTOR.email;
      DOCTOR.phone = updated.user?.phone || DOCTOR.phone;
      DOCTOR.spec = updated.specialization ?? DOCTOR.spec;
      DOCTOR.clinic = updated.clinicName ?? DOCTOR.clinic;
      DOCTOR.address = updated.clinicAddress ?? DOCTOR.address;
      DOCTOR.fee = updated.consultationFee ?? DOCTOR.fee;
      closeModal();
      renderProfile();
      toast("Profile updated successfully.");
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Save Changes";
      toast("Couldn't update your profile", err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Save Changes";
    }
  };
});

/* CHANGE EMAIL */
const emailChange = { step: 1, newEmail: "" };

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-change-email]")) {
    e.preventDefault();
    openEmailChange();
  }
});

function openEmailChange() {
  emailChange.step = 1;
  emailChange.newEmail = "";
  renderEmailChange();
  $("#emailChangeOverlay").classList.add("open");
}

$("#ecClose").addEventListener("click", () => {
  $("#emailChangeOverlay").classList.remove("open");
});
$("#emailChangeOverlay").addEventListener("click", (e) => {
  if (e.target.id === "emailChangeOverlay") {
    $("#emailChangeOverlay").classList.remove("open");
  }
});

function renderEmailChange() {
  const form = $("#ecForm");

  if (emailChange.step === 1) {
    $("#ecTitle").textContent = "Change Email";
    $("#ecSub").textContent = "Enter the new email you'd like to use.";
    form.innerHTML = `
      <div class="field" style="margin-bottom:22px">
        <label>New email</label>
        <input type="email" id="ecEmail" placeholder="you@example.com" value="${emailChange.newEmail}">
      </div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" id="ecCancel">Cancel</button><button type="submit" class="btn btn-primary" id="ecSubmit">Send Code</button></div>`;

    form.onsubmit = async (e) => {
      e.preventDefault();
      const val = $("#ecEmail").value.trim();
      if (!val) return toast("Enter a new email address.", "", true);

      const btn = $("#ecSubmit");
      btn.disabled = true;
      btn.textContent = "Sending…";

      try {
        const res = await apiPost(ENDPOINTS.emailChangeRequest(), {
          newEmail: val,
        });
        emailChange.newEmail = res.data?.newEmail || val;
        emailChange.step = 2;
        renderEmailChange();
        toast(
          "Verification code sent",
          `Check ${emailChange.newEmail} for the code.`,
        );
      } catch (err) {
        toast("Couldn't send code", err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = "Send Code";
      }
    };

    $("#ecCancel").onclick = () =>
      $("#emailChangeOverlay").classList.remove("open");
  } else if (emailChange.step === 2) {
    $("#ecTitle").textContent = "Verify your new email";
    $("#ecSub").textContent =
      `Enter the 6-digit code sent to ${emailChange.newEmail}.`;
    form.innerHTML = `
      <div class="field" style="margin-bottom:22px">
        <label style="text-align:center;display:block">Verification code</label>
        <div class="otp-boxes" id="ecOtpBoxes">
          ${Array.from(
            { length: 6 },
            (_, i) => `
            <input class="otp-box" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" data-otp-i="${i}" autocomplete="one-time-code">`,
          ).join("")}
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-ghost" id="ecBack">Back</button>
        <button type="submit" class="btn btn-primary" id="ecVerify">Verify Email</button>
      </div>`;

    const boxes = $$(".otp-box", form);
    boxes[0]?.focus();

    boxes.forEach((box, i) => {
      box.addEventListener("input", (e) => {
        const val = e.target.value.replace(/\D/g, "").slice(-1);
        e.target.value = val;
        e.target.classList.toggle("filled", !!val);
        if (val && boxes[i + 1]) boxes[i + 1].focus();
      });
      box.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !e.target.value && boxes[i - 1]) {
          boxes[i - 1].focus();
        }
      });
      box.addEventListener("paste", (e) => {
        e.preventDefault();
        const digits = (e.clipboardData.getData("text") || "")
          .replace(/\D/g, "")
          .slice(0, 6)
          .split("");
        digits.forEach((d, j) => {
          if (boxes[j]) {
            boxes[j].value = d;
            boxes[j].classList.add("filled");
          }
        });
        boxes[Math.min(digits.length, 5)]?.focus();
      });
    });

    form.onsubmit = async (e) => {
      e.preventDefault();
      const otp = $$(".otp-box", form)
        .map((b) => b.value)
        .join("");
      if (otp.length !== 6) return toast("Enter all 6 digits.", "", true);

      const btn = $("#ecVerify");
      btn.disabled = true;
      btn.textContent = "Verifying…";

      try {
        const res = await apiPost(ENDPOINTS.emailChangeVerify(), { otp });
        DOCTOR.email = res.data?.email || emailChange.newEmail;
        $("#emailChangeOverlay").classList.remove("open");
        renderProfile();
        toast("Email updated successfully.");
      } catch (err) {
        toast("Couldn't verify code", err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = "Verify Email";
      }
    };

    $("#ecBack").onclick = () => {
      emailChange.step = 1;
      renderEmailChange();
    };
  }
}
/* ---------- REVENUE ---------- */
// Called by showView("revenue"). Renders whatever's cached first
// (instant, no flash of empty content on repeat visits), then always
// re-fetches for the currently active range so the numbers are fresh.
async function openRevenueView() {
  renderRevenueView();
  try {
    await loadRevenue();
    renderRevenueView();
  } catch (err) {
    toast("Couldn't load revenue", err.message, true);
  }
}

function renderRevenueView() {
  const r = STATE.revenue;
  const wrap = $("#revenueWrap");
  if (!wrap) return;

  const rangeBtn = (value, label) => `
    <button class="btn ${r.range === value ? "btn-primary" : "btn-ghost"}" data-revenue-range="${value}">${label}</button>`;

  const customForm =
    r.range === "custom"
      ? `
    <div class="card" style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-top:14px;">
      <div class="field" style="margin:0;">
        <label>From</label>
        <input type="date" id="revenueFrom" value="${r.from}" max="${r.to || ""}">
      </div>
      <div class="field" style="margin:0;">
        <label>To</label>
        <input type="date" id="revenueTo" value="${r.to}">
      </div>
      <button class="btn btn-primary" id="revenueApplyBtn">Apply</button>
    </div>`
      : "";

  const scopeLabel =
    r.range === "custom" && r.from && r.to
      ? `${r.from} – ${r.to}`
      : `Last ${r.range} days`;

  const rows = r.appointments.length
    ? r.appointments
        .map(
          (a) => `
    <tr>
      <td class="pt">${a.patientName}</td>
      <td class="dt">${formatShortDate(a.appointmentDate)}</td>
      <td>PKR ${Number(a.consultationFee || 0).toLocaleString()}</td>
      <td><span class="pill completed"><span class="d"></span> Paid</span></td>
    </tr>`,
        )
        .join("")
    : `<tr><td colspan="4"><div class="empty-state"><h3>No paid appointments in this range.</h3></div></td></tr>`;

  wrap.innerHTML = `
    <div class="card filter-bar">
      <div class="fb-top" style="gap:10px;">
        ${rangeBtn("7", "Last 7 Days")}
        ${rangeBtn("28", "Last 28 Days")}
        ${rangeBtn("custom", "Custom Date")}
      </div>
    </div>
    ${customForm}
    <div class="stat-grid" style="margin-top:20px;">
      <div class="stat"><div class="st-top">Total Revenue</div><div class="st-val">PKR ${r.totalRevenue.toLocaleString()}</div></div>
      <div class="stat"><div class="st-top">Paid Appointments</div><div class="st-val">${r.paidAppointments}</div></div>
      <div class="stat"><div class="st-top">Average Consultation</div><div class="st-val">PKR ${r.averageConsultationFee.toLocaleString()}</div></div>
    </div>
    <div class="card appt-panel mt24">
      <div class="aph">
        <div><h2>Paid Appointments</h2><div class="sub">${scopeLabel}</div></div>
        <span class="count-chip">${r.paidAppointments}</span>
      </div>
      <table class="appt-table">
        <thead><tr><th>Patient</th><th>Date</th><th>Fee</th><th>Payment</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  $$("[data-revenue-range]", wrap).forEach((btn) => {
    btn.onclick = async () => {
      const value = btn.dataset.revenueRange;
      STATE.revenue.range = value;
      if (value !== "custom") {
        try {
          await loadRevenue();
        } catch (err) {
          toast("Couldn't load revenue", err.message, true);
        }
      }
      renderRevenueView();
    };
  });

  const applyBtn = $("#revenueApplyBtn");
  if (applyBtn) {
    applyBtn.onclick = async () => {
      const from = $("#revenueFrom").value;
      const to = $("#revenueTo").value;
      if (!from || !to) {
        return toast("Select both dates", "", true);
      }
      if (to < from) {
        return toast("Invalid range", "'To' can't be before 'From'.", true);
      }
      STATE.revenue.from = from;
      STATE.revenue.to = to;
      applyBtn.disabled = true;
      applyBtn.textContent = "Loading…";
      try {
        await loadRevenue();
        renderRevenueView();
      } catch (err) {
        toast("Couldn't load revenue", err.message, true);
        applyBtn.disabled = false;
        applyBtn.textContent = "Apply";
      }
    };
  }
}

/* ---------- SUBSCRIPTION (MOCK — no backend route provided) ---------- */
function renderSubscription() {
  const s = STATE.subscription;
  $("#subWrap").innerHTML = `
    <div class="card sub-current">
      <div class="sc-top"><div><div class="k">Current Plan</div><div class="sc-plan">${s.plan}</div>
        <div class="sc-dates">Start Date: ${s.start} · End Date: ${s.end}</div></div>
        <span class="pill active"><span class="d"></span> ${s.status}</span></div>
      <div class="sc-actions"><button class="btn btn-primary" id="upgradeBtn">Upgrade Plan</button><button class="btn btn-ghost" id="manageBtn">Manage Subscription</button></div>
    </div>
    <div class="plans">
      <div class="card plan ${s.plan === "Free" ? "current" : ""}">
        <div class="ph"><span class="pname">Free</span>${s.plan === "Free" ? '<span class="curtag">Current plan</span>' : ""}</div>
        <div class="price">PKR 0 <small>per month</small></div>
        <ul>${["Up to 25 tokens per clinic day", "Live queue with real-time updates", "Basic appointment management", "Email support"].map((f) => `<li><span class="ck">✓</span> ${f}</li>`).join("")}</ul>
      </div>
      <div class="card plan ${s.plan === "Practice" ? "current" : ""}">
        <div class="ph"><span class="pname">Practice</span>${s.plan === "Practice" ? '<span class="curtag">Current plan</span>' : ""}</div>
        <div class="price">PKR 4,500 <small>per month</small></div>
        <ul>${["Unlimited tokens per clinic day", "Advanced queue delay controls", "Patient notifications", "Priority support"].map((f) => `<li><span class="ck">✓</span> ${f}</li>`).join("")}</ul>
        ${s.plan !== "Practice" ? '<button class="btn btn-primary btn-lg" id="upgradePracticeBtn">Upgrade to Practice</button>' : ""}
      </div>
    </div>`;
  const up = () =>
    toast(
      "Not available yet",
      "Subscription upgrades need a backend endpoint — none was provided.",
      true,
    );
  $("#upgradeBtn").onclick = up;
  $("#manageBtn").onclick = up;
  const ub = $("#upgradePracticeBtn");
  if (ub) ub.onclick = up;
}

/* ---------- HELP + REPORT A PROBLEM ---------- */
const FAQS = [
  {
    q: "How does the token queue work?",
    a: "Patients receive a token when they book. You serve them strictly in token order — the queue never reorders by time.",
  },
  {
    q: "Why don't I see appointment times?",
    a: "ClinicFlow is token-based. Only the appointment date is stored; patients are called by token number, not by clock time.",
  },
  {
    q: "What happens when I add a delay?",
    a: "The delay in minutes is added to every waiting patient's estimated wait and broadcast live to their screens.",
  },
  {
    q: "Can I reopen the clinic after closing it?",
    a: "Yes. Closing the clinic pauses serving; you can reopen anytime and the queue resumes from the current token.",
  },
];
function renderFAQ() {
  $("#faqList").innerHTML = FAQS.map(
    (f) => `
    <div class="faq-item"><button class="faq-q">${f.q}<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="faq-a"><p>${f.a}</p></div></div>`,
  ).join("");
  $$("#faqList .faq-q").forEach(
    (q) =>
      (q.onclick = () => {
        const it = q.closest(".faq-item"),
          a = it.querySelector(".faq-a"),
          open = it.classList.contains("open");
        $$("#faqList .faq-item").forEach((x) => {
          x.classList.remove("open");
          x.querySelector(".faq-a").style.maxHeight = 0;
        });
        if (!open) {
          it.classList.add("open");
          a.style.maxHeight = a.scrollHeight + "px";
        }
      }),
  );
}
$("#contactBtn").addEventListener(
  "click",
  () => (location.href = "mailto:support@clinicflow.com"),
);
$("#faqBtn").addEventListener("click", () => {
  const f = $("#faqList .faq-q");
  if (f) f.click();
  f?.scrollIntoView({ behavior: "smooth", block: "center" });
});
$("#reportBtn").addEventListener("click", openReportModal);

function openReportModal() {
  // MOCK — no /support/report route was provided in the backend files shared.
  const MAX = 1000;
  openModal(`
    <div class="modal-head"><div><h2>Report a Problem</h2><div class="sub">Tell us about the issue you're experiencing.</div></div>
      <button class="modal-close" data-close><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <div class="field" id="reportField">
      <label>Describe your problem</label>
      <textarea id="reportText" maxlength="${MAX}" placeholder="Describe your problem here…"></textarea>
      <div class="char-count"><span id="charCount">0</span> / ${MAX}</div>
      <div class="err">Please describe the problem before sending.</div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="sendReport">Send Report</button></div>`);
  const ta = $("#reportText"),
    cc = $("#charCount"),
    field = $("#reportField");
  ta.addEventListener("input", () => {
    cc.textContent = ta.value.length;
    field.classList.remove("invalid");
  });
  $("#sendReport").onclick = async () => {
    const msg = ta.value.trim();
    if (!msg) {
      field.classList.add("invalid");
      return;
    }
    const btn = $("#sendReport");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      // TODO: replace with a real call once /support/report exists, e.g.
      // await apiPost(`${API_BASE}${API_PREFIX}/support/report`, { message: msg });
      await sleep(700);
      closeModal();
      toast("Report submitted", "Your report has been submitted successfully.");
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Send Report";
      toast("Unable to submit your report", "Please try again.", true);
    }
  };
}

/* ---------- CONFIRM MODAL ---------- */
function confirmModal({
  tone = "warn",
  title,
  body,
  confirmText = "Confirm",
  danger = false,
  onConfirm,
}) {
  const icon =
    tone === "danger"
      ? `<div class="confirm-icon danger"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01" stroke-linecap="round"/></svg></div>`
      : `<div class="confirm-icon warn"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/></svg></div>`;
  openModal(`${icon}<h2 style="font-size:21px;font-weight:700">${title}</h2>
    <p style="color:var(--muted);font-size:14.5px;margin-top:8px">${body}</p>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="confirmYes">${confirmText}</button></div>`);
  $("#confirmYes").onclick = () => {
    closeModal();
    onConfirm && onConfirm();
  };
}

/* ---------- MODAL PRIMITIVES ---------- */
function openModal(html) {
  $("#modalBox").innerHTML = html;
  $("#modalOverlay").classList.add("open");
}
function closeModal() {
  $("#modalOverlay").classList.remove("open");
}
$("#modalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "modalOverlay" || e.target.closest("[data-close]"))
    closeModal();
});

/* ---------- DROPDOWNS ---------- */
function closeMenus() {
  $("#notifMenu").classList.remove("open");
  $("#userMenu").classList.remove("open");
}
$("#notifBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#userMenu").classList.remove("open");
  $("#notifMenu").classList.toggle("open");
  STATE.notifications.forEach((n) => (n.read = true));
  $("#notifCount").style.display = "none";
  renderNotifs();
});
$("#userBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  $("#notifMenu").classList.remove("open");
  $("#userMenu").classList.toggle("open");
});
document.addEventListener("click", closeMenus);
function renderNotifs() {
  $("#notifList").innerHTML = STATE.notifications.length
    ? STATE.notifications
        .map(
          (n) =>
            `<div class="notif-item ${n.read ? "read" : ""}"><span class="nd"></span><div><div class="nt">${n.text}</div><div class="ntime">${n.time}</div></div></div>`,
        )
        .join("")
    : `<div class="notif-item read"><div><div class="nt">No notifications yet.</div></div></div>`;
  const unread = STATE.notifications.filter((n) => !n.read).length;
  $("#notifCount").textContent = unread;
  $("#notifCount").style.display = unread ? "grid" : "none";
}
/* ---------- TOAST ---------- */
function toast(title, msg = "", isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.innerHTML = `<span class="tic">${isError ? "!" : "✓"}</span><div><div class="tt">${title}</div>${msg ? `<div class="tm">${msg}</div>` : ""}</div>`;
  $("#toasts").appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 3600);
}

/* ---------- SIDEBAR / LOGOUT ---------- */
$("#sbOpen").addEventListener("click", () =>
  $("#sidebar").classList.add("open"),
);
function closeSidebar() {
  $("#sidebar").classList.remove("open");
}
[$("#logoutBtn"), $("#logoutBtn2")].forEach(
  (b) =>
    b &&
    b.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await apiPost(ENDPOINTS.logout());
      } catch (err) {
        console.warn("Logout request failed, redirecting anyway:", err.message);
      }
      window.location.href = "../../../Auth/login/login.html";
    }),
);

/* ---------- refresh everything visible ---------- */
function refreshAll() {
  if (!$("#view-overview").hidden) renderOverview();
  if (!$("#view-queue").hidden) renderQueue();
  if (!$("#view-appointments").hidden) renderAppointments();
  renderNotifs();
  syncTopbarIdentity();
}

/* ---------- helpers ---------- */
const label = (s) =>
  ({
    "in-progress": "In Progress",
    waiting: "Waiting",
    completed: "Completed",
    cancelled: "Cancelled",
  })[s] || s;
const initials = (n) =>
  (n || "")
    .replace(/^Dr\.?\s+/, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "DR";
const greetWord = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Token 0 means "nobody has been called yet" — the clinic hasn't
// started, or the queue has been reset. Token numbering starts at 1,
// so 0 is never a real token and must never be shown as "#0".
const tokenLabel = (n) => (n && n > 0 ? "#" + n : "—");

// Same idea, but for the "who's currently being served" name/label:
// distinguish "nobody yet because the clinic is closed" from "nobody
// yet because the clinic just opened and hasn't called anyone" —
// rather than falling through to a bare "—" with no context.
function nowServingName() {
  if (STATE.nowServing && STATE.nowServing > 0) {
    return nameFor(STATE.nowServing);
  }
  return STATE.clinicOpen
    ? "Waiting for the first patient"
    : "Clinic is currently closed";
}

/* SOCKET.IO — live queue push updates*/
let socket = null;
function initSocket() {
  if (typeof io !== "function") {
    console.warn(
      "socket.io client not found — realtime updates disabled, relying on refetch-after-action instead.",
    );
    return;
  }
  if (!DOCTOR._id) {
    console.warn("Doctor _id not loaded yet — cannot join queue room.");
    return;
  }

  socket = io(API_BASE, { withCredentials: true });

  socket.on("connect", () => {
    socket.emit("joinQueue", DOCTOR._id);
  });

  socket.on("queueUpdated", (d) => {
    STATE.nowServing = d.nowServing ?? STATE.nowServing;
    STATE.delay = d.delayInMinutes ?? STATE.delay;
    STATE.lastToken = d.lastToken ?? STATE.lastToken;
    STATE.perPatient = d.estimatedTimePerPatient ?? STATE.perPatient;
    refreshAll();
  });
  socket.on("clinicStarted", () => {
    STATE.clinicOpen = true;
    refreshAll();
  });
  socket.on("clinicClosed", () => {
    STATE.clinicOpen = false;
    refreshAll();
  });
  socket.on("delayUpdated", (d) => {
    STATE.delay = d.delayInMinutes ?? STATE.delay;
    STATE.nowServing = d.nowServing ?? STATE.nowServing;
    STATE.perPatient = d.estimatedTimePerPatient ?? STATE.perPatient;
    refreshAll();
  });
  socket.on("queueLengthUpdated", async () => {
    try {
      await loadAppointments(STATE.selectedDate);
      refreshAll();
    } catch (err) {
      console.warn(
        "Failed to refresh appointments after queueLengthUpdated:",
        err.message,
      );
    }
  });
  socket.on("connect_error", (err) => {
    console.warn("Socket connection error:", err.message);
  });

  window.addEventListener("beforeunload", () => {
    if (!socket) return;
    if (DOCTOR._id) socket.emit("leaveQueue", DOCTOR._id);
    socket.off("connect");
    socket.off("queueUpdated");
    socket.off("clinicStarted");
    socket.off("clinicClosed");
    socket.off("delayUpdated");
    socket.off("queueLengthUpdated");
    socket.off("connect_error");
    socket.disconnect();
  });
}

/* ---------- INIT ---------- */
/* ---------- ACCOUNT GATING ----------
   status/isSuspended come straight off the Doctor document (see
   doctor.model.js). A doctor can log in successfully — the account
   exists and the password is correct — but still not be allowed to
   USE the dashboard yet. This runs once, right after loadAll(),
   before any view is shown, and fully replaces the page rather than
   rendering the dashboard underneath a banner: someone who isn't
   approved shouldn't be able to see live patient/queue data at all. */
function renderAccountBlocked({ title, message, tone = "warn" }) {
  const iconPath =
    tone === "danger"
      ? '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01" stroke-linecap="round"/>'
      : '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/>';
  const iconBg = tone === "danger" ? "#FDECEC" : "#FEF3E2";
  const iconColor = tone === "danger" ? "#DC2626" : "#B45309";

  document.body.innerHTML = `
    <div style="
      position:fixed;inset:0;background:#F6F7FA;
      display:flex;align-items:center;justify-content:center;
      padding:24px;font-family:'Inter',system-ui,-apple-system,sans-serif;
    ">
      <div style="
        background:#fff;border-radius:20px;max-width:440px;width:100%;
        padding:44px 40px;text-align:center;
        box-shadow:0 20px 60px rgba(16,24,43,.12);
        color:#1c2333;
      ">
        <div style="
          width:64px;height:64px;border-radius:50%;
          background:${iconBg};color:${iconColor};
          display:flex;align-items:center;justify-content:center;
          margin:0 auto 20px;
        ">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${iconPath}</svg>
        </div>
        <h2 style="font-family:'Bricolage Grotesque',sans-serif;font-size:21px;font-weight:800;margin:0 0 10px;">${title}</h2>
        <p style="color:#6b7180;font-size:14.5px;line-height:1.6;margin:0 0 28px;">${message}</p>
        <button id="blockedLogoutBtn" style="
          width:100%;border:none;border-radius:10px;background:#3d6df2;color:#fff;
          font-size:15px;font-weight:700;padding:13px;cursor:pointer;font-family:inherit;
        ">Log Out</button>
      </div>
    </div>
  `;

  document
    .getElementById("blockedLogoutBtn")
    .addEventListener("click", async () => {
      try {
        await apiPost(ENDPOINTS.logout());
      } catch (err) {
        console.warn("Logout request failed, redirecting anyway:", err.message);
      }
      window.location.href = "../../../Auth/login/login.html";
    });
}

async function init() {
  renderFAQ();
  try {
    await loadAll();
  } catch (err) {
    console.error("Failed to load dashboard:", err);
    toast(
      "Couldn't load your dashboard",
      err.status === 401 || err.status === 403
        ? "Please log in again."
        : err.message,
      true,
    );
    if (err.status === 401 || err.status === 403) {
      window.location.href = "../../../Auth/login/login.html";
      return;
    }
  }

  // Check suspension before pending/inactive — a suspended account
  // should show the suspension reason even if status also happens
  // to be something else.
  if (DOCTOR.isSuspended) {
    renderAccountBlocked({
      tone: "danger",
      title: "Your account has been suspended",
      message: DOCTOR.suspensionReason
        ? `Reason: ${DOCTOR.suspensionReason}`
        : "Please contact support for more information.",
    });
    return;
  }
  if (DOCTOR.status === "pending") {
    renderAccountBlocked({
      tone: "warn",
      title: "Your account is pending approval",
      message:
        "Your account is not yet approved by the admin. You'll be notified by email once it's approved — usually within 24 hours.",
    });
    return;
  }
  if (DOCTOR.status === "inactive") {
    renderAccountBlocked({
      tone: "danger",
      title: "Your account is inactive",
      message: "Please contact support if you believe this is a mistake.",
    });
    return;
  }

  renderNotifs();
  syncTopbarIdentity();
  const h = location.hash.replace("#", "");
  showView(TITLES[h] ? h : "overview");
  initSocket();
}
init();