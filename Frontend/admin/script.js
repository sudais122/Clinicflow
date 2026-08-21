/* ============================================================
   ClinicFlow — Admin Dashboard (behavior)
   Vanilla JS, wired to the real /admin backend. Same pattern as
   doctor-dashboard.js / patient-dashboard.js: ENDPOINTS map,
   apiCall wrapper, ApiResponse envelope, credentials: "include".

   NOT INCLUDED (no backing endpoint exists yet — see notes):
   - Global search across doctors/patients/appointments (needs a
     dedicated /admin/search endpoint; not built).
   - Notification bell / dropdown (no /admin/notifications route).
   - Revenue / appointment-trend / patient-growth charts (the
     analytics endpoint that would back these was removed earlier
     per your request; only /admin/overview totals exist).
   - "Suspended" status/actions are intentionally never shown here,
     per your decision to keep isSuspended server-side only.
   Adjust LOGIN_PATH below to your actual admin login page.
   ============================================================ */

const API_BASE = window.CLINICFLOW_CONFIG?.API_BASE || "http://localhost:8000";
const LOGIN_PATH = "login/adminlogin.html";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ENDPOINTS = {
  me: () => `${API_BASE}/admin/me`,
  logout: () => `${API_BASE}/admin/logout`,
  overview: (period) => `${API_BASE}/admin/overview?period=${period || "all"}`,
  trends: () => `${API_BASE}/admin/trends`,
  activity: () => `${API_BASE}/admin/activity`,

  doctors: (qs) => `${API_BASE}/admin/doctors?${qs}`,
  doctorDetails: (doctorId) => `${API_BASE}/admin/doctors/${doctorId}`,
  doctorAppointments: (doctorId, date) =>
    `${API_BASE}/admin/doctors/${doctorId}/appointments${date ? `?date=${date}` : ""}`,
  doctorApprove: (doctorId) => `${API_BASE}/admin/doctors/${doctorId}/approve`,
  doctorActivate: (doctorId) =>
    `${API_BASE}/admin/doctors/${doctorId}/activate`,
  doctorDeactivate: (doctorId) =>
    `${API_BASE}/admin/doctors/${doctorId}/deactivate`,

  patients: (qs) => `${API_BASE}/admin/patients?${qs}`,
  patientDetails: (patientId) => `${API_BASE}/admin/patients/${patientId}`,
  patientAppointments: (patientId) =>
    `${API_BASE}/admin/patients/${patientId}/appointments`,
  patientActivate: (patientId) =>
    `${API_BASE}/admin/patients/${patientId}/activate`,
  patientDisable: (patientId) =>
    `${API_BASE}/admin/patients/${patientId}/disable`,

  subscriptions: (qs) => `${API_BASE}/admin/subscriptions?${qs}`,
  subscriptionDetails: (id) => `${API_BASE}/admin/subscriptions/${id}`,
  subscriptionExtend: (id) => `${API_BASE}/admin/subscriptions/${id}/extend`,
  subscriptionPlan: (id) => `${API_BASE}/admin/subscriptions/${id}/plan`,

  reports: (qs) => `${API_BASE}/admin/reports/problems?${qs}`,
  reportDetails: (id) => `${API_BASE}/admin/reports/problems/${id}`,
  reportReview: (id) => `${API_BASE}/admin/reports/problems/${id}/review`,
  reportResolve: (id) => `${API_BASE}/admin/reports/problems/${id}/resolve`,

  profile: () => `${API_BASE}/admin/profile`,
  password: () => `${API_BASE}/admin/profile/password`,
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
    /* no body */
  }
  if (!res.ok) {
    const err = new Error(payload?.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return payload; // { statusCode, data, message, success }
}
const apiGet = (url) => apiCall(url, { method: "GET" });
const apiPatch = (url, body) => apiCall(url, { method: "PATCH", body });

/* ---------- STATE ---------- */
const ADMIN = { fullname: "", email: "", phone: "", status: "active" };
const DR_STATE = { page: 1, limit: 20, search: "", status: "", spec: "" };
const PT_STATE = { page: 1, limit: 20, search: "", status: "" };
const SUB_STATE = { page: 1, limit: 20, search: "", plan: "", status: "" };
const REP_STATE = { page: 1, limit: 20, status: "" };
let currentDoctorId = null;
let currentPatientId = null;
const CHARTS = {}; // holds live Chart.js instances so we can destroy+recreate on reload

/* ---------- ROUTER ---------- */
const TITLES = {
  overview: "Overview",
  doctors: "Doctors",
  doctorDetail: "Doctor Details",
  patients: "Patients",
  patientDetail: "Patient Details",
  clinics: "Clinics",
  subscriptions: "Subscriptions",
  reports: "Reports",
  reportDetail: "Report Details",
  settings: "Settings",
  profile: "Admin Profile",
};
function showView(name) {
  $$(".view").forEach((v) => (v.hidden = true));
  const v = $("#view-" + name);
  if (v) v.hidden = false;
  $("#pageTitle").textContent = TITLES[name] || "Overview";
  $$("#nav a").forEach((a) =>
    a.classList.toggle("active", a.dataset.view === name),
  );
  $("#sidebar").classList.remove("open");
  history.replaceState(null, "", "#" + name);
  window.scrollTo(0, 0);

  if (name === "overview") loadOverview();
  if (name === "doctors") loadDoctors();
  if (name === "patients") loadPatients();
  if (name === "subscriptions") loadSubscriptions();
  if (name === "reports") loadReports();
  if (name === "profile") loadProfile();
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-view]");
  if (el) {
    e.preventDefault();
    showView(el.dataset.view);
  }
});
$("#mobileMenuBtn").addEventListener("click", () =>
  $("#sidebar").classList.toggle("open"),
);

