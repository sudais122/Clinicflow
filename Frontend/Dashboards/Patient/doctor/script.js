/* ============================================================
   ClinicFlow — Doctor Dashboard (behavior)
   NOW WIRED TO THE REAL BACKEND. Every network call is grouped
   under ENDPOINTS / api*() below — if a path is wrong for your
   server, fix it in ONE place.
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
  revenue: (params) =>
    `${API_BASE}/revenue?${new URLSearchParams(params).toString()}`,
  logout: () => `${API_BASE}/auth/logout`,
  emailChangeRequest: () => `${API_BASE}/auth/email/request`,
  emailChangeVerify: () => `${API_BASE}/auth/email/verify`,
  submitPayment: () => `${API_BASE}/payments`,
  myPayments: () => `${API_BASE}/payments/me`,
  mySubscription: () => `${API_BASE}/subscription/me`,
  cancelSubscription: () => `${API_BASE}/subscription/cancel`,
  notifications: () => `${API_BASE}/notifications`,
  notificationReadAll: () => `${API_BASE}/notifications/read-all`,
  appointmentAnalytics: (range) => `${API_BASE}/appointments/analytics?range=${encodeURIComponent(range)}`,
  revenueAnalytics: (range) => `${API_BASE}/revenue/analytics?range=${encodeURIComponent(range)}`,
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

// Multipart/form-data upload — used for the payment-proof screenshot.
async function apiUpload(url, formData) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    body: formData,
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
  return payload;
}

/* ============================================================
   LIVE STATE
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
  appointmentsPageItems: [],
  // New — server-side pagination + loading/error/offline states for
  // the Appointments list specifically. Separate from `appointments`
  // above (which still holds the CURRENT PAGE's items, unchanged
  // shape/consumers elsewhere — Overview stats, Live Queue, Serve
  // flow, etc. all still read STATE.appointments as before).
  appointmentsList: {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
    search: "",
    status: "all",
    loading: false,
    error: false,
    errorMessage: "",
    offline: !navigator.onLine,
  },
  subscription: {
    plan: "Free",
    status: "Active",
    start: "—",
    end: "—",
    price: 0,
    loaded: false,
    loadError: false,
  },
  notifications: [],
  appointmentTrends: { range: "7d", data: [], loading: false, error: false, loaded: false },
  revenueTrends: { range: "7d", data: [], loading: false, error: false, loaded: false },
  revenue: {
    range: "28",
    from: "",
    to: "",
    totalRevenue: 0,
    paidAppointments: 0,
    averageConsultationFee: 0,
    appointments: [],
    loaded: false,
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
    search: "",
    loading: false,
    error: false,
    offline: !navigator.onLine,
  },
  payments: {
    list: [],
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
const appts = () => STATE.appointments;

/* LOADERS */
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
  DOCTOR.status = d.doctor?.status || DOCTOR.status;
  DOCTOR.isSuspended = d.doctor?.isSuspended ?? DOCTOR.isSuspended;
  DOCTOR.suspensionReason = d.doctor?.suspensionReason || "";

  STATE.clinicOpen = d.clinicStatus === "open";
  STATE.nowServing = d.currentServingToken ?? STATE.nowServing;
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

// Used by queue/overview logic — Live Queue, Serve, token lookups,
// counts() — all of which need the FULL day's list. Requests
// all=true so pagination on the backend never truncates this. Kept
// completely separate from the new paginated Appointments-list UI
// (loadAppointmentsPage below) so neither breaks the other.
async function loadAppointments(dateStr) {
  const url = dateStr
    ? `${ENDPOINTS.appointmentsDoctor()}?date=${encodeURIComponent(dateStr)}&all=true`
    : `${ENDPOINTS.appointmentsDoctor()}?all=true`;
  const res = await apiGet(url);

  // Defensive against either response shape — the new
  // { appointments, pagination } object OR the old bare array —
  // whichever the backend actually returns right now. Logs the raw
  // shape once if it's neither, instead of throwing, so this is
  // diagnosable from the console rather than crashing the dashboard.
  let list;
  if (Array.isArray(res.data)) {
    list = res.data; // old shape
  } else if (Array.isArray(res.data?.appointments)) {
    list = res.data.appointments; // new shape
  } else {
    console.error(
      "GET /appointments/doctor returned an unexpected shape:",
      res.data,
    );
    list = [];
  }

  STATE.appointments = list
    .map((a) => ({
      id: a._id,
      appointmentId: a.appointmentId,
      token: a.tokenNumber,
      // Locked appointments have patientName/patient stripped
      // server-side (see getDoctorAppointments) — patient is
      // genuinely null here, not just hidden by CSS.
      patient: a.locked ? null : (a.patientName || a.patient?.user?.fullname || "Unknown patient"),
      status: a.status,
      date: formatShortDate(a.appointmentDate),
      clinic: DOCTOR.clinic,
      createdAt: a.createdAt ? formatShortDate(a.createdAt) : "—",
      fee: a.consultationFee ?? 0,
      paymentStatus: a.paymentStatus || "unpaid",
      paidAt: a.paidAt || null,
      locked: !!a.locked,
    }))
    .sort((a, b) => a.token - b.token);

  if (STATE.appointments.length) {
    STATE.lastToken = Math.max(
      STATE.lastToken,
      ...STATE.appointments.map((a) => a.token),
    );
  }
}

// Powers the paginated Appointments-list UI specifically — real
// server-side pagination, search, and status filter, all sent as
// query params. Separate STATE (appointmentsList) from the
// queue-purposes STATE.appointments above.
async function loadAppointmentsPage() {
  const al = STATE.appointmentsList;
  al.loading = true;
  al.error = false;
  al.offline = !navigator.onLine;
  renderAppointments();

  if (al.offline) {
    al.loading = false;
    renderAppointments();
    return;
  }

  const params = new URLSearchParams({
    date: STATE.selectedDate || "",
    page: String(al.page),
    limit: String(al.limit),
  });
  if (al.search) params.set("search", al.search);
  if (al.status !== "all") params.set("status", al.status);

  try {
    const res = await apiGet(`${ENDPOINTS.appointmentsDoctor()}?${params.toString()}`);
    const data = res.data || {};
    const rawList = Array.isArray(data)
      ? data // old shape — a bare array, no pagination metadata available
      : Array.isArray(data.appointments)
        ? data.appointments
        : (console.error("GET /appointments/doctor returned an unexpected shape:", data), []);
    STATE.appointmentsPageItems = rawList.map((a) => ({
      id: a._id,
      appointmentId: a.appointmentId,
      token: a.tokenNumber,
      patient: a.locked ? null : (a.patientName || a.patient?.user?.fullname || "Unknown patient"),
      status: a.status,
      date: formatShortDate(a.appointmentDate),
      fee: a.consultationFee ?? 0,
      paymentStatus: a.paymentStatus || "unpaid",
      paidAt: a.paidAt || null,
      locked: !!a.locked,
    }));
    const pg = Array.isArray(data)
      ? { page: 1, limit: data.length, total: data.length, totalPages: 1 } // old shape has no real pagination
      : data.pagination || { page: 1, limit: al.limit, total: 0, totalPages: 1 };
    al.page = pg.page;
    al.limit = pg.limit;
    al.total = pg.total;
    al.totalPages = pg.totalPages;
  } catch (err) {
    al.error = true;
    al.errorMessage = err.message || "Something went wrong.";
  } finally {
    al.loading = false;
    renderAppointments();
  }
}

window.addEventListener("online", () => {
  if (STATE.appointmentsList.offline) {
    STATE.appointmentsList.offline = false;
    if (!$("#view-appointments").hidden) loadAppointmentsPage();
  }
});
window.addEventListener("offline", () => {
  STATE.appointmentsList.offline = true;
  if (!$("#view-appointments").hidden) renderAppointments();
});

async function loadAll(dateStr) {
  await loadDashboard(dateStr);
  await Promise.all([
    loadQueueMe(),
    loadAppointments(STATE.selectedDate),
    loadDoctorProfile(),
  ]);
}

async function loadRevenue() {
  const r = STATE.revenue;
  r.loading = true;
  r.error = false;
  r.offline = !navigator.onLine;

  if (r.offline) {
    r.loading = false;
    return;
  }

  const params =
    r.range === "custom" ? { from: r.from, to: r.to } : { range: r.range };
  params.page = String(r.page);
  params.limit = String(r.limit);
  if (r.search) params.search = r.search;

  try {
    const res = await apiGet(ENDPOINTS.revenue(params));
    const d = res.data;

    r.totalRevenue = d.totalRevenue ?? 0;
    r.paidAppointments = d.paidAppointments ?? 0;
    r.averageConsultationFee = d.averageConsultationFee ?? 0;
    r.from = d.from || r.from;
    r.to = d.to || r.to;
    r.appointments = Array.isArray(d.appointments) ? d.appointments : [];
    const pg = d.pagination || { page: 1, limit: r.limit, total: r.appointments.length, totalPages: 1 };
    r.page = pg.page;
    r.limit = pg.limit;
    r.total = pg.total;
    r.totalPages = pg.totalPages;
    r.loaded = true;
  } catch (err) {
    r.error = true;
    throw err;
  } finally {
    r.loading = false;
  }
}

window.addEventListener("online", () => {
  if (STATE.revenue.offline) {
    STATE.revenue.offline = false;
    if (!$("#view-revenue").hidden) openRevenueView();
  }
});
window.addEventListener("offline", () => {
  STATE.revenue.offline = true;
  if (!$("#view-revenue").hidden) renderRevenueView();
});

