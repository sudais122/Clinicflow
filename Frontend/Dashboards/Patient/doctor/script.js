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
   ============================================================ */

const CFG = window.CLINICFLOW_CONFIG || {};
const API_BASE = CFG.API_BASE || "http://localhost:8000";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ENDPOINTS = {
  dashboard: () => `${API_BASE}/dashboard/doctor`,
  doctorProfileUpdate: () => `${API_BASE}/doctor/profile`,
  queueStart: () => `${API_BASE}/queue/start`,
  queueNext: () => `${API_BASE}/queue/next`,
  queueDelay: () => `${API_BASE}/queue/delay`,
  queueTime: () => `${API_BASE}/queue/time`,
  queueEnd: () => `${API_BASE}/queue/end`,
  queueReset: () => `${API_BASE}/queue/reset`,
  queueMe: () => `${API_BASE}/queue/me`, 
  appointmentsDoctor: () => `${API_BASE}/appointments/doctor`,
  appointmentStatus: (id) =>
    `${API_BASE}${API_PREFIX}/appointments/${id}/status`,
  logout: () => `${API_BASE}${API_PREFIX}/auth/logout`,
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
  name: "",
  email: "",
  phone: "",
  spec: "",
  doctorId: "",
  clinic: "",
  address: "",
  fee: 0,
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
  notifications: [
  ],
};

/* ---------- derived helpers over live STATE.appointments ---------- */
const nameFor = (tok) =>
  STATE.appointments.find((a) => a.token === tok)?.patient || "—";