/* ---------- helpers ---------- */
function statusPill(status) {
  const label =
    { pending: "Pending", active: "Active", inactive: "Inactive" }[status] ||
    status;
  return `<span class="pill ${status}"><span class="d"></span>${label}</span>`;
}
function apptStatusPill(status) {
  const label =
    {
      waiting: "Waiting",
      "in-progress": "In Progress",
      completed: "Completed",
      cancelled: "Cancelled",
    }[status] || status;
  return `<span class="pill ${status}">${label}</span>`;
}
function reportStatusPill(status) {
  const label =
    { pending: "Pending", inreview: "In Review", resolved: "Resolved" }[
      status
    ] || status;
  return `<span class="pill ${status === "pending" ? "pending" : status}">${label}</span>`;
}
function subStatusPill(status) {
  const label =
    { active: "Active", expired: "Expired", cancelled: "Cancelled" }[status] ||
    status;
  return `<span class="pill ${status}">${label}</span>`;
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
function initials(n) {
  return (
    (n || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "—"
  );
}
function renderPagination(el, pagination, onPage) {
  if (!pagination || pagination.pages <= 1) {
    el.innerHTML = "";
    return;
  }
  const { page, pages } = pagination;
  let html = `<button ${page <= 1 ? "disabled" : ""} data-p="${page - 1}">Prev</button>`;
  for (let i = 1; i <= pages; i++) {
    if (pages > 7 && i !== 1 && i !== pages && Math.abs(i - page) > 1) {
      if (i === 2 || i === pages - 1) html += `<span>…</span>`;
      continue;
    }
    html += `<button class="${i === page ? "active" : ""}" data-p="${i}">${i}</button>`;
  }
  html += `<button ${page >= pages ? "disabled" : ""} data-p="${page + 1}">Next</button>`;
  el.innerHTML = html;
  $$("button[data-p]", el).forEach(
    (b) => (b.onclick = () => onPage(+b.dataset.p)),
  );
}

/* ---------- TOAST / MODAL / CONFIRM ---------- */
function toast(title, msg = "", isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.innerHTML = `<span class="tic">${isError ? "!" : "✓"}</span><div><div class="tt">${title}</div>${msg ? `<div class="tm">${msg}</div>` : ""}</div>`;
  $("#toasts").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .3s";
    setTimeout(() => el.remove(), 300);
  }, 3600);
}
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
function confirmModal({
  title,
  body,
  confirmText = "Confirm",
  danger = false,
  onConfirm,
  extraFieldHtml = "",
}) {
  openModal(`
    <h2>${title}</h2>
    <p class="muted">${body}</p>
    ${extraFieldHtml}
    <div class="modal-foot">
      <button class="btn btn-secondary" data-close>Cancel</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="confirmYes">${confirmText}</button>
    </div>`);
  $("#confirmYes").onclick = () => {
    onConfirm && onConfirm();
  };
}