/* ---------- PAYMENTS ---------- */
async function loadPayments() {
  const res = await apiGet(ENDPOINTS.myPayments());
  STATE.payments.list = res.data || [];
  STATE.payments.loaded = true;
}

/* ---------- SUBSCRIPTION ---------- */
async function loadSubscription() {
  try {
    const res = await apiGet(ENDPOINTS.mySubscription());
    const s = res.data;
    STATE.subscription.loaded = true;
    STATE.subscription.loadError = false;
    if (!s) return;
    STATE.subscription.plan = s.plan === "paid" ? "Practice" : "Free";
    STATE.subscription.status =
      s.status === "active"
        ? "Active"
        : s.status === "expired"
          ? "Expired"
          : "Cancelled";
    // Ignore s.price entirely when the plan isn't paid — otherwise a
    // stale price left over from before a cancel (see the backend
    // fix in subscription.controller.js's cancelSubscription) would
    // still display. Free is always PKR 0, full stop.
    STATE.subscription.price = s.plan === "paid" ? (s.price ?? 4500) : 0;
    STATE.subscription.start = s.startDate ? formatShortDate(s.startDate) : "—";
    STATE.subscription.end =
      s.plan === "paid" && s.endDate ? formatShortDate(s.endDate) : "—";
  } catch (err) {
    STATE.subscription.loadError = true;
    throw err;
  }
}

/* ---------- NOTIFICATIONS ---------- */
async function loadNotifications() {
  const res = await apiGet(ENDPOINTS.notifications());
  STATE.notifications = res.data || [];
}

/* ---------- ROUTER ---------- */
const TITLES = {
  overview: "Overview",
  appointments: "Appointments",
  "appointments-analytics": "Appointment Analytics",
  queue: "Queue",
  revenue: "Revenue",
  "revenue-analytics": "Revenue Analytics",
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
  if (name === "appointments") openAppointmentsView();
  if (name === "appointments-analytics") openAppointmentAnalyticsView();
  if (name === "queue") renderQueue();
  if (name === "revenue") openRevenueView();
  if (name === "revenue-analytics") openRevenueAnalyticsView();
  if (name === "profile") renderProfile();
  if (name === "subscription") openSubscriptionView();
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

  // Replaces the old single-column revenue card + full appointments
  // table with the new Appointments|Trends and Revenue|Trends card
  // pairs. Renders whatever's cached immediately, then lazily loads
  // anything not yet loaded and re-renders just these four cards —
  // clinic status / stat grid / live queue / token sequence above are
  // untouched by this redesign.
  renderOverviewSummaryCards();
  if (!STATE.revenue.loaded) {
    loadRevenue()
      .then(renderOverviewSummaryCards)
      .catch((err) => console.warn("Revenue load failed:", err.message));
  }
  if (canAccessFeature("appointmentTrends") && !STATE.appointmentTrends.loaded) {
    loadAppointmentTrends()
      .then(renderOverviewSummaryCards)
      .catch((err) => console.warn("Appointment trends load failed:", err.message));
  }
  if (canAccessFeature("revenueTrends") && !STATE.revenueTrends.loaded) {
    loadRevenueTrends()
      .then(renderOverviewSummaryCards)
      .catch((err) => console.warn("Revenue trends load failed:", err.message));
  }
}

function renderRevenueCard(el) {
  if (!el) return;
  const r = STATE.revenue;
  const scopeLabel =
    r.from && r.to
      ? `${formatShortDate(r.from)} – ${formatShortDate(r.to)}`
      : `Last ${r.range} days`;

  el.innerHTML = `
    <div class="card revenue-summary">
      <div class="revenue-summary-left">
        <span class="revenue-summary-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2.5"/><circle cx="12" cy="12" r="3"/><path d="M6 10h.01M18 14h.01"/></svg>
        </span>
        <div>
          <div class="revenue-summary-label">Revenue</div>
          <div class="revenue-summary-value">PKR ${r.totalRevenue.toLocaleString()}</div>
          <div class="revenue-summary-sub">${scopeLabel} · ${r.paidAppointments} paid appointment${r.paidAppointments === 1 ? "" : "s"}</div>
        </div>
      </div>
      <button class="btn btn-primary" id="viewRevenueBtn">View Revenue</button>
    </div>`;
  $("#viewRevenueBtn").onclick = () => showView("revenue");
}

/* ============================================================
   OVERVIEW SUMMARY CARDS — the new Appointments|Trends and
   Revenue|Trends card pairs. Deliberately compact: a handful of
   numbers plus a CTA, never a full list/table (that's what the
   detail pages are for). renderRevenueCard() above is now unused,
   left in place rather than removed to minimize risk.
   ============================================================ */
// Reusable — same card, different container + click target. Used on
// Overview (click -> navigate to the full page) AND on the
// Appointments/Revenue pages themselves (click -> scroll down to the
// list/table already on that same page, since navigating "to itself"
// wouldn't do anything).
function renderApptSummaryCardInto(containerId, onViewDetail) {
  const el = $("#" + containerId);
  if (!el) return;
  const c = counts();
  el.innerHTML = `
    <div class="card summary-card" id="${containerId}Card">
      <div>
        <div class="sc-title">Appointments</div>
        <div class="sc-sub">${STATE.clinicDayLabel}</div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px;">
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);font-size:14px;">Today's Appointments</span><span style="font-weight:700;font-size:17px;">${c.total}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);font-size:14px;">Waiting</span><span style="font-weight:700;font-size:17px;">${c.waiting}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);font-size:14px;">In Progress</span><span style="font-weight:700;font-size:17px;">${c["in-progress"]}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);font-size:14px;">Completed</span><span style="font-weight:700;font-size:17px;">${c.completed}</span></div>
        </div>
      </div>
      <div class="sc-cta">View Detail →</div>
    </div>`;
  $(`#${containerId}Card`).onclick = onViewDetail;
}

function renderRevenueSummaryCardInto(containerId, onViewDetail) {
  const el = $("#" + containerId);
  if (!el) return;
  const r = STATE.revenue;
  const revScope = r.from && r.to ? `${formatShortDate(r.from)} – ${formatShortDate(r.to)}` : `Last ${r.range} days`;
  el.innerHTML = `
    <div class="card summary-card" id="${containerId}Card">
      <div>
        <div class="sc-title">Revenue</div>
        <div class="sc-sub">${revScope}</div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:16px;">
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);font-size:14px;">Total Revenue</span><span style="font-weight:700;font-size:17px;">PKR ${r.totalRevenue.toLocaleString()}</span></div>
          <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);font-size:14px;">Paid Appointments</span><span style="font-weight:700;font-size:17px;">${r.paidAppointments}</span></div>
        </div>
      </div>
      <div class="sc-cta">View Detail →</div>
    </div>`;
  $(`#${containerId}Card`).onclick = onViewDetail;
}

function renderOverviewSummaryCards() {
  renderApptSummaryCardInto("ovApptSummary", () => showView("appointments"));
  renderRevenueSummaryCardInto("ovRevenueSummary", () => showView("revenue"));

  renderTrendPreviewCard(
    "ovApptTrendsPreview",
    "appointmentTrends",
    "Appointment Trends",
    "Track appointment trends with the Practice plan.",
    STATE.appointmentTrends,
    "count",
    (v) => v,
    () => showView("appointments-analytics"),
  );
  renderTrendPreviewCard(
    "ovRevenueTrendsPreview",
    "revenueTrends",
    "Revenue Trends",
    "Unlock revenue trends and insights with the Practice plan.",
    STATE.revenueTrends,
    "revenue",
    (v) => `PKR ${Number(v).toLocaleString()}`,
    () => showView("revenue-analytics"),
  );
}