const statusFor = (tok) =>
  STATE.appointments.find((a) => a.token === tok)?.status || "waiting";
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
function formatLongDate(d) {
  return new Date(d).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
function formatShortDate(d) {
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

async function loadDashboard(dateStr) {
  const url = dateStr
    ? `${ENDPOINTS.dashboard()}?date=${encodeURIComponent(dateStr)}`
    : ENDPOINTS.dashboard();
  const res = await apiGet(url);
  const d = res.data;

  DOCTOR.doctorId = d.doctor?.doctorId || DOCTOR.doctorId;
  DOCTOR.name = d.doctor?.fullname || DOCTOR.name;
  DOCTOR.clinic = d.doctor?.clinicName || DOCTOR.clinic;
  DOCTOR.spec = d.doctor?.specialization || DOCTOR.spec;

  STATE.clinicOpen = d.clinicStatus === "open";
  STATE.nowServing = d.currentServingToken ?? STATE.nowServing;
  STATE.selectedDate = d.selectedDate;
  STATE.clinicDayLabel = formatLongDate(d.selectedDate);
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

async function loadAppointments() {
  const res = await apiGet(ENDPOINTS.appointmentsDoctor());
  const list = res.data || [];
  STATE.appointments = list
    .map((a) => ({
      id: a._id,
      appointmentId: a.appointmentId,
      token: a.tokenNumber,
      patient:
        a.patientName ||
        a.patient?.user?.fullname ||
        "Unknown patient",
      status: a.status,
      date: formatShortDate(a.appointmentDate),
      clinic: DOCTOR.clinic,
      createdAt: formatShortDate(a.createdAt),
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
  await Promise.all([loadQueueMe(), loadAppointments()]);
}

/* ---------- ROUTER ---------- */
const TITLES = {
  overview: "Overview",
  appointments: "Appointments",
  queue: "Queue",
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

  $("#overviewAppts").innerHTML = `
    <div class="aph"><div><h2>Today's Appointments</h2><div class="sub">${STATE.clinicDayLabel}</div></div><span class="count-chip">${c.total}</span></div>
    ${apptTableHTML(appts())}`;
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
        <div class="big" id="nsTok">#${STATE.nowServing}</div>
        <div class="pname">${nameFor(STATE.nowServing)}</div>
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

/* ---------- CLINIC OPEN / CLOSE ---------- */
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
  $("#qcNow").textContent = "#" + STATE.nowServing;
  $("#qcNowName").textContent = nameFor(STATE.nowServing);
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

  $("#svCur").textContent = "#" + STATE.nowServing;
  $("#svCurName").textContent = nameFor(STATE.nowServing);
  $("#svNext").textContent = nx ? "#" + nx : "—";
  $("#svNextName").textContent = nx ? nameFor(nx) : "—";
  const btn = $("#serveNextBtn");
  btn.disabled = !open || !nx;
  $("#serveNote").textContent = !open
    ? "Open the clinic to continue serving patients."
    : !nx
      ? "No more patients in the queue."
      : "Completing the current token moves the queue forward.";
  btn.onclick = serveNext;

  renderSequence($("#qcSeqList"));
}

async function serveNext() {
  if (!STATE.clinicOpen) return;
  const nx = nextWaiting(STATE.nowServing);
  if (!nx) return toast("Queue empty", "No more patients waiting.", true);

  const btn = $("#serveNextBtn");
  const prevLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Serving…";
  try {
    await apiPatch(ENDPOINTS.queueNext());
    toast("Serving next patient", `Now serving #${nx}.`);
    await loadAll(STATE.selectedDate);
    refreshAll();
  } catch (err) {
    toast("Couldn't advance the queue", err.message, true);
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
        await loadAppointments();
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
  $("#apptCount").textContent = list.length;
  $("#apptTableWrap").innerHTML = list.length
    ? apptTableHTML(list)
    : `<div class="empty-state"><h3>No appointments for this date.</h3><p>Try a different date or filter.</p></div>`;
}
function apptTableHTML(list) {
  return `<table class="appt-table"><thead><tr><th>Token</th><th>Patient</th><th>Appointment Date</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${list
      .map(
        (a) => `<tr>
      <td class="tk">#${a.token}</td><td class="pt">${a.patient}</td><td class="dt">${a.date}</td>
      <td><span class="pill ${a.status}"><span class="d"></span> ${label(a.status)}</span></td>
      <td class="act"><button class="view-btn" data-details="${a.token}">View</button></td></tr>`,
      )
      .join("")}
  </tbody></table>`;
}
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
  const d = new Date(STATE.selectedDate || Date.now());
  d.setDate(d.getDate() - 1);
  await loadAll(d.toISOString().slice(0, 10));
  refreshAll();
  toast("Previous day", "Loaded previous clinic day.");
});
$("#dateNext").addEventListener("click", async () => {
  const d = new Date(STATE.selectedDate || Date.now());
  d.setDate(d.getDate() + 1);
  await loadAll(d.toISOString().slice(0, 10));
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
      <div><div class="lk">Current token</div><div class="lv blue">#${STATE.nowServing}</div></div>
      <div><div class="lk">Patients ahead</div><div class="lv">${ahead}</div></div>
      <div><div class="lk">Estimated wait</div><div class="lv">~${ahead * STATE.perPatient + STATE.delay} min</div></div>
      <div><div class="lk">Status</div><div class="lv">${label(a.status)}</div></div>
    </div>`
    : "";
  const actions = active
    ? `
    <button class="btn btn-danger-ghost" style="width:100%;margin-top:22px" data-cancelappt="${a.id}" data-token="${tok}">Cancel Appointment</button>`
    : "";
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
    </div>${live}${actions}`;
  $("#slideover").classList.add("open");
  $("#soBackdrop").classList.add("open");
  $("#soClose").onclick = closeDetails;
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
        await loadAppointments();
        refreshAll();
      } catch (err) {
        toast("Couldn't cancel the appointment", err.message, true);
      }
    },
  });
});

/* ---------- PROFILE ---------- */
function renderProfile() {
  const d = DOCTOR;
  $("#profileCard").innerHTML = `
    <div class="pc-head"><div class="pc-avatar">${initials(d.name)}</div>
      <div><div class="pn">${d.name}</div><div class="pmeta">${d.spec} · ${d.clinic}</div></div></div>
    <div class="pc-section"><h3>Practitioner</h3></div>
    <div class="pc-grid">
      <div class="pc-box"><div class="fk">Full Name</div><div class="fv">${d.name}</div></div>
      <div class="pc-box"><div class="fk">Email</div><div class="fv">${d.email || "—"}</div></div>
      <div class="pc-box"><div class="fk">Phone</div><div class="fv">${d.phone || "—"}</div></div>
      <div class="pc-box"><div class="fk">Specialization</div><div class="fv">${d.spec}</div></div>
      <div class="pc-box readonly"><div class="fk">Doctor ID (read-only)</div><div class="fv">${d.doctorId}</div></div>
    </div>
    <div class="pc-section"><h3>Clinic</h3></div>
    <div class="pc-grid">
      <div class="pc-box"><div class="fk">Clinic Name</div><div class="fv">${d.clinic}</div></div>
      <div class="pc-box"><div class="fk">Clinic Address</div><div class="fv">${d.address || "—"}</div></div>
      <div class="pc-box"><div class="fk">Consultation Fee</div><div class="fv">${d.fee ? "PKR " + Number(d.fee).toLocaleString() : "—"}</div></div>
    </div>`;
}
$("#editProfileBtn").addEventListener("click", () => {
  const d = DOCTOR;
  openModal(`
    <div class="modal-head"><div><h2>Edit Profile</h2><div class="sub">Doctor ID cannot be changed.</div></div>
      <button class="modal-close" data-close><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button></div>
    <form id="profForm">
      <div class="field"><label>Full Name</label><input name="fullname" value="${d.name}"></div>
      <div class="field"><label>Specialization</label><input name="specialization" value="${d.spec}"></div>
      <div class="field"><label>Clinic Name</label><input name="clinicName" value="${d.clinic}"></div>
      <div class="field"><label>Clinic Address</label><input name="clinicAddress" value="${d.address}"></div>
      <div class="field"><label>Consultation Fee (PKR)</label><input name="consultationFee" type="number" value="${d.fee}"></div>
      <div class="field"><label>Doctor ID</label><input value="${d.doctorId}" disabled style="background:var(--line-soft);color:var(--muted)"></div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button type="submit" class="btn btn-primary" id="profSave">Save Changes</button></div>
    </form>`);
  $("#profForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#profSave");
    btn.disabled = true;
    btn.textContent = "Saving…";
    const fd = Object.fromEntries(new FormData(e.target));
    if (fd.consultationFee) fd.consultationFee = Number(fd.consultationFee);
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
    }
  };
});

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
$("#notifMenu").addEventListener("click", (e) => e.stopPropagation());
$("#userMenu").addEventListener("click", (e) => e.stopPropagation());
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

/* ============================================================
   SOCKET.IO — live queue push updates.
   Requires the socket.io client script to be loaded on the page
   BEFORE this file (see assumption #7 at the top).
   ============================================================ */
let socket = null;
function initSocket() {
  if (typeof io !== "function") {
    console.warn(
      "socket.io client not found — realtime updates disabled, relying on refetch-after-action instead.",
    );
    return;
  }
  socket = io(API_BASE, { withCredentials: true });

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

  window.addEventListener("beforeunload", () => {
    socket.off("queueUpdated");
    socket.off("clinicStarted");
    socket.off("clinicClosed");
    socket.off("delayUpdated");
    socket.disconnect();
  });
}

/* ---------- INIT ---------- */
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
  renderNotifs();
  const h = location.hash.replace("#", "");
  showView(TITLES[h] ? h : "overview");
  initSocket();
}
init();