/* ================= OVERVIEW ================= */
function destroyChart(key) {
  if (CHARTS[key]) {
    CHARTS[key].destroy();
    delete CHARTS[key];
  }
}
async function loadOverview() {
  const period = $("#ovPeriod").value || "all";
  let overviewData = null;
  try {
    const res = await apiGet(ENDPOINTS.overview(period));
    overviewData = res.data;
    const d = overviewData;
    $("#ovGreeting").textContent = `Good day, ${ADMIN.fullname || "Admin"}`;

    $("#ovStatGrid").innerHTML = [
      ["Doctors", d.doctors.total, `${d.doctors.pending} pending`],
      ["Patients", d.patients.total, `${d.patients.active} active`],
      [
        "Appointments",
        d.appointments.total,
        `${d.appointments.completed} completed`,
      ],
      [
        "Subscriptions",
        d.subscriptions.total,
        `${d.subscriptions.active} active`,
      ],
      [
        "Open Reports",
        d.problemReports.total,
        `${d.problemReports.pending} pending`,
      ],
    ]
      .map(
        ([k, v, sub]) => `
      <div class="stat-card"><div class="k">${k}</div><div class="v">${v}</div><div class="vsub">${sub}</div></div>`,
      )
      .join("");
  } catch (err) {
    toast("Couldn't load overview", err.message, true);
  }

  // Appointment status donut — reuses overview totals already fetched above,
  // no separate endpoint needed for this one.
  if (overviewData && typeof Chart !== "undefined") {
    destroyChart("apptStatus");
    const a = overviewData.appointments;
    CHARTS.apptStatus = new Chart($("#chartApptStatus"), {
      type: "doughnut",
      data: {
        labels: ["Completed", "Waiting", "In Progress", "Cancelled"],
        datasets: [
          {
            data: [a.completed, a.waiting, a.inProgress, a.cancelled],
            backgroundColor: ["#16A34A", "#D97706", "#2F6FED", "#DC2626"],
            borderWidth: 0,
          },
        ],
      },
      options: {
        plugins: {
          legend: {
            position: "bottom",
            labels: { boxWidth: 10, font: { size: 11.5 } },
          },
        },
        cutout: "62%",
      },
    });
  }

  // Trends — real, from /admin/trends (appointment trend, revenue, patient growth)
  if (typeof Chart !== "undefined") {
    try {
      const res = await apiGet(ENDPOINTS.trends());
      const { appointmentTrend, revenueByMonth, patientGrowth } = res.data;
      const labels = appointmentTrend.map((m) => m.month);

      destroyChart("apptTrend");
      CHARTS.apptTrend = new Chart($("#chartApptTrend"), {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Completed",
              data: appointmentTrend.map((m) => m.completed),
              borderColor: "#16A34A",
              backgroundColor: "rgba(22,163,74,.08)",
              fill: true,
              tension: 0.35,
            },
            {
              label: "Cancelled",
              data: appointmentTrend.map((m) => m.cancelled),
              borderColor: "#DC2626",
              backgroundColor: "rgba(220,38,38,.06)",
              fill: true,
              tension: 0.35,
            },
          ],
        },
        options: {
          plugins: {
            legend: {
              position: "bottom",
              labels: { boxWidth: 10, font: { size: 11.5 } },
            },
          },
          scales: { y: { beginAtZero: true } },
        },
      });

      destroyChart("revenue");
      CHARTS.revenue = new Chart($("#chartRevenue"), {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Revenue (PKR)",
              data: revenueByMonth.map((m) => m.revenue),
              backgroundColor: "#2F6FED",
              borderRadius: 5,
            },
          ],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } },
        },
      });

      destroyChart("patientGrowth");
      CHARTS.patientGrowth = new Chart($("#chartPatientGrowth"), {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "New patients",
              data: patientGrowth.map((m) => m.newPatients),
              borderColor: "#2F6FED",
              backgroundColor: "rgba(47,111,237,.08)",
              fill: true,
              tension: 0.35,
            },
          ],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } },
        },
      });
    } catch (err) {
      toast("Couldn't load trends", err.message, true);
    }
  }

  // Recent activity — derived feed, real records
  try {
    const res = await apiGet(ENDPOINTS.activity());
    const items = res.data;
    $("#ovActivity").innerHTML = items.length
      ? items
          .map(
            (i) => `
        <div class="quick-row">
          <div class="qn" style="font-weight:500;">${i.text}</div>
          <div class="qs">${timeAgo(i.at)}</div>
        </div>`,
          )
          .join("")
      : `<div class="empty-row">No recent activity.</div>`;
  } catch (err) {
    $("#ovActivity").innerHTML =
      `<div class="empty-row">Couldn't load activity.</div>`;
  }

  // Pending doctor approvals (real data, from the doctors list filtered by status=pending)
  try {
    const res = await apiGet(ENDPOINTS.doctors("status=pending&limit=5"));
    const list = res.data.doctors;
    $("#ovPendingDoctors").innerHTML = list.length
      ? list
          .map(
            (doc) => `
        <div class="quick-row">
          <div><div class="qn">${doc.user?.fullname || "—"}</div><div class="qs">${doc.specialization}</div></div>
          ${statusPill("pending")}
        </div>`,
          )
          .join("")
      : `<div class="empty-row">No doctors awaiting approval.</div>`;
  } catch {
    $("#ovPendingDoctors").innerHTML =
      `<div class="empty-row">Couldn't load.</div>`;
  }

  // Latest problem reports (real data)
  try {
    const res = await apiGet(ENDPOINTS.reports("status=pending&limit=5"));
    const list = res.data.reports;
    $("#ovLatestReports").innerHTML = list.length
      ? list
          .map(
            (r) => `
        <div class="quick-row">
          <div><div class="qn">${r.subject}</div><div class="qs">${r.reportedBy?.name || "—"}</div></div>
          ${reportStatusPill(r.status)}
        </div>`,
          )
          .join("")
      : `<div class="empty-row">No open reports.</div>`;
  } catch {
    $("#ovLatestReports").innerHTML =
      `<div class="empty-row">Couldn't load.</div>`;
  }
}
$("#ovPeriod").addEventListener("change", loadOverview);