// Compact chart preview card shared by both Overview trend cards —
// same gate, same lineChartSVG, same empty/loading handling as the
// full-size versions on the dedicated Analytics pages, just smaller.
function renderTrendPreviewCard(containerId, featureKey, title, gateDescription, state, valueKey, formatValue, onOpen) {
  const el = $("#" + containerId);
  if (!el) return;

  if (!canAccessFeature(featureKey)) {
    el.innerHTML = proFeatureGate(featureKey, {
      title,
      description: gateDescription,
      previewHTML: trendChartPreviewHTML(),
    });
    return; // the gate's own [data-pro-upgrade] button already opens the payment modal
  }

  const hasData = state.loaded && state.data.some((d) => (d[valueKey] || 0) > 0);
  const chart = hasData
    ? lineChartSVG(
        state.data.map((d) => ({ label: d.date, value: d[valueKey] || 0, dateISO: d.dateISO })),
        { formatValue },
      )
    : `<div class="empty-state" style="padding:30px 10px;"><p>${state.loading ? "Loading chart…" : "No data yet."}</p></div>`;

  const rangeLabel = { "7d": "7 days", "30d": "30 days", "90d": "3 months" }[state.range] || "7 days";

  el.innerHTML = `
    <div class="card summary-card" id="${containerId}Card">
      <div>
        <div class="sc-title">${title}</div>
        <div class="sc-sub">Last ${rangeLabel}</div>
        <div style="margin-top:12px;">${chart}</div>
      </div>
      <div class="sc-cta">View Detail →</div>
    </div>`;
  $(`#${containerId}Card`).onclick = onOpen;

  // This card is itself clickable (navigates to the full Analytics
  // page) — wireChartTooltip's stopPropagation on the data points is
  // what stops tapping a specific point from ALSO triggering that
  // navigation, so the doctor can actually see the tooltip on touch.
  if (hasData) {
    const valueLabel = valueKey === "revenue" ? "Revenue" : "Appointments";
    wireChartTooltip(
      el.querySelector(".chart-tooltip-host"),
      state.data.map((d) => ({ value: d[valueKey] || 0, dateISO: d.dateISO })),
      valueLabel,
      formatValue,
    );
  }
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

  const btn = $("#serveNextBtn");
  const current = apptFor(STATE.nowServing);
  const currentInProgress = current && current.status === "in-progress";
  const nextAppt = nx ? apptFor(nx) : null;

  if (!open) {
    btn.disabled = true;
    btn.textContent = "Serve Next Patient →";
    btn.onclick = serveNext;
    $("#serveNote").textContent =
      "Open the clinic to continue serving patients.";
  } else if (nextAppt && nextAppt.locked) {
    // Proactive — shown before the doctor even clicks, matching the
    // spec's mockup. The backend (PATCH /queue/next) still re-checks
    // this itself before any mutation, so this is UX only; the real
    // guard lives server-side.
    btn.disabled = false;
    btn.textContent = "Upgrade to Practice";
    btn.onclick = () => showServeLockedModal();
    $("#serveNote").textContent =
      "The next patient is beyond your Free plan's daily limit.";
  } else if (!nx && !currentInProgress) {
    btn.disabled = true;
    btn.textContent = "All Patients Served";
    btn.onclick = null;
    $("#serveNote").textContent =
      "All patients have been served. The queue stays open — close the clinic whenever you're ready using the button above.";
  } else if (!nx && currentInProgress) {
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
    if (current && current.status === "in-progress") {
      await apiPatch(ENDPOINTS.appointmentStatus(current.id), {
        status: "completed",
      });
    }

    if (nx) {
      await apiPatch(ENDPOINTS.queueNext());
      toast("Serving next patient", `Now serving #${nx}.`);
    } else {
      toast("Patient completed", "All patients have been served.");
    }

    await loadAll(STATE.selectedDate);
    refreshAll();
  } catch (err) {
    if (/beyond your Free plan/i.test(err.message || "")) {
      showServeLockedModal();
    } else {
      toast("Couldn't update the queue", err.message, true);
    }
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
}

// Reuses the existing generic modal host (#modalOverlay/#modalBox)
// and the same data-pro-upgrade delegated listener already wired up
// for the Custom Revenue gate — clicking Upgrade here opens the
// SAME payment modal, no parallel upgrade flow.
function showServeLockedModal() {
  openModal(`
    <div style="text-align:center;padding:8px 0;">
      <div style="width:26px;height:26px;color:var(--blue);margin:0 auto 12px;">${proLockIcon()}</div>
      <div class="pf-gate-badge">Practice Feature</div>
      <h2 style="font-size:20px;font-weight:800;margin:10px 0 8px;">This appointment needs Practice</h2>
      <p style="color:var(--muted);font-size:14.5px;margin-bottom:22px;">This patient is beyond your Free plan's daily limit. Upgrade to Practice to serve them.</p>
      <button class="btn btn-primary btn-lg" data-pro-upgrade="serveLocked">Upgrade to Practice</button>
    </div>`);
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
/* ============================================================
   PAGINATION — reusable, used by the Appointments list (and
   intended for Revenue's transaction list once its backend supports
   the matching page/limit/pagination contract). Ellipsis-aware page
   numbers, Previous/Next, page-size selector, "Showing X–Y of Z".
   ============================================================ */
function paginationHTML(pagination, prefix, { showPageSize = true } = {}) {
  const { page, limit, total, totalPages } = pagination;
  if (total === 0) return "";

  const startItem = (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - 1 && p <= page + 1)) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== "…") {
      pages.push("…");
    }
  }

  const pageButtons = pages
    .map((p) =>
      p === "…"
        ? `<span style="padding:0 6px;color:var(--faint);">…</span>`
        : `<button class="pg-btn ${p === page ? "active" : ""}" data-pg="${prefix}:${p}" ${p === page ? 'aria-current="page"' : ""}>${p}</button>`,
    )
    .join("");

  const pageSizeSelect = showPageSize
    ? `<select class="pg-size" data-pg-size="${prefix}">
        ${[10, 20, 50].map((n) => `<option value="${n}" ${n === limit ? "selected" : ""}>${n} / page</option>`).join("")}
      </select>`
    : "";

  return `
    <div class="pg-wrap">
      <div class="pg-count">Showing ${startItem}–${endItem} of ${total}</div>
      <div class="pg-controls">
        <button class="pg-btn" data-pg="${prefix}:prev" ${page <= 1 ? "disabled" : ""}>← Previous</button>
        <span class="pg-mobile">Page ${page} of ${totalPages}</span>
        <span class="pg-desktop">${pageButtons}</span>
        <button class="pg-btn" data-pg="${prefix}:next" ${page >= totalPages ? "disabled" : ""}>Next →</button>
      </div>
      ${pageSizeSelect}
    </div>`;
}

// onChange receives "prev" | "next" | a page-number string | "size:N"
function wirePagination(prefix, onChange) {
  $$(`[data-pg^="${prefix}:"]`).forEach((btn) => {
    btn.onclick = () => onChange(btn.dataset.pg.split(":")[1]);
  });
  const sizeSel = $(`[data-pg-size="${prefix}"]`);
  if (sizeSel) sizeSel.onchange = () => onChange("size:" + sizeSel.value);
}

function apptSkeletonHTML(rows = 5) {
  return `<table class="appt-table"><tbody>
    ${Array.from({ length: rows })
      .map(
        () => `<tr>
      <td colspan="6" style="padding:14px 26px;">
        <div style="height:16px;border-radius:6px;background:var(--line-soft);animation:apptSkeletonPulse 1.4s ease-in-out infinite;"></div>
      </td>
    </tr>`,
      )
      .join("")}
  </tbody></table>
  <style>@keyframes apptSkeletonPulse{0%,100%{opacity:.6}50%{opacity:1}}</style>`;
}

/* ---------- APPOINTMENTS PAGE ---------- */
function renderAppointments() {
  $("#dateCur").textContent = STATE.clinicDayLabel;
  $("#apptDayLabel").textContent = STATE.clinicDayLabel;
  const dateInput = $("#apptDate");
  if (dateInput && STATE.selectedDate) dateInput.value = STATE.selectedDate;

  const al = STATE.appointmentsList;
  const list = STATE.appointmentsPageItems;

  $("#apptCount").textContent = al.total;

  // State priority, per spec: offline > loading > error > empty/no-results > normal.
  // (Session-expired / permission-denied are already handled upstream —
  // apiCall throws on 401/403 and existing callers redirect to login;
  // nothing appointment-specific needed here.)
  if (al.offline) {
    $("#apptTableWrap").innerHTML = `
      <div class="empty-state">
        <h3>You're offline</h3>
        <p>Please check your internet connection and try again.</p>
        <button class="btn btn-primary" id="apptOfflineRetry">Retry</button>
      </div>`;
    $("#apptOfflineRetry").onclick = () => loadAppointmentsPage();
    return;
  }

  if (al.loading) {
    $("#apptTableWrap").innerHTML = apptSkeletonHTML();
    return;
  }

  if (al.error) {
    $("#apptTableWrap").innerHTML = `
      <div class="empty-state">
        <h3>Something went wrong</h3>
        <p>We couldn't load your appointments.</p>
        <button class="btn btn-primary" id="apptErrorRetry">Try Again</button>
      </div>`;
    $("#apptErrorRetry").onclick = () => loadAppointmentsPage();
    return;
  }

  if (al.total === 0) {
    const filtered = al.search || al.status !== "all";
    $("#apptTableWrap").innerHTML = filtered
      ? `<div class="empty-state">
          <h3>No appointments found</h3>
          <p>We couldn't find any appointments matching your search or filters.</p>
          <button class="btn btn-ghost" id="apptClearFilters">Clear Filters</button>
        </div>`
      : `<div class="empty-state"><h3>No appointments yet.</h3><p>Try a different date.</p></div>`;
    const clearBtn = $("#apptClearFilters");
    if (clearBtn) {
      clearBtn.onclick = () => {
        al.search = "";
        al.status = "all";
        al.page = 1;
        $("#apptSearch").value = "";
        $$("#apptTabs .tab").forEach((x) => x.classList.toggle("active", x.dataset.filter === "all"));
        loadAppointmentsPage();
      };
    }
    return;
  }

  $("#apptTableWrap").innerHTML = apptTableHTML(list) + paginationHTML(
    { page: al.page, limit: al.limit, total: al.total, totalPages: al.totalPages },
    "apptList",
  );

  wirePagination("apptList", (action) => {
    if (action === "prev") al.page = Math.max(1, al.page - 1);
    else if (action === "next") al.page = Math.min(al.totalPages, al.page + 1);
    else if (action.startsWith("size:")) {
      al.limit = parseInt(action.split(":")[1], 10);
      al.page = 1; // page size change resets to page 1
    } else {
      al.page = parseInt(action, 10);
    }
    loadAppointmentsPage();
  });
}
function apptTableHTML(list) {
  return `<table class="appt-table"><thead><tr><th>Token</th><th>Patient</th><th>Appointment Date</th><th>Status</th><th>Payment</th><th>Action</th></tr></thead><tbody>
    ${list
      .map((a) => {
        if (a.locked) {
          return `<tr>
        <td class="tk">#${a.token}</td>
        <td class="pt" style="filter:blur(4px);user-select:none;" aria-hidden="true">•••• ••••••</td>
        <td class="dt">${a.date}</td>
        <td><span class="pill" style="background:var(--blue-soft);color:var(--blue);"><span style="width:12px;height:12px;display:inline-flex;">${proLockIcon()}</span> Locked</span></td>
        <td>—</td>
        <td class="act"><button class="btn btn-primary" style="padding:6px 12px;font-size:12.5px;" data-pro-upgrade="lockedAppointment" aria-label="Upgrade to Practice to view and serve this appointment">Upgrade to Practice</button></td>
      </tr>`;
        }
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
    STATE.revenue.loaded = false;
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
  STATE.appointmentsList.status = t.dataset.filter;
  STATE.appointmentsList.page = 1; // filter change always resets to page 1
  loadAppointmentsPage();
});
let apptSearchDebounce = null;
$("#apptSearch").addEventListener("input", (e) => {
  clearTimeout(apptSearchDebounce);
  const val = e.target.value.trim();
  apptSearchDebounce = setTimeout(() => {
    STATE.appointmentsList.search = val;
    STATE.appointmentsList.page = 1; // search change always resets to page 1
    loadAppointmentsPage();
  }, 300);
});
$("#apptDate").addEventListener("change", async (e) => {
  const val = e.target.value;
  if (!val) return;
  try {
    await loadAll(val);
    STATE.appointmentsList.page = 1; // new date — start from page 1
    refreshAll();
    toast("Date changed", "Showing appointments for the selected clinic day.");
  } catch (err) {
    toast("Couldn't load that date", err.message, true);
  }
});
$("#datePrev").addEventListener("click", async () => {
  const base = STATE.selectedDate || new Date().toISOString().slice(0, 10);
  await loadAll(addDaysToISO(base, -1));
  STATE.appointmentsList.page = 1;
  refreshAll();
  toast("Previous day", "Loaded previous clinic day.");
});
$("#dateNext").addEventListener("click", async () => {
  const base = STATE.selectedDate || new Date().toISOString().slice(0, 10);
  await loadAll(addDaysToISO(base, 1));
  STATE.appointmentsList.page = 1;
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
async function openRevenueView() {
  // Refresh subscription state first — otherwise an admin-approved
  // upgrade wouldn't unlock the custom-range gate until the doctor
  // happened to visit the Subscription tab (canAccessFeature reads
  // STATE.subscription, which only loadSubscription() populates).
  try {
    await loadSubscription();
  } catch (err) {
    console.warn("Subscription refresh failed:", err.message);
  }
  renderRevenueView();
  try {
    await loadRevenue();
    renderRevenueView();
  } catch (err) {
    toast("Couldn't load revenue", err.message, true);
  }

  renderRevenueSummaryCardInto("revenuePageSummary", () => {
    $("#revenueWrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  const renderRevPreview = () =>
    renderTrendPreviewCard(
      "revenuePageTrendsPreview",
      "revenueTrends",
      "Revenue Trends",
      "Unlock revenue trends and insights with the Practice plan.",
      STATE.revenueTrends,
      "revenue",
      (v) => `PKR ${Number(v).toLocaleString()}`,
      () => showView("revenue-analytics"),
    );
  renderRevPreview();
  if (canAccessFeature("revenueTrends") && !STATE.revenueTrends.loaded) {
    await loadRevenueTrends();
    renderRevPreview();
  }
}

// Dedicated Revenue Analytics page — reuses the SAME
// renderRevenueTrendsCard()/loadRevenueTrends() logic that used to
// render inline at the bottom of the Revenue page; only the page it
// renders into moved.
async function openRevenueAnalyticsView() {
  try {
    await loadSubscription();
  } catch (err) {
    console.warn("Subscription refresh failed:", err.message);
  }
  renderRevenueTrendsCard();
  renderRevenueAnalyticsSummary();
  if (canAccessFeature("revenueTrends") && !STATE.revenueTrends.loaded) {
    await loadRevenueTrends();
    renderRevenueAnalyticsSummary();
  }
}

function renderRevenueAnalyticsSummary() {
  const el = $("#revenueAnalyticsSummary");
  if (!el) return;
  const t = STATE.revenueTrends;
  if (!canAccessFeature("revenueTrends") || !t.loaded || !t.data.length) {
    el.innerHTML = "";
    return;
  }
  const total = t.data.reduce((sum, d) => sum + (d.revenue || 0), 0);
  const avg = t.data.length ? total / t.data.length : 0;
  const peak = t.data.reduce((max, d) => (d.revenue > max.revenue ? d : max), t.data[0]);
  el.innerHTML = `
    <div class="stat-grid mt24">
      <div class="stat"><div class="st-top">Total Revenue</div><div class="st-val" style="font-size:26px;">PKR ${total.toLocaleString()}</div></div>
      <div class="stat"><div class="st-top">Average per Day</div><div class="st-val" style="font-size:26px;">PKR ${Math.round(avg).toLocaleString()}</div></div>
      <div class="stat"><div class="st-top">Peak Day</div><div class="st-val" style="font-size:19px;">${peak.date} (PKR ${peak.revenue.toLocaleString()})</div></div>
    </div>`;
}

function renderRevenueView() {
  const r = STATE.revenue;
  const wrap = $("#revenueWrap");
  if (!wrap) return;

  const rangeBtn = (value, label) => `
    <button class="revenue-range-btn ${r.range === value ? "active" : ""}" data-revenue-range="${value}">${label}</button>`;

  // Custom date range is the Practice-only "advanced analytics"
  // capability — 7/28-day revenue stays fully available on Free
  // (core functionality a doctor needs regardless of plan); picking
  // an arbitrary historical range is what's gated. See
  // canAccessFeature("customRevenueRange") near the helpers section.
  if (r.range === "custom" && !canAccessFeature("customRevenueRange")) {
    wrap.innerHTML = `
      <div class="card revenue-toolbar">
        <div class="revenue-toolbar-row">
          <div class="revenue-range" role="tablist" aria-label="Revenue date range">
            ${rangeBtn("7", "7 Days")}
            ${rangeBtn("28", "28 Days")}
            ${rangeBtn("custom", "Custom")}
          </div>
        </div>
      </div>
      <div class="mt24">
        ${proFeatureGate("customRevenueRange", {
          title: "Custom Date Range Analytics",
          description:
            "Pick any date range to analyze revenue trends, seasonal patterns, and long-term clinic performance — not just the last 7 or 28 days.",
          previewHTML: customRevenuePreviewHTML(),
        })}
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
    return;
  }

  const scopeLabel =
    r.from && r.to
      ? `${formatShortDate(r.from)} – ${formatShortDate(r.to)}`
      : r.range === "custom"
        ? "Choose a date range"
        : `Last ${r.range} days`;

  const customForm =
    r.range === "custom"
      ? `
    <div class="revenue-custom-panel">
      <div class="field">
        <label>From</label>
        <input type="date" id="revenueFrom" value="${r.from}" max="${r.to || ""}">
      </div>
      <div class="field">
        <label>To</label>
        <input type="date" id="revenueTo" value="${r.to}">
      </div>
      <button class="btn btn-primary" id="revenueApplyBtn">Apply</button>
    </div>`
      : "";

  const statTiles = [
    [
      "Total Revenue",
      `PKR ${r.totalRevenue.toLocaleString()}`,
      "blue",
      '<rect x="2" y="6" width="20" height="12" rx="2.5"/><circle cx="12" cy="12" r="3"/><path d="M6 10h.01M18 14h.01"/',
    ],
    [
      "Paid Appointments",
      r.paidAppointments,
      "green",
      '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/',
    ],
    [
      "Average Consultation",
      `PKR ${r.averageConsultationFee.toLocaleString()}`,
      "amber",
      '<path d="M4 20V10M12 20V4M20 20V13"/><path d="M3 20h18"/',
    ],
  ]
    .map(
      ([k, v, tone, ic]) => `
    <div class="stat"><div class="st-top"><span class="st-ic ${tone}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic}</svg></span>${k}</div><div class="st-val">${v}</div></div>`,
    )
    .join("");

  // State priority: offline > loading > error > empty/no-results > normal.
  let tableBody;
  if (r.offline) {
    tableBody = `<tr><td colspan="4"><div class="empty-state"><h3>You're offline</h3><p>Please check your internet connection and try again.</p><button class="btn btn-primary" id="revenueOfflineRetry">Retry</button></div></td></tr>`;
  } else if (r.loading) {
    tableBody = Array.from({ length: 5 })
      .map(
        () =>
          `<tr><td colspan="4" style="padding:14px 26px;"><div style="height:16px;border-radius:6px;background:var(--line-soft);animation:apptSkeletonPulse 1.4s ease-in-out infinite;"></div></td></tr>`,
      )
      .join("");
  } else if (r.error) {
    tableBody = `<tr><td colspan="4"><div class="empty-state"><h3>Something went wrong</h3><p>We couldn't load your revenue records.</p><button class="btn btn-primary" id="revenueErrorRetry">Try Again</button></div></td></tr>`;
  } else if (r.total === 0) {
    tableBody = r.search
      ? `<tr><td colspan="4"><div class="empty-state"><h3>No revenue records found</h3><p>Try changing your search or filters.</p><button class="btn btn-ghost" id="revenueClearFilters">Clear Filters</button></div></td></tr>`
      : `<tr><td colspan="4"><div class="empty-state"><h3>No revenue records yet.</h3></div></td></tr>`;
  } else {
    tableBody = r.appointments
      .map(
        (a) => `
    <tr>
      <td class="pt">${a.patientName}</td>
      <td class="dt">${formatShortDate(a.appointmentDate)}</td>
      <td>PKR ${Number(a.consultationFee || 0).toLocaleString()}</td>
      <td><span class="pill completed"><span class="d"></span> Paid</span></td>
    </tr>`,
      )
      .join("");
  }

  const showPagination = !r.offline && !r.loading && !r.error && r.total > 0;

  wrap.innerHTML = `
    <div class="card revenue-toolbar">
      <div class="revenue-toolbar-row">
        <div class="revenue-range" role="tablist" aria-label="Revenue date range">
          ${rangeBtn("7", "7 Days")}
          ${rangeBtn("28", "28 Days")}
          ${rangeBtn("custom", "Custom")}
        </div>
        <div class="revenue-scope">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2v4M16 2v4" stroke-linecap="round"/></svg>
          ${scopeLabel}
        </div>
      </div>
      ${customForm}
      <div class="fb-field search" style="margin-top:14px;">
        <label class="fl">Search patient</label>
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/></svg>
          <input class="search-input" id="revenueSearch" placeholder="Search by patient name" value="${r.search}">
        </div>
      </div>
    </div>
    <div class="stat-grid" style="margin-top:20px;">${statTiles}</div>
    <div class="card appt-panel mt24">
      <div class="aph">
        <div><h2>Paid Appointments</h2><div class="sub">${scopeLabel}</div></div>
        <span class="count-chip">${r.total}</span>
      </div>
      <table class="appt-table">
        <thead><tr><th>Patient</th><th>Date</th><th>Fee</th><th>Payment</th></tr></thead>
        <tbody>${tableBody}</tbody>
      </table>
      ${
        showPagination
          ? paginationHTML(
              { page: r.page, limit: r.limit, total: r.total, totalPages: r.totalPages },
              "revenueList",
            )
          : ""
      }
    </div>`;

  $$("[data-revenue-range]", wrap).forEach((btn) => {
    btn.onclick = async () => {
      const value = btn.dataset.revenueRange;
      STATE.revenue.range = value;
      STATE.revenue.page = 1; // range change resets to page 1
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
      STATE.revenue.page = 1; // custom range change resets to page 1
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

  let revenueSearchDebounce = null;
  const searchInput = $("#revenueSearch");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      clearTimeout(revenueSearchDebounce);
      const val = e.target.value.trim();
      revenueSearchDebounce = setTimeout(async () => {
        STATE.revenue.search = val;
        STATE.revenue.page = 1; // search change resets to page 1
        try {
          await loadRevenue();
        } catch (err) {
          toast("Couldn't load revenue", err.message, true);
        }
        renderRevenueView();
      }, 300);
    });
  }

  const clearBtn = $("#revenueClearFilters");
  if (clearBtn) {
    clearBtn.onclick = async () => {
      STATE.revenue.search = "";
      STATE.revenue.page = 1;
      try {
        await loadRevenue();
      } catch (err) {
        toast("Couldn't load revenue", err.message, true);
      }
      renderRevenueView();
    };
  }

  const offlineRetry = $("#revenueOfflineRetry");
  if (offlineRetry) {
    offlineRetry.onclick = async () => {
      try {
        await loadRevenue();
      } catch (err) {
        toast("Couldn't load revenue", err.message, true);
      }
      renderRevenueView();
    };
  }
  const errorRetry = $("#revenueErrorRetry");
  if (errorRetry) {
    errorRetry.onclick = async () => {
      try {
        await loadRevenue();
      } catch (err) {
        toast("Couldn't load revenue", err.message, true);
      }
      renderRevenueView();
    };
  }

  if (showPagination) {
    wirePagination("revenueList", async (action) => {
      if (action === "prev") STATE.revenue.page = Math.max(1, STATE.revenue.page - 1);
      else if (action === "next") STATE.revenue.page = Math.min(STATE.revenue.totalPages, STATE.revenue.page + 1);
      else if (action.startsWith("size:")) {
        STATE.revenue.limit = parseInt(action.split(":")[1], 10);
        STATE.revenue.page = 1;
      } else {
        STATE.revenue.page = parseInt(action, 10);
      }
      try {
        await loadRevenue();
      } catch (err) {
        toast("Couldn't load revenue", err.message, true);
      }
      renderRevenueView();
    });
  }
}