/* ================= DOCTORS LIST ================= */
async function loadDoctors() {
  const qs = new URLSearchParams({
    page: DR_STATE.page,
    limit: DR_STATE.limit,
    ...(DR_STATE.search && { search: DR_STATE.search }),
    ...(DR_STATE.status && { status: DR_STATE.status }),
    ...(DR_STATE.spec && { specialization: DR_STATE.spec }),
  }).toString();

  try {
    const res = await apiGet(ENDPOINTS.doctors(qs));
    const { doctors, pagination } = res.data;

    const counts = { pending: 0, active: 0, inactive: 0 };
    doctors.forEach((d) => {
      if (counts[d.status] !== undefined) counts[d.status]++;
    });
    $("#drStatGrid").innerHTML = [
      ["Total (this page)", doctors.length],
      ["Pending", counts.pending],
      ["Active", counts.active],
      ["Inactive", counts.inactive],
    ]
      .map(
        ([k, v]) =>
          `<div class="stat-card"><div class="k">${k}</div><div class="v">${v}</div></div>`,
      )
      .join("");

    $("#drTableBody").innerHTML = doctors.length
      ? doctors
          .map(
            (doc) => `
      <tr>
        <td>
          <div class="cell-name">${doc.user?.fullname || "—"}</div>
          <div class="cell-sub">${doc.user?.email || ""}</div>
        </td>
        <td>${doc.specialization}</td>
        <td>${doc.clinicName}</td>
        <td>${statusPill(doc.status)}</td>
        <td><button class="btn btn-secondary btn-sm" data-open-doctor="${doc.doctorId}">View</button></td>
      </tr>`,
          )
          .join("")
      : `<tr><td colspan="5" class="empty-row">No doctors found.</td></tr>`;

    renderPagination($("#drPagination"), pagination, (p) => {
      DR_STATE.page = p;
      loadDoctors();
    });
  } catch (err) {
    toast("Couldn't load doctors", err.message, true);
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-open-doctor]");
  if (el) {
    openDoctorDetail(el.dataset.openDoctor);
  }
});
let drSearchTimer;
$("#drSearch").addEventListener("input", (e) => {
  clearTimeout(drSearchTimer);
  drSearchTimer = setTimeout(() => {
    DR_STATE.search = e.target.value.trim();
    DR_STATE.page = 1;
    loadDoctors();
  }, 350);
});
$("#drStatusFilter").addEventListener("change", (e) => {
  DR_STATE.status = e.target.value;
  DR_STATE.page = 1;
  loadDoctors();
});
$("#drSpecFilter").addEventListener("input", (e) => {
  clearTimeout(drSearchTimer);
  drSearchTimer = setTimeout(() => {
    DR_STATE.spec = e.target.value.trim();
    DR_STATE.page = 1;
    loadDoctors();
  }, 350);
});