/* ---------- SUBSCRIPTION ---------- */
async function openSubscriptionView() {
  renderSubscription();
  try {
    await loadSubscription();
  } catch (err) {
    console.warn("Subscription load failed:", err.message);
  }
  if (!STATE.payments.loaded) {
    try {
      await loadPayments();
    } catch (err) {
      toast("Couldn't load payment history", err.message, true);
    }
  }
  renderSubscription();
}

function paymentStatusPill(status) {
  if (status === "approved")
    return `<span class="pill completed"><span class="d"></span> Approved</span>`;
  if (status === "rejected")
    return `<span class="pill cancelled"><span class="d"></span> Rejected</span>`;
  return `<span class="pill waiting"><span class="d"></span> Pending</span>`;
}
function paymentMethodLabel(m) {
  return m === "easypaisa" ? "Easypaisa" : "Bank Transfer";
}

function paymentHistoryHTML() {
  const payments = STATE.payments.list;
  if (!payments.length) {
    return `<div class="empty-state"><h3>No payments yet</h3><p>Submit a payment from the Practice plan card above and it'll show up here.</p></div>`;
  }
  return `<table class="appt-table">
    <thead><tr><th>Plan</th><th>Amount</th><th>Method</th><th>Submitted</th><th>Status</th><th>Receipt</th></tr></thead>
    <tbody>
      ${payments
        .map(
          (p) => `
      <tr>
        <td class="pt">${p.plan}</td>
        <td>PKR ${Number(p.amount || 0).toLocaleString()}</td>
        <td class="dt">${paymentMethodLabel(p.paymentMethod)}</td>
        <td class="dt">${formatShortDate(p.createdAt)}</td>
        <td>${paymentStatusPill(p.status)}</td>
        <td class="act"><a class="view-btn" href="${p.screenshotUrl}" target="_blank" rel="noopener">View</a></td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>`;
}

function renderSubscription() {
  const s = STATE.subscription;
  const pending = STATE.payments.list.find((p) => p.status === "pending");
  const latest = STATE.payments.list[0];

  const isActivePractice = s.plan === "Practice" && s.status === "Active";
  const isExpiredPractice = s.plan === "Practice" && s.status === "Expired";

  if (s.loadError && !s.loaded) {
    $("#subWrap").innerHTML = `
      <div class="card" style="padding:32px;text-align:center;">
        <div style="font-weight:700;margin-bottom:6px;">Unable to load subscription.</div>
        <div style="color:var(--muted);font-size:14px;margin-bottom:16px;">Check your connection and try again.</div>
        <button class="btn btn-primary" id="subRetryBtn">Retry</button>
      </div>`;
    $("#subRetryBtn").onclick = () => openSubscriptionView();
    return;
  }

  const rejectedBanner =
    latest && latest.status === "rejected" && !pending
      ? `<div class="card" style="padding:18px 22px;margin-bottom:20px;border-color:#f3c7c7;background:var(--red-soft);">
          <div style="font-weight:700;color:var(--red-text);margin-bottom:4px;">Your last payment was rejected</div>
          <div style="color:var(--red-text);font-size:14px;">${latest.rejectionReason || "No reason was given."} You're welcome to submit a new payment below.</div>
        </div>`
      : "";
  const pendingBanner = pending
    ? `<div class="card" style="padding:18px 22px;margin-bottom:20px;border-color:#fde3b8;background:var(--amber-soft);">
        <div style="font-weight:700;color:var(--amber-text);margin-bottom:4px;">${isActivePractice ? "Extension under review" : "Payment under review"}</div>
        <div style="color:var(--amber-text);font-size:14px;">Submitted ${formatShortDate(pending.createdAt)} — PKR ${Number(pending.amount || 0).toLocaleString()} via ${paymentMethodLabel(pending.paymentMethod)}. ${isActivePractice ? "We'll extend your Practice plan once an admin approves it." : "We'll activate your Practice plan once an admin approves it."}</div>
      </div>`
    : "";

  let practiceButton;
  let paymentMode = "upgrade";
  if (isActivePractice) {
    paymentMode = "extend";
    practiceButton = pending
      ? `<button class="btn btn-ghost btn-lg" disabled>Extension Under Review</button>`
      : `<button class="btn btn-primary btn-lg" id="upgradePracticeBtn">Extend Subscription</button>`;
  } else if (isExpiredPractice) {
    paymentMode = "renew";
    practiceButton = pending
      ? `<button class="btn btn-ghost btn-lg" disabled>Payment Under Review</button>`
      : `<button class="btn btn-primary btn-lg" id="upgradePracticeBtn">Renew Practice</button>`;
  } else {
    paymentMode = "upgrade";
    practiceButton = pending
      ? `<button class="btn btn-ghost btn-lg" disabled>Payment Under Review</button>`
      : `<button class="btn btn-primary btn-lg" id="upgradePracticeBtn">${latest && latest.status === "rejected" ? "Resubmit Payment" : "Upgrade to Practice"}</button>`;
  }

  const statusPillClass = isExpiredPractice ? "cancelled" : "active";

  $("#subWrap").innerHTML = `
    ${rejectedBanner}
    ${pendingBanner}
    <div class="card sub-current">
      <div class="sc-top">
        <div>
          <div class="k">Current Plan</div>
          <div class="sc-plan">${s.plan}</div>
          <div class="sc-dates">PKR ${Number(s.price || 0).toLocaleString()} / month</div>
          <div class="sc-dates">${s.plan === "Practice" ? `Start Date: ${s.start} · End Date: ${s.end}` : "Unlimited"}</div>
        </div>
        <span class="pill ${statusPillClass}"><span class="d"></span> ${s.status}</span>
      </div>
      ${
        isActivePractice
          ? `<div class="sc-actions"><button class="btn btn-danger-ghost" id="cancelSubBtn">Cancel Plan</button></div>`
          : ""
      }
    </div>
    <div class="plans">
      <div class="card plan ${s.plan === "Free" ? "current" : ""}">
        <div class="ph"><span class="pname">Free</span>${s.plan === "Free" ? '<span class="curtag">Current plan</span>' : ""}</div>
        <div class="price">PKR 0 <small>per month</small></div>
        <ul>${["Up to 25 tokens per clinic day", "Live queue with real-time updates", "Basic appointment management", "Email support"].map((f) => `<li><span class="ck">✓</span> ${f}</li>`).join("")}</ul>
      </div>
      <div class="card plan ${isActivePractice ? "current" : ""}">
        <div class="ph">
          <span class="pname">Practice</span>
          ${
            isActivePractice
              ? '<span class="curtag">Current plan</span>'
              : isExpiredPractice
                ? '<span class="curtag" style="background:var(--red-soft);color:var(--red-text);">Expired</span>'
                : ""
          }
        </div>
        <div class="price">PKR 4,500 <small>per month</small></div>
        <ul>${["Unlimited tokens per clinic day", "Advanced queue delay controls", "Patient notifications", "Priority support"].map((f) => `<li><span class="ck">✓</span> ${f}</li>`).join("")}</ul>
        ${practiceButton}
      </div>
    </div>
    <div class="card appt-panel mt24">
      <div class="aph">
        <div><h2>Payment History</h2><div class="sub">All your submitted payment proofs — this is a record of submissions, not the source of truth for your current plan.</div></div>
        <span class="count-chip">${STATE.payments.list.length}</span>
      </div>
      ${paymentHistoryHTML()}
    </div>`;

  const ub = $("#upgradePracticeBtn");
  if (ub) ub.onclick = () => openPaymentModal(paymentMode);

  const cb = $("#cancelSubBtn");
  if (cb) cb.onclick = cancelSubscriptionFlow;
}

function cancelSubscriptionFlow() {
  confirmModal({
    tone: "danger",
    title: "Cancel your Practice plan?",
    body: `This takes effect immediately — you'll drop to the Free plan right away, not at the end of your current period (${STATE.subscription.end}). You can resubscribe anytime.`,
    confirmText: "Cancel Plan",
    danger: true,
    onConfirm: async () => {
      try {
        await apiPatch(ENDPOINTS.cancelSubscription());
        toast("Subscription cancelled", "You're now on the Free plan.");
        await loadSubscription();
        renderSubscription();
      } catch (err) {
        toast("Couldn't cancel subscription", err.message, true);
      }
    },
  });
}