/* ================= DOCTOR DETAILS ================= */
async function openDoctorDetail(doctorId) {
  currentDoctorId = doctorId;
  showView("doctorDetail");
  try {
    const res = await apiGet(ENDPOINTS.doctorDetails(doctorId));
    const { doctor, statistics, subscription } = res.data;

    $("#ddName").textContent = doctor.fullname || "—";
    $("#ddIdSpec").textContent =
      `${doctor.doctorId} · ${doctor.specialization}`;

    $("#ddInfoGrid").innerHTML = [
      ["Email", doctor.email],
      ["Phone", doctor.phone],
      ["Clinic", doctor.clinicName],
      ["Clinic Address", doctor.clinicAddress],
      ["Experience", `${doctor.experience} years`],
      ["License Number", doctor.licenseNumber],
      [
        "Consultation Fee",
        `PKR ${Number(doctor.consultationFee || 0).toLocaleString()}`,
      ],
      ["Account Status", statusPill(doctor.status)],
    ]
      .map(
        ([k, v]) =>
          `<div><div class="fk">${k}</div><div class="fv">${v}</div></div>`,
      )
      .join("");

    $("#ddSubGrid").innerHTML = subscription
      ? [
          [
            "Plan",
            `<span class="pill ${subscription.plan}">${subscription.plan === "paid" ? "Paid" : "Free"}</span>`,
          ],
          ["Status", subStatusPill(subscription.status)],
          ["Start Date", fmtDate(subscription.startDate)],
          [
            subscription.status === "expired" ? "Expired" : "Expires",
            subscription.plan === "paid" ? fmtDate(subscription.endDate) : "—",
          ],
        ]
          .map(
            ([k, v]) =>
              `<div><div class="fk">${k}</div><div class="fv">${v}</div></div>`,
          )
          .join("")
      : `<div class="empty-row">No subscription on record.</div>`;

    // Actions — only Verify/Deactivate/Activate, per spec (never "Suspend")
    let actions = "";
    if (doctor.status === "pending")
      actions = `<button class="btn btn-primary btn-sm" id="ddApprove">Verify / Accept</button>`;
    else if (doctor.status === "active")
      actions = `<button class="btn btn-danger btn-sm" id="ddDeactivate">Deactivate</button>`;
    else if (doctor.status === "inactive")
      actions = `<button class="btn btn-primary btn-sm" id="ddActivate">Activate</button>`;
    $("#ddActions").innerHTML = actions;

    if ($("#ddApprove"))
      $("#ddApprove").onclick = () =>
        doctorAction(ENDPOINTS.doctorApprove(doctorId), "Doctor approved");
    if ($("#ddDeactivate"))
      $("#ddDeactivate").onclick = () =>
        confirmModal({
          title: "Deactivate this doctor?",
          body: "They will no longer be able to use ClinicFlow until reactivated.",
          confirmText: "Deactivate",
          danger: true,
          onConfirm: () => {
            closeModal();
            doctorAction(
              ENDPOINTS.doctorDeactivate(doctorId),
              "Doctor deactivated",
            );
          },
        });
    if ($("#ddActivate"))
      $("#ddActivate").onclick = () =>
        doctorAction(ENDPOINTS.doctorActivate(doctorId), "Doctor activated");

    $("#ddApptDate").value = todayISO();
    loadDoctorAppointments(doctorId, todayISO());
  } catch (err) {
    toast("Couldn't load doctor", err.message, true);
  }
}
async function doctorAction(url, successMsg) {
  try {
    await apiPatch(url);
    toast(successMsg);
    openDoctorDetail(currentDoctorId);
  } catch (err) {
    toast("Action failed", err.message, true);
  }
}
async function loadDoctorAppointments(doctorId, date) {
  try {
    const res = await apiGet(ENDPOINTS.doctorAppointments(doctorId, date));
    const { totalAppointments, appointments } = res.data;
    $("#ddApptTotal").textContent = totalAppointments;
    $("#ddApptBody").innerHTML = appointments.length
      ? appointments
          .map(
            (a) => `
        <tr><td>${a.patientName}</td><td>${fmtDate(a.appointmentDate)}</td><td>${apptStatusPill(a.status)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="3" class="empty-row">No appointments on this date.</td></tr>`;
  } catch (err) {
    toast("Couldn't load appointments", err.message, true);
  }
}
$("#ddApptDate").addEventListener("change", (e) =>
  loadDoctorAppointments(currentDoctorId, e.target.value),
);

/* ================= PATIENTS LIST ================= */
async function loadPatients() {
  const qs = new URLSearchParams({
    page: PT_STATE.page,
    limit: PT_STATE.limit,
    ...(PT_STATE.search && { search: PT_STATE.search }),
    ...(PT_STATE.status && { status: PT_STATE.status }),
  }).toString();
  try {
    const res = await apiGet(ENDPOINTS.patients(qs));
    const { patients, pagination } = res.data;
    $("#ptTableBody").innerHTML = patients.length
      ? patients
          .map(
            (p) => `
      <tr>
        <td><div class="cell-name">${p.user?.fullname || "—"}</div><div class="cell-sub">${p.user?.email || ""}</div></td>
        <td>${p.user?.phone || "—"}</td>
        <td>${p.gender ? p.gender[0].toUpperCase() + p.gender.slice(1) : "—"}</td>
        <td>${statusPill(p.user?.isActive ? "active" : "inactive")}</td>
        <td><button class="btn btn-secondary btn-sm" data-open-patient="${p.patientId}">View</button></td>
      </tr>`,
          )
          .join("")
      : `<tr><td colspan="5" class="empty-row">No patients found.</td></tr>`;
    renderPagination($("#ptPagination"), pagination, (pg) => {
      PT_STATE.page = pg;
      loadPatients();
    });
  } catch (err) {
    toast("Couldn't load patients", err.message, true);
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-open-patient]");
  if (el) openPatientDetail(el.dataset.openPatient);
});
let ptSearchTimer;
$("#ptSearch").addEventListener("input", (e) => {
  clearTimeout(ptSearchTimer);
  ptSearchTimer = setTimeout(() => {
    PT_STATE.search = e.target.value.trim();
    PT_STATE.page = 1;
    loadPatients();
  }, 350);
});
$("#ptStatusFilter").addEventListener("change", (e) => {
  PT_STATE.status = e.target.value;
  PT_STATE.page = 1;
  loadPatients();
});

/* ================= PATIENT DETAILS ================= */
async function openPatientDetail(patientId) {
  currentPatientId = patientId;
  showView("patientDetail");
  try {
    const res = await apiGet(ENDPOINTS.patientDetails(patientId));
    const { patient, statistics } = res.data;

    $("#pdName").textContent = patient.fullname || "—";
    $("#pdIdMeta").textContent = patientId;

    $("#pdInfoGrid").innerHTML = [
      ["Email", patient.email],
      ["Phone", patient.phone],
      ["Date of Birth", fmtDate(patient.dateOfBirth)],
      [
        "Gender",
        patient.gender
          ? patient.gender[0].toUpperCase() + patient.gender.slice(1)
          : "—",
      ],
      ["Blood Group", patient.bloodGroup || "—"],
      ["Account Status", statusPill(patient.isActive ? "active" : "inactive")],
      ["Total Appointments", statistics.totalAppointments],
      ["Completed", statistics.completed],
    ]
      .map(
        ([k, v]) =>
          `<div><div class="fk">${k}</div><div class="fv">${v}</div></div>`,
      )
      .join("");

    $("#pdActions").innerHTML = patient.isActive
      ? `<button class="btn btn-danger btn-sm" id="pdDisable">Disable</button>`
      : `<button class="btn btn-primary btn-sm" id="pdActivate">Activate</button>`;

    if ($("#pdDisable"))
      $("#pdDisable").onclick = () =>
        confirmModal({
          title: "Disable this patient?",
          body: "They will not be able to book new appointments until reactivated.",
          confirmText: "Disable",
          danger: true,
          onConfirm: () => {
            closeModal();
            patientAction(
              ENDPOINTS.patientDisable(patientId),
              "Patient disabled",
            );
          },
        });
    if ($("#pdActivate"))
      $("#pdActivate").onclick = () =>
        patientAction(
          ENDPOINTS.patientActivate(patientId),
          "Patient activated",
        );

    const apRes = await apiGet(ENDPOINTS.patientAppointments(patientId));
    const list = apRes.data.appointments;
    $("#pdApptBody").innerHTML = list.length
      ? list
          .map(
            (a) =>
              `<tr><td>${a.doctor?.name || "—"}</td><td>${a.clinic || "—"}</td><td>${fmtDate(a.appointmentDate)}</td><td>${apptStatusPill(a.status)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4" class="empty-row">No appointments yet.</td></tr>`;
  } catch (err) {
    toast("Couldn't load patient", err.message, true);
  }
}
async function patientAction(url, successMsg) {
  try {
    await apiPatch(url);
    toast(successMsg);
    openPatientDetail(currentPatientId);
  } catch (err) {
    toast("Action failed", err.message, true);
  }
}

/* ================= SUBSCRIPTIONS ================= */
async function loadSubscriptions() {
  const qs = new URLSearchParams({
    page: SUB_STATE.page,
    limit: SUB_STATE.limit,
    ...(SUB_STATE.plan && { plan: SUB_STATE.plan }),
    ...(SUB_STATE.status && { status: SUB_STATE.status }),
  }).toString();
  try {
    const res = await apiGet(ENDPOINTS.subscriptions(qs));
    let { subscriptions, pagination } = res.data;

    if (SUB_STATE.search) {
      const q = SUB_STATE.search.toLowerCase();
      subscriptions = subscriptions.filter((s) =>
        (s.doctor?.user?.fullname || "").toLowerCase().includes(q),
      );
    }

    $("#subTableBody").innerHTML = subscriptions.length
      ? subscriptions
          .map(
            (s) => `
      <tr>
        <td><div class="cell-name">${s.doctor?.user?.fullname || "—"}</div><div class="cell-sub">${s.doctor?.clinicName || ""}</div></td>
        <td><span class="pill ${s.plan}">${s.plan === "paid" ? "Paid" : "Free"}</span></td>
        <td>${subStatusPill(s.liveStatus || s.status)}</td>
        <td>${s.plan === "paid" ? fmtDate(s.endDate) : "—"}</td>
        <td><button class="btn btn-secondary btn-sm" data-open-sub="${s.subscriptionId}">View</button></td>
      </tr>`,
          )
          .join("")
      : `<tr><td colspan="5" class="empty-row">No subscriptions found.</td></tr>`;

    renderPagination($("#subPagination"), pagination, (p) => {
      SUB_STATE.page = p;
      loadSubscriptions();
    });
  } catch (err) {
    toast("Couldn't load subscriptions", err.message, true);
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-open-sub]");
  if (el) openSubscriptionModal(el.dataset.openSub);
});
let subSearchTimer;
$("#subSearch").addEventListener("input", (e) => {
  clearTimeout(subSearchTimer);
  subSearchTimer = setTimeout(() => {
    SUB_STATE.search = e.target.value.trim();
    loadSubscriptions();
  }, 350);
});
$("#subPlanFilter").addEventListener("change", (e) => {
  SUB_STATE.plan = e.target.value;
  SUB_STATE.page = 1;
  loadSubscriptions();
});
$("#subStatusFilter").addEventListener("change", (e) => {
  SUB_STATE.status = e.target.value;
  SUB_STATE.page = 1;
  loadSubscriptions();
});