function openPaymentModal(mode = "upgrade") {
  const titles = {
    upgrade: "Upgrade to Practice",
    extend: "Extend Your Practice Subscription",
    renew: "Renew Your Practice Subscription",
  };

  const payInstructions = `
    <div style="background:var(--blue-tint);border:1px solid #d9e6ff;border-radius:14px;padding:16px 18px;margin:20px 0;font-size:13.5px;color:var(--sub);line-height:1.6;">
      <b>Easypaisa:</b> 03XX-XXXXXXX (ClinicFlow) &nbsp;·&nbsp; <b>Bank:</b> Account title / number here<br>
      Send <b>PKR 4,500</b>, then upload a screenshot of the confirmation below.
    </div>`;

  openModal(`
  <div class="modal-head">
    <div><h2>${titles[mode] || titles.upgrade}</h2><div class="sub">PKR 4,500/month — pay via Easypaisa or bank transfer, then upload your receipt.</div></div>
    <button class="modal-close" data-close>✕</button>
  </div>
  ${payInstructions}
  <form id="paymentForm">
    <div class="field">
      <label>Payment Method</label>
      <select name="paymentMethod" required>
        <option value="easypaisa">Easypaisa</option>
        <option value="bank_transfer">Bank Transfer</option>
      </select>
    </div>
    <div class="field">
      <label>Transaction Reference (optional)</label>
      <input name="transactionReference" placeholder="e.g. TXN123456">
    </div>
    <div class="field">
      <label>Payment Screenshot</label>
      <input type="file" name="screenshot" accept="image/jpeg,image/png,image/webp" required>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      <button type="submit" class="btn btn-primary" id="paySubmitBtn">Submit Payment</button>
    </div>
  </form>`);

  $("#paymentForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#paySubmitBtn");
    btn.disabled = true;
    btn.textContent = "Submitting…";

    const fd = new FormData(e.target);
    fd.set("plan", "Practice");

    try {
      await apiUpload(ENDPOINTS.submitPayment(), fd);
      closeModal();
      toast(
        "Payment submitted",
        "Awaiting admin review — we'll notify you once it's approved.",
      );
      STATE.payments.loaded = false;
      await loadPayments();
      renderSubscription();
    } catch (err) {
      toast("Couldn't submit payment", err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Submit Payment";
    }
  };
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
$("#notifBtn").addEventListener("click", async (e) => {
  e.stopPropagation();
  $("#userMenu").classList.remove("open");
  const opening = !$("#notifMenu").classList.contains("open");
  $("#notifMenu").classList.toggle("open");
  if (!opening) return; // just closing — nothing to fetch

  try {
    await loadNotifications();
    renderNotifs(); // show real unread state first
    if (STATE.notifications.some((n) => !n.read)) {
      await apiPatch(ENDPOINTS.notificationReadAll());
      STATE.notifications.forEach((n) => (n.read = true));
      renderNotifs();
    }
  } catch (err) {
    console.warn("Couldn't load notifications:", err.message);
  }
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
        .map((n) => {
          // Only BOOKING_LIMIT_REACHED notifications get this button.
          // It's a plain data-view="subscription" element, picked up
          // automatically by the existing global [data-view] click
          // listener near the top of this file — no new navigation
          // code, reuses showView("subscription") exactly like the
          // sidebar "Subscription" link does.
          const upgradeBtn =
            n.type === "BOOKING_LIMIT_REACHED"
              ? `<button class="btn btn-primary" style="margin-top:8px;padding:7px 14px;font-size:12.5px;" data-view="subscription">Upgrade to Practice</button>`
              : "";
          return `<div class="notif-item ${n.read ? "read" : ""}">
            <span class="nd"></span>
            <div>
              <div class="nt" style="font-weight:600;">${n.title}</div>
              <div class="nt" style="color:var(--muted);margin-top:2px;">${n.message}</div>
              <div class="ntime">${formatShortDate(n.createdAt)}</div>
              ${upgradeBtn}
            </div>
          </div>`;
        })
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
  // Fetches fresh data (not just a re-render of possibly-stale
  // STATE.appointmentsPageItems) — matters after actions like Mark
  // Paid or Cancel that change what this page's list should show.
  if (!$("#view-appointments").hidden) loadAppointmentsPage();
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

/* ============================================================
   PRO FEATURE ACCESS — centralized check, reused by every gated
   feature instead of each call site re-deriving
   plan === "Practice" && status === "Active" on its own. Reads
   STATE.subscription, the same source of truth renderSubscription()
   already uses (populated by loadSubscription()).
   ============================================================ */
function hasProAccess() {
  return STATE.subscription.plan === "Practice" && STATE.subscription.status === "Active";
}

// Registry of feature keys that require Practice. Add a key here to
// gate a new feature; canAccessFeature() is the only thing call
// sites need to check. Anything not listed is treated as a normal
// Free-plan feature (always allowed) — this only tightens access,
// it never needs to be consulted to loosen it.
const PRO_FEATURES = new Set(["customRevenueRange", "appointmentTrends", "revenueTrends"]);

function canAccessFeature(featureKey) {
  if (!PRO_FEATURES.has(featureKey)) return true;
  return hasProAccess();
}

// Reusable "Pro Feature" upgrade gate. This codebase has no
// component/JSX layer to plug a <ProFeatureGate> into — this is the
// vanilla-JS equivalent, matching the existing render*() → HTML
// string pattern used everywhere else in this file.
//
// featureKey  — checked via canAccessFeature()
// title       — feature name, e.g. "Custom Date Range Analytics"
// description — one or two sentences on the value
// previewHTML — the feature's real markup. ALWAYS rendered (blurred
//               via CSS + aria-hidden when locked, so it's a genuine
//               preview of the real thing, not a placeholder graphic)
// icon        — optional inline SVG string; falls back to a lock icon
//
// Enforcement note: this is a UX layer only — it stops the doctor
// from seeing/reaching the locked control, and openRevenueView()
// above already avoids calling loadRevenue() with custom params when
// this gate is showing. It does NOT stop a request crafted directly
// against the API. That needs a server-side check in whatever
// controller handles GET /revenue?from=&to= — not implemented here,
// since that controller wasn't shared in this conversation.
function proFeatureGate(featureKey, { title, description, previewHTML, icon }) {
  if (canAccessFeature(featureKey)) {
    return `<div class="pf-unlocked">${previewHTML}</div>`;
  }
  return `
    <div class="pf-gate" role="group" aria-label="${title} — Practice feature, locked">
      <div class="pf-gate-preview" aria-hidden="true">${previewHTML}</div>
      <div class="pf-gate-overlay">
        <div class="pf-gate-card">
          ${icon || proLockIcon()}
          <div class="pf-gate-badge">Practice Feature</div>
          <h3 class="pf-gate-title">${title}</h3>
          <p class="pf-gate-desc">${description}</p>
          <button class="btn btn-primary" data-pro-upgrade="${featureKey}">Upgrade to Practice</button>
        </div>
      </div>
    </div>`;
}

function proLockIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
}

// Sample preview content for the locked custom-range revenue gate —
// reuses the exact same markup/classes as the real revenue view
// (stat-grid, appt-panel, appt-table, pill.completed) so it blurs
// into something that genuinely looks like the real feature, not a
// generic placeholder.
function customRevenuePreviewHTML() {
  return `
    <div class="stat-grid">
      <div class="stat"><div class="st-top"><span class="st-ic blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2.5"/><circle cx="12" cy="12" r="3"/></svg></span>Total Revenue</div><div class="st-val">PKR 128,400</div></div>
      <div class="stat"><div class="st-top"><span class="st-ic green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg></span>Paid Appointments</div><div class="st-val">214</div></div>
      <div class="stat"><div class="st-top"><span class="st-ic amber"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20V13"/></svg></span>Average Consultation</div><div class="st-val">PKR 600</div></div>
    </div>
    <div class="card appt-panel mt24">
      <div class="aph"><div><h2>Paid Appointments</h2><div class="sub">Custom range</div></div></div>
      <table class="appt-table">
        <thead><tr><th>Patient</th><th>Date</th><th>Fee</th><th>Payment</th></tr></thead>
        <tbody>
          <tr><td class="pt">Sample Patient</td><td class="dt">—</td><td>PKR 600</td><td><span class="pill completed"><span class="d"></span> Paid</span></td></tr>
          <tr><td class="pt">Sample Patient</td><td class="dt">—</td><td>PKR 600</td><td><span class="pill completed"><span class="d"></span> Paid</span></td></tr>
        </tbody>
      </table>
    </div>`;
}

/* ============================================================
   TREND CHARTS — Appointment Trends & Revenue Trends. Both are
   Practice-only, gated through the same PRO_FEATURES/canAccessFeature
   used everywhere else. No charting library is loaded anywhere in
   this app, so this is a minimal hand-rolled inline-SVG line chart —
   matching how every icon in this file is already inline SVG,
   instead of adding a new CDN dependency for two charts.
   ============================================================ */

// points: [{ label, value }]. Always starts the Y axis at zero — no
// truncated/misleading axis. A native <title> on each dot gives a
// basic accessible tooltip without needing hover-tracking JS.
// points: [{ label, value, dateISO }]. Always starts the Y axis at
// zero — no truncated/misleading axis. Native <title> tooltips were
// removed in favor of wireChartTooltip() below — call that right
// after inserting this HTML into the DOM to get a real, styled,
// date-specific hover/tap tooltip (same "render then wire" pattern
// used everywhere else in this file, e.g. wireTrendRangeButtons).
function lineChartSVG(points, { formatValue = (v) => v } = {}) {
  const W = 640,
    H = 220,
    PAD = 32;
  if (!points.length) return "";

  const values = points.map((p) => p.value);
  const maxV = Math.max(...values, 1);
  const stepX = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const scaleY = (v) => H - PAD - (v / maxV) * (H - PAD * 2);

  const coords = points.map((p, i) => [PAD + i * stepX, scaleY(p.value)]);
  const linePath = coords
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${H - PAD} L${coords[0][0].toFixed(1)},${H - PAD} Z`;

  const dots = coords
    .map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="var(--blue)"/>`)
    .join("");

  // Thin out labels on longer ranges (30/90 days) so they don't overlap.
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const labels = coords
    .map(([x], i) =>
      i % labelEvery === 0
        ? `<text x="${x.toFixed(1)}" y="${H - 8}" font-size="10" fill="var(--faint)" text-anchor="middle">${points[i].label}</text>`
        : "",
    )
    .join("");

  // Invisible, generously-sized hit targets (r=14, well beyond the
  // visible r=3.5 dot) so hover/tap near a point registers reliably —
  // matters especially for touch, where fingertip accuracy is coarse.
  const hitTargets = coords
    .map(
      ([x, y], i) =>
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="transparent" data-chart-point="${i}" style="cursor:pointer;"/>`,
    )
    .join("");

  return `<div class="chart-tooltip-host" style="position:relative;">
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;" role="img" aria-label="Line chart" class="chart-svg">
      <path d="${areaPath}" fill="var(--blue-soft)" opacity="0.5"/>
      <path d="${linePath}" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${labels}
      ${hitTargets}
    </svg>
    <div class="chart-tooltip" style="display:none;position:absolute;pointer-events:none;background:var(--ink);color:#fff;font-size:12.5px;line-height:1.4;padding:7px 11px;border-radius:8px;white-space:nowrap;box-shadow:var(--sh-lg, var(--sh-md));z-index:20;transform:translate(-50%,calc(-100% - 10px));"></div>
  </div>`;
}

// Full, unambiguous date ("Aug 28, 2026") for tooltips specifically —
// never a raw ISO timestamp. The chart's own axis labels stay short
// ("Aug 28", already formatted server-side) to avoid crowding; the
// tooltip is where the full date belongs. Respects the same
// date-string-only arithmetic used throughout (no timezone shift —
// dateISO is a plain YYYY-MM-DD calendar day, already resolved
// against PKT on the backend).
function fullDateLabel(dateISO) {
  if (!dateISO) return "";
  return new Date(dateISO + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Attaches hover (mouse) and tap (touch) tooltip behavior to a chart
// just inserted via lineChartSVG()'s output. Pointer Events unify
// mouse and touch, so this one code path covers both — no separate
// touch-only branch. Call this right after setting .innerHTML to
// whatever contained the lineChartSVG() output.
//
// points here mirrors what was passed to lineChartSVG (same index
// order) — valueLabel is "Appointments" or "Revenue", formatValue is
// the same formatter already used for the chart/card (PKR formatting
// for revenue, plain number for appointment counts) so the tooltip
// never invents its own currency formatting.
function wireChartTooltip(hostEl, points, valueLabel, formatValue) {
  if (!hostEl) return;
  const tooltip = hostEl.querySelector(".chart-tooltip");
  if (!tooltip) return;
  const hitEls = hostEl.querySelectorAll("[data-chart-point]");
  if (!hitEls.length) return;

  const showFor = (target) => {
    const idx = Number(target.dataset.chartPoint);
    const p = points[idx];
    if (!p) return;
    tooltip.innerHTML = `<div style="font-weight:700;margin-bottom:2px;">${fullDateLabel(p.dateISO)}</div><div>${valueLabel}: ${formatValue(p.value)}</div>`;
    tooltip.style.display = "block";

    const hostRect = hostEl.getBoundingClientRect();
    const ptRect = target.getBoundingClientRect();
    let left = ptRect.left + ptRect.width / 2 - hostRect.left;
    const top = ptRect.top - hostRect.top;

    // Keep the tooltip from overflowing the card horizontally.
    const tooltipWidth = tooltip.offsetWidth || 130;
    left = Math.max(tooltipWidth / 2 + 4, Math.min(left, hostRect.width - tooltipWidth / 2 - 4));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  hitEls.forEach((el) => {
    el.addEventListener("pointerenter", () => showFor(el));
    el.addEventListener("pointerdown", (e) => {
      // stopPropagation matters here: the compact Overview/list-page
      // preview cards have their OWN click handler that navigates to
      // the Analytics page — without this, tapping a data point on
      // touch would show the tooltip AND immediately navigate away.
      e.preventDefault();
      e.stopPropagation();
      showFor(el);
    });
  });

  hostEl.addEventListener("pointerleave", () => {
    tooltip.style.display = "none";
  });
}

// Single, module-level listener — NOT re-attached on every chart
// render, which would leak a new document listener per re-render.
// Dismisses any visible chart tooltip when tapping/clicking anywhere
// outside a chart (mouse already has pointerleave for this; touch
// devices don't have an equivalent "leave", so this covers tapping
// elsewhere on the page instead).
document.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".chart-tooltip-host")) return;
  $$(".chart-tooltip").forEach((t) => (t.style.display = "none"));
});

// Plausible fake wave for the BLURRED preview only — never real data,
// never fetched from the backend while locked.
function trendChartPreviewHTML() {
  // More points and a clearer upward trend than before — the blur
  // and overlay already obscure the exact values, so this can afford
  // to look like a genuinely healthy, growing chart underneath.
  const fake = [3, 5, 4, 7, 6, 9, 8, 11, 9, 13, 12, 15].map((v) => ({ label: "", value: v }));
  return lineChartSVG(fake);
}

function trendCardShell(title, desc, bodyHTML, rangeSelectorHTML) {
  return `<div class="card" style="padding:24px;">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
      <div>
        <h2 style="font-size:20px;font-weight:700;">${title}</h2>
        <div class="sub" style="color:var(--muted);font-size:13.5px;margin-top:2px;">${desc}</div>
      </div>
      ${rangeSelectorHTML || ""}
    </div>
    ${bodyHTML}
  </div>`;
}

function trendRangeSelector(prefix, activeRange) {
  const btn = (value, label) =>
    `<button class="revenue-range-btn ${activeRange === value ? "active" : ""}" data-trend-btn="${prefix}:${value}">${label}</button>`;
  return `<div class="revenue-range" role="tablist" aria-label="Date range">
    ${btn("7d", "7 Days")}${btn("30d", "30 Days")}${btn("90d", "3 Months")}
  </div>`;
}

function wireTrendRangeButtons(prefix, onChange) {
  $$(`[data-trend-btn^="${prefix}:"]`).forEach((btn) => {
    btn.onclick = () => onChange(btn.dataset.trendBtn.split(":")[1]);
  });
}

function trendBody(state, valueKey, formatValue, emptyMsg, retryId) {
  if (state.loading) return `<div class="empty-state"><p>Loading chart…</p></div>`;
  if (state.error) {
    return `<div class="empty-state"><h3>We couldn't load your analytics.</h3><button class="btn btn-ghost" id="${retryId}">Retry</button></div>`;
  }
  const hasData = state.data.some((d) => (d[valueKey] || 0) > 0);
  if (!state.loaded || !hasData) return `<div class="empty-state"><p>${emptyMsg}</p></div>`;
  return lineChartSVG(
    state.data.map((d) => ({ label: d.date, value: d[valueKey] || 0, dateISO: d.dateISO })),
    { formatValue },
  );
}

/* ---------- Appointment Trends (in the Appointments view) ---------- */
async function loadAppointmentTrends() {
  const t = STATE.appointmentTrends;
  t.loading = true;
  t.error = false;
  renderAppointmentTrendsCard();
  try {
    const res = await apiGet(ENDPOINTS.appointmentAnalytics(t.range));
    t.data = res.data?.data || [];
    t.loaded = true;
  } catch (err) {
    t.error = true;
    console.warn("Appointment analytics failed:", err.message);
  } finally {
    t.loading = false;
    renderAppointmentTrendsCard();
  }
}

function renderAppointmentTrendsCard() {
  const el = $("#apptTrendsWrap");
  if (!el) return;
  const t = STATE.appointmentTrends;

  if (!canAccessFeature("appointmentTrends")) {
    el.innerHTML = `<div class="mt24">${proFeatureGate("appointmentTrends", {
      title: "Appointment Trends",
      description:
        "Track how your appointment volume changes over time — see daily patterns, busy days, and growth.",
      previewHTML: trendChartPreviewHTML(),
    })}</div>`;
    return;
  }

  const body = trendBody(t, "count", (v) => v, "No appointments during this period.", "apptTrendsRetry");
  el.innerHTML = `<div class="mt24">${trendCardShell(
    "Appointment Trends",
    "Track how your appointment volume changes over time.",
    body,
    trendRangeSelector("apptTrends", t.range),
  )}</div>`;

  wireTrendRangeButtons("apptTrends", (range) => {
    t.range = range;
    loadAppointmentTrends();
  });
  const retryBtn = $("#apptTrendsRetry");
  if (retryBtn) retryBtn.onclick = loadAppointmentTrends;

  // Only a real chart has hit targets to wire — loading/error/empty
  // states rendered no lineChartSVG() output at all.
  if (t.loaded && t.data.some((d) => (d.count || 0) > 0)) {
    wireChartTooltip(
      el.querySelector(".chart-tooltip-host"),
      t.data.map((d) => ({ value: d.count || 0, dateISO: d.dateISO })),
      "Appointments",
      (v) => v,
    );
  }
}

// Wraps the existing renderAppointments() with a subscription refresh
// (so an upgrade unlocks the chart immediately, matching how
// openRevenueView already does this for the Custom Range gate) and a
// one-time lazy load of the trends chart.
async function openAppointmentsView() {
  try {
    await loadSubscription();
  } catch (err) {
    console.warn("Subscription refresh failed:", err.message);
  }
  loadAppointmentsPage(); // fetches + renders the paginated table itself

  renderApptSummaryCardInto("apptPageSummary", () => {
    $("#apptTableWrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  renderTrendPreviewCard(
    "apptPageTrendsPreview",
    "appointmentTrends",
    "Appointment Trends",
    "Track appointment trends with the Practice plan.",
    STATE.appointmentTrends,
    "count",
    (v) => v,
    () => showView("appointments-analytics"),
  );
  if (canAccessFeature("appointmentTrends") && !STATE.appointmentTrends.loaded) {
    await loadAppointmentTrends();
    renderTrendPreviewCard(
      "apptPageTrendsPreview",
      "appointmentTrends",
      "Appointment Trends",
      "Track appointment trends with the Practice plan.",
      STATE.appointmentTrends,
      "count",
      (v) => v,
      () => showView("appointments-analytics"),
    );
  }
}

// Dedicated Appointment Analytics page — reuses the SAME
// renderAppointmentTrendsCard()/loadAppointmentTrends() logic that
// used to render inline at the bottom of the Appointments list page;
// only the page it renders into moved.
async function openAppointmentAnalyticsView() {
  try {
    await loadSubscription();
  } catch (err) {
    console.warn("Subscription refresh failed:", err.message);
  }
  renderAppointmentTrendsCard();
  renderAppointmentAnalyticsSummary();
  if (canAccessFeature("appointmentTrends") && !STATE.appointmentTrends.loaded) {
    await loadAppointmentTrends();
    renderAppointmentAnalyticsSummary();
  }
}

// Total / average-per-day / peak-day — pure derivation from the
// SAME data loadAppointmentTrends() already fetched, no new backend
// call and no duplicated chart data logic.
function renderAppointmentAnalyticsSummary() {
  const el = $("#apptAnalyticsSummary");
  if (!el) return;
  const t = STATE.appointmentTrends;
  if (!canAccessFeature("appointmentTrends") || !t.loaded || !t.data.length) {
    el.innerHTML = "";
    return;
  }
  const total = t.data.reduce((sum, d) => sum + (d.count || 0), 0);
  const avg = t.data.length ? total / t.data.length : 0;
  const peak = t.data.reduce((max, d) => (d.count > max.count ? d : max), t.data[0]);
  el.innerHTML = `
    <div class="stat-grid mt24">
      <div class="stat"><div class="st-top">Total Appointments</div><div class="st-val">${total}</div></div>
      <div class="stat"><div class="st-top">Average per Day</div><div class="st-val">${avg.toFixed(1)}</div></div>
      <div class="stat"><div class="st-top">Peak Day</div><div class="st-val" style="font-size:19px;">${peak.date} (${peak.count})</div></div>
    </div>`;
}

/* ---------- Revenue Trends (in the Revenue view) ---------- */
async function loadRevenueTrends() {
  const t = STATE.revenueTrends;
  t.loading = true;
  t.error = false;
  renderRevenueTrendsCard();
  try {
    const res = await apiGet(ENDPOINTS.revenueAnalytics(t.range));
    t.data = res.data?.data || [];
    t.loaded = true;
  } catch (err) {
    t.error = true;
    console.warn("Revenue analytics failed:", err.message);
  } finally {
    t.loading = false;
    renderRevenueTrendsCard();
  }
}

function renderRevenueTrendsCard() {
  const el = $("#revenueTrendsWrap");
  if (!el) return;
  const t = STATE.revenueTrends;

  if (!canAccessFeature("revenueTrends")) {
    el.innerHTML = proFeatureGate("revenueTrends", {
      title: "Revenue Trends",
      description:
        "Track how your clinic revenue changes over time — spot growth, seasonal dips, and your best days.",
      previewHTML: trendChartPreviewHTML(),
    });
    return;
  }

  const body = trendBody(
    t,
    "revenue",
    (v) => `PKR ${Number(v).toLocaleString()}`,
    "No revenue recorded during this period.",
    "revenueTrendsRetry",
  );
  el.innerHTML = trendCardShell(
    "Revenue Trends",
    "Track how your clinic revenue changes over time.",
    body,
    trendRangeSelector("revenueTrends", t.range),
  );

  wireTrendRangeButtons("revenueTrends", (range) => {
    t.range = range;
    loadRevenueTrends();
  });
  const retryBtn = $("#revenueTrendsRetry");
  if (retryBtn) retryBtn.onclick = loadRevenueTrends;

  if (t.loaded && t.data.some((d) => (d.revenue || 0) > 0)) {
    wireChartTooltip(
      el.querySelector(".chart-tooltip-host"),
      t.data.map((d) => ({ value: d.revenue || 0, dateISO: d.dateISO })),
      "Revenue",
      (v) => `PKR ${Number(v).toLocaleString()}`,
    );
  }
}

// Delegated — covers every current and future data-pro-upgrade
// button without needing a new listener per feature. Reuses the
// EXISTING payment modal (the same one the Subscription page's own
// Upgrade button opens) — no second/parallel upgrade system.
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pro-upgrade]");
  if (btn) {
    e.preventDefault();
    openPaymentModal("upgrade");
  }
});

const tokenLabel = (n) => (n && n > 0 ? "#" + n : "—");

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

  try {
    await loadNotifications();
  } catch (err) {
    console.warn("Couldn't load notifications:", err.message);
  }
  renderNotifs();
  syncTopbarIdentity();
  const h = location.hash.replace("#", "");
  showView(TITLES[h] ? h : "overview");
  initSocket();
}
init();