async function openSubscriptionModal(subscriptionId) {
  try {
    const res = await apiGet(ENDPOINTS.subscriptionDetails(subscriptionId));
    const s = res.data;
    openModal(`
      <h2>${s.doctor?.name || "Subscription"}</h2>
      <p class="muted">${subscriptionId}</p>
      <div class="field-grid">
        <div><div class="fk">Plan</div><div class="fv"><span class="pill ${s.plan}">${s.plan === "paid" ? "Paid" : "Free"}</span></div></div>
        <div><div class="fk">Status</div><div class="fv">${subStatusPill(s.status)}</div></div>
        <div><div class="fk">Start Date</div><div class="fv">${fmtDate(s.startDate)}</div></div>
        <div><div class="fk">Expiry</div><div class="fv">${s.plan === "paid" ? fmtDate(s.endDate) : "—"}</div></div>
      </div>
      <div class="modal-foot" style="justify-content: space-between; margin-top: 22px;">
        <button class="btn btn-secondary" id="subExtendBtn">Extend 30 days</button>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-secondary" data-close>Close</button>
          <button class="btn btn-primary" id="subTogglePlanBtn">Switch to ${s.plan === "paid" ? "Free" : "Paid"}</button>
        </div>
      </div>`);
    $("#subExtendBtn").onclick = async () => {
      try {
        await apiPatch(ENDPOINTS.subscriptionExtend(subscriptionId), {
          days: 30,
        });
        toast("Subscription extended");
        closeModal();
        loadSubscriptions();
      } catch (err) {
        toast("Couldn't extend", err.message, true);
      }
    };
    $("#subTogglePlanBtn").onclick = async () => {
      try {
        await apiPatch(ENDPOINTS.subscriptionPlan(subscriptionId), {
          plan: s.plan === "paid" ? "free" : "paid",
        });
        toast("Plan updated");
        closeModal();
        loadSubscriptions();
      } catch (err) {
        toast("Couldn't update plan", err.message, true);
      }
    };
  } catch (err) {
    toast("Couldn't load subscription", err.message, true);
  }
}

/* ================= REPORTS ================= */
async function loadReports() {
  const qs = new URLSearchParams({
    page: REP_STATE.page,
    limit: REP_STATE.limit,
    ...(REP_STATE.status && { status: REP_STATE.status }),
  }).toString();
  try {
    const res = await apiGet(ENDPOINTS.reports(qs));
    const { reports, pagination } = res.data;

    const counts = { pending: 0, inreview: 0, resolved: 0 };
    reports.forEach((r) => {
      if (counts[r.status] !== undefined) counts[r.status]++;
    });
    $("#repStatGrid").innerHTML = [
      ["Pending", counts.pending],
      ["In Review", counts.inreview],
      ["Resolved", counts.resolved],
    ]
      .map(
        ([k, v]) =>
          `<div class="stat-card"><div class="k">${k}</div><div class="v">${v}</div></div>`,
      )
      .join("");

    $("#repTableBody").innerHTML = reports.length
      ? reports
          .map(
            (r) => `
      <tr>
        <td><div class="cell-name">${r.reportedBy?.name || "—"}</div><div class="cell-sub">${r.reportedBy?.role || ""}</div></td>
        <td>${r.subject}</td>
        <td>${fmtDate(r.createdAt)}</td>
        <td>${reportStatusPill(r.status)}</td>
        <td><button class="btn btn-secondary btn-sm" data-open-report="${r.reportId}">View</button></td>
      </tr>`,
          )
          .join("")
      : `<tr><td colspan="5" class="empty-row">No reports found.</td></tr>`;

    renderPagination($("#repPagination"), pagination, (p) => {
      REP_STATE.page = p;
      loadReports();
    });
  } catch (err) {
    toast("Couldn't load reports", err.message, true);
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-open-report]");
  if (el) openReportDetail(el.dataset.openReport);
});
$("#repStatusFilter").addEventListener("change", (e) => {
  REP_STATE.status = e.target.value;
  REP_STATE.page = 1;
  loadReports();
});

async function openReportDetail(reportId) {
  showView("reportDetail");
  try {
    const res = await apiGet(ENDPOINTS.reportDetails(reportId));
    const r = res.data;

    let actionHtml = "";
    if (r.status === "pending")
      actionHtml = `<button class="btn btn-primary" id="rdReviewBtn">Move to Review</button>`;
    else if (r.status === "inreview")
      actionHtml = `<button class="btn btn-primary" id="rdResolveBtn">Resolve</button>`;
    else actionHtml = `<span class="pill resolved">Resolved</span>`;

    $("#rdCard").innerHTML = `
      <div class="detail-head">
        <div><h2>${r.role === "doctor" ? "Dr. " : ""}${r.reporter || "—"}</h2><p class="sub">${r.email || ""} · ${r.role}</p></div>
        ${reportStatusPill(r.status)}
      </div>
      <div class="field-grid">
        <div><div class="fk">Report ID</div><div class="fv">${reportId}</div></div>
        <div><div class="fk">Date</div><div class="fv">${fmtDate(r.createdAt)}</div></div>
      </div>
      <div style="margin-top:18px;">
        <div class="fk" style="margin-bottom:6px;">Description</div>
        <p style="line-height:1.6;">${r.message}</p>
      </div>
      ${r.resolution ? `<div style="margin-top:18px;"><div class="fk" style="margin-bottom:6px;">Resolution</div><p style="line-height:1.6;">${r.resolution}</p></div>` : ""}
      <div class="modal-foot" style="justify-content:flex-start; margin-top:22px;">${actionHtml}</div>`;

    if ($("#rdReviewBtn"))
      $("#rdReviewBtn").onclick = async () => {
        try {
          await apiPatch(ENDPOINTS.reportReview(reportId));
          toast("Moved to review");
          openReportDetail(reportId);
        } catch (err) {
          toast("Action failed", err.message, true);
        }
      };
    if ($("#rdResolveBtn"))
      $("#rdResolveBtn").onclick = () => {
        confirmModal({
          title: "Resolve this report",
          body: "Describe how this was resolved.",
          confirmText: "Resolve",
          extraFieldHtml: `<div class="field" style="width:100%; margin-top:14px;"><label>Resolution</label><textarea id="resolutionText" rows="3" style="width:100%; padding:10px; border:1px solid var(--line); border-radius:8px;"></textarea></div>`,
          onConfirm: async () => {
            const resolution = $("#resolutionText").value.trim();
            if (!resolution) return toast("Enter a resolution", "", true);
            try {
              await apiPatch(ENDPOINTS.reportResolve(reportId), { resolution });
              closeModal();
              toast("Report resolved");
              openReportDetail(reportId);
            } catch (err) {
              toast("Action failed", err.message, true);
            }
          },
        });
      };
  } catch (err) {
    toast("Couldn't load report", err.message, true);
  }
}

/* ================= ADMIN PROFILE ================= */
async function loadProfile() {
  try {
    const res = await apiGet(ENDPOINTS.profile());
    const p = res.data;
    ADMIN.fullname = p.fullname;
    ADMIN.email = p.email;
    ADMIN.phone = p.phone;
    ADMIN.status = p.status;
    syncTopbarIdentity();

    $("#profName").textContent = p.fullname;
    $("#profStatus").textContent =
      p.status === "active"
        ? "Active administrator account"
        : "Inactive account";
    $("#profGrid").innerHTML = [
      ["Admin ID", p.adminId],
      ["Email", p.email],
    ]
      .map(
        ([k, v]) =>
          `<div><div class="fk">${k}</div><div class="fv">${v}</div></div>`,
      )
      .join("");
    $("#profFullname").value = p.fullname || "";
    $("#profPhone").value = p.phone || "";
  } catch (err) {
    toast("Couldn't load profile", err.message, true);
  }
}
$("#profForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    await apiPatch(ENDPOINTS.profile(), {
      fullname: $("#profFullname").value.trim(),
      phone: $("#profPhone").value.trim(),
    });
    toast("Profile updated");
    loadProfile();
  } catch (err) {
    toast("Couldn't update profile", err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save changes";
  }
});
$("#pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Updating…";
  try {
    await apiPatch(ENDPOINTS.password(), {
      currentPassword: $("#pwCurrent").value,
      newPassword: $("#pwNew").value,
    });
    toast("Password updated");
    e.target.reset();
  } catch (err) {
    toast("Couldn't update password", err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Update password";
  }
});

function syncTopbarIdentity() {
  $("#topName").textContent = ADMIN.fullname || "Admin";
}

/* ---------- LOGOUT ---------- */
$("#logoutBtn").addEventListener("click", async () => {
  try {
    await apiCall(ENDPOINTS.logout(), { method: "POST" });
  } catch (err) {
    console.warn("Logout request failed, redirecting anyway:", err.message);
  }
  window.location.href = LOGIN_PATH;
});

/* ---------- INIT ---------- */
async function init() {
  try {
    const res = await apiGet(ENDPOINTS.me());
    ADMIN.fullname = res.data.fullname;
    ADMIN.email = res.data.email;
    syncTopbarIdentity();
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      window.location.href = LOGIN_PATH;
      return;
    }
    toast("Couldn't verify session", err.message, true);
  }
  const hash = location.hash.replace("#", "");
  showView(TITLES[hash] ? hash : "overview");
}
init();
