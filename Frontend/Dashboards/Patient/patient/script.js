/* ============================================================
   ClinicFlow — Patient Dashboard (behavior)
   ============================================================ */
(function () {
  const CFG = window.CLINICFLOW_CONFIG || {};
  const API_BASE = "http://localhost:8000";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const initials = (n) =>
    (n || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  /* ---------------- STATE ---------------- */
  const STATE = {
    user: {
      fullname: "",
      email: "",
      phone: "",
      dob: "",
      bloodGroup: "",
      gender: "",
      emergency: "",
      patientId: "",
    },
    doctors: [],
    appointments: [],
    notifications: [],
    reports: [],
  };
  const activeAppts = () =>
    STATE.appointments
      .filter((a) => a.status === "waiting" || a.status === "in-progress")
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "in-progress" ? -1 : 1;
        const aheadA = a.queue?.patientsAhead ?? 999;
        const aheadB = b.queue?.patientsAhead ?? 999;
        if (aheadA !== aheadB) return aheadA - aheadB;
        return new Date(a.date) - new Date(b.date);
      });

  const activeAppt = () => activeAppts()[0];

  function mapAppointment(a) {
    const doc = a.doctor || {};
    const docUser = doc.user || {};
    const dt = a.appointmentDate ? new Date(a.appointmentDate) : null;
    const q = a.queue;

    const dateISO = dt
      ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
          dt.getDate(),
        ).padStart(2, "0")}`
      : "";

    return {
      _id: a._id,
      id: a.appointmentId || a._id,
      doctorId: doc._id || null,
      patient: a.patientName,
      bookedBy: a.bookedBy?.fullname || "",
      doctor: docUser.fullname || "Doctor",
      spec: doc.specialization || "",
      clinic: doc.clinicName || "",
      address: doc.clinicAddress || "",
      date: dt
        ? dt.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "—",
      dateISO,
      fee: doc.consultationFee || 0,
      token: a.tokenNumber,
      status: a.status,
      note: a.note || "",
      queue: q
        ? {
            nowServing: q.nowServing ?? null,
            patientsAhead: q.patientsAhead ?? 0,
            wait: q.estimatedWaitMinutes ?? 0,
            clinicStatus: q.isActive ? "active" : "not-started",
          }
        : null,
    };
  }

  function mapDoctor(d) {
    const u = d.user || {};
    return {
      id: d._id,
      name: u.fullname || "Doctor",
      spec: d.specialization || "",
      clinic: d.clinicName || "",
      area: d.clinicAddress || "",
      fee: d.consultationFee || 0,
    };
  }

  /* ---------------- LOADERS ---------------- */
  async function loadUser() {
    let userRes;
    try {
      userRes = await fetch(API_BASE + "/patient/me", {
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
    } catch (networkErr) {
      throw new Error("Could not reach the server. Check your connection.");
    }

    if (userRes.status === 401) {
      window.location.href = "../../../Auth/login/login.html";
      throw new Error("Session expired. Please log in again.");
    }

    let userJson = null;
    try {
      userJson = await userRes.json();
    } catch {
      /* empty body */
    }

    if (!userRes.ok) {
      throw new Error(
        userJson?.message || `Request failed (${userRes.status})`,
      );
    }

    const user = userJson?.data || {};
    STATE.user.fullname = user.fullname || "";
    STATE.user.email = user.email || "";
    STATE.user.phone = user.phone || "";

    applyPatientProfile(user.profile);
  }

  function applyPatientProfile(patient) {
    if (!patient) return;
    STATE.user.patientId = patient.patientId || STATE.user.patientId;
    STATE.user.bloodGroup = patient.bloodGroup || STATE.user.bloodGroup;
    STATE.user.gender = patient.gender || STATE.user.gender;
    STATE.user.dob = patient.dateOfBirth
      ? new Date(patient.dateOfBirth).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : STATE.user.dob;
    if (patient.user?.fullname) STATE.user.fullname = patient.user.fullname;
    if (patient.user?.email) STATE.user.email = patient.user.email;
    if (patient.user?.phone) STATE.user.phone = patient.user.phone;
  }

  async function loadAppointments() {
    let res;
    try {
      res = await fetch(API_BASE + "/appointments/patient", {
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
    } catch (networkErr) {
      throw new Error("Could not reach the server. Check your connection.");
    }

    if (res.status === 401) {
      window.location.href = "../../../Auth/login/login.html";
      throw new Error("Session expired. Please log in again.");
    }

    let json = null;
    try {
      json = await res.json();
    } catch {
      /* empty body */
    }

    if (!res.ok) {
      throw new Error(json?.message || `Request failed (${res.status})`);
    }

    STATE.appointments = (json?.data || []).map(mapAppointment);
  }

  async function loadDoctors() {
    try {
      let res;
      try {
        res = await fetch(API_BASE + "/doctor", {
          method: "GET",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
      } catch (networkErr) {
        throw new Error("Could not reach the server. Check your connection.");
      }

      if (res.status === 401) {
        window.location.href = "../../../Auth/login/login.html";
        throw new Error("Session expired. Please log in again.");
      }

      let json = null;
      try {
        json = await res.json();
      } catch {
        /* empty body */
      }

      if (!res.ok) {
        throw new Error(json?.message || `Request failed (${res.status})`);
      }

      STATE.doctors = (json?.data || []).map(mapDoctor);
    } catch (err) {
      console.warn("GET /doctors failed:", err.message);
      STATE.doctors = [];
    }
  }

  async function loadMyReports() {
    try {
      let res;
      try {
        res = await fetch(API_BASE + "/support/report/me", {
          method: "GET",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
      } catch (networkErr) {
        throw new Error("Could not reach the server. Check your connection.");
      }

      if (res.status === 401) {
        window.location.href = "../../../Auth/login/login.html";
        throw new Error("Session expired. Please log in again.");
      }

      let json = null;
      try {
        json = await res.json();
      } catch {
        /* empty body */
      }

      if (!res.ok) {
        throw new Error(json?.message || `Request failed (${res.status})`);
      }

      STATE.reports = json?.data || [];
    } catch (err) {
      console.warn("GET /support/report/me failed:", err.message);
      STATE.reports = [];
    }
  }

  /* ---------------- ROUTER ---------------- */
  const TITLES = {
    overview: "Overview",
    appointments: "My Appointments",
    queue: "Queue",
    profile: "Profile",
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
    if (location.hash !== "#" + name)
      history.replaceState(null, "", "#" + name);
    if (name === "queue") renderQueue();
    if (name === "profile") renderProfile();
    if (name === "help") {
      renderMyReports();
      loadMyReports().then(renderMyReports);
    }
    window.scrollTo(0, 0);
  }
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-view]");
    if (el) {
      e.preventDefault();
      showView(el.dataset.view);
    }
    const bk = e.target.closest("[data-book]");
    if (bk) {
      e.preventDefault();
      openBooking();
    }
  });

  /* ---------------- OVERVIEW ---------------- */
  function renderOverview() {
    const u = STATE.user;
    $("#greeting").textContent = `${greetWord()}, ${u.fullname || ""}`;
    const actives = activeAppts();
    const wrap = $("#upcomingWrap");

    if (!actives.length) {
      wrap.innerHTML = `<div class="card empty-state">
      <div class="ei"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2v4M16 2v4" stroke-linecap="round"/></svg></div>
      <h3>No upcoming appointments</h3><p>Book an appointment with a doctor to get started.</p>
      <button class="btn btn-primary" data-book>Book New Appointment</button></div>`;
    } else {
      const [primary, ...others] = actives;
      const pq = primary.queue || {
        nowServing: null,
        patientsAhead: 0,
        wait: 0,
      };

      const primaryCard = `
    <div class="section-label">Current appointment</div>
    <div class="card upcoming">
      <div class="uc-top">
        <div>
          <div class="clinic-eyebrow">${primary.clinic}</div>
          <h2>${primary.doctor}</h2>
          <div class="spec">${primary.spec}</div>
          <div class="meta">${primary.date} · Patient: <b>${primary.patient}</b></div>
        </div>
        <span class="pill ${primary.status}"><span class="d"></span> ${cap(primary.status)}</span>
      </div>
      <div class="metric-row">
        <div class="m"><div class="mk">Your token</div><div class="mv blue">#${primary.token}</div></div>
        <div class="m"><div class="mk">Current token</div><div class="mv">${pq.nowServing ? "#" + pq.nowServing : "—"}</div></div>
        <div class="m"><div class="mk">Patients ahead</div><div class="mv">${pq.patientsAhead}</div></div>
        <div class="m"><div class="mk">Estimated wait</div><div class="mv">~${pq.wait} min</div></div>
      </div>
      <div class="queue-label">Queue position</div>
      ${
        queueStatusLine(primary)
          ? `<div style="margin:0 0 14px;font-size:13.5px;color:var(--sub);background:var(--blue-tint);border:1px solid var(--line);border-radius:10px;padding:10px 14px;">${queueStatusLine(primary)}</div>`
          : ""
      }
      <div class="chips">${chipTrack(primary)}</div>
      <div class="uc-actions">
        <button class="btn btn-primary" data-view="queue">View Queue</button>
        <button class="btn btn-ghost" data-details="${primary.id}">View Details</button>
      </div>
    </div>`;

      const otherCards = others.length
        ? `
    <div class="section-label" style="margin-top:24px">Other active appointments</div>
    ${others
      .map((o) => {
        const oq = o.queue || { nowServing: null, patientsAhead: 0, wait: 0 };
        return `
    <div class="card upcoming" style="margin-bottom:16px">
      <div class="uc-top">
        <div>
          <div class="clinic-eyebrow">${o.clinic}</div>
          <h2 style="font-size:20px">${o.doctor}</h2>
          <div class="spec">${o.spec}</div>
          <div class="meta">${o.date} · Patient: <b>${o.patient}</b></div>
        </div>
        <span class="pill ${o.status}"><span class="d"></span> ${cap(o.status)}</span>
      </div>
      <div class="metric-row">
        <div class="m"><div class="mk">Your token</div><div class="mv blue">#${o.token}</div></div>
        <div class="m"><div class="mk">Current token</div><div class="mv">${oq.nowServing ? "#" + oq.nowServing : "—"}</div></div>
        <div class="m"><div class="mk">Patients ahead</div><div class="mv">${oq.patientsAhead}</div></div>
        <div class="m"><div class="mk">Estimated wait</div><div class="mv">~${oq.wait} min</div></div>
      </div>
      <div class="uc-actions">
        <button class="btn btn-ghost" data-details="${o.id}">View Details</button>
      </div>
    </div>`;
      })
      .join("")}`
        : "";

      wrap.innerHTML = primaryCard + otherCards;
    }
    const recentHistory = $("#recentHistory");

    if (!STATE.appointments || STATE.appointments.length === 0) {
      recentHistory.innerHTML = `
    <div class="empty-history">
      <h3>No appointment history</h3>
      <p>You don't have any previous appointments yet.</p>
      <button class="btn btn-primary" data-book>
        Book New Appointment
      </button>
    </div>
  `;
    } else {
      recentHistory.innerHTML = STATE.appointments
        .slice(0, 4)
        .map(
          (a) => `
        <div class="hrow" data-details="${a.id}" style="cursor:pointer">
          <div>
            <div class="dn">${a.doctor}</div>
            <div class="dsub">
              ${a.patient} · ${a.date}
            </div>
          </div>

          <span class="pill ${a.status}">
            <span class="d"></span>
            ${cap(a.status)}
          </span>
        </div>
      `,
        )
        .join("");
    }
  }

  function chipTrack(a) {
    const q = a.queue || { nowServing: null, patientsAhead: 0 };
    const you = a.token;
    const serving = q.nowServing && q.nowServing > 0 ? q.nowServing : null;

    if (serving === null) {
      return `<span class="chip you">YOU #${you}</span>`;
    }

    const out = [];
    const start = Math.max(serving, you - 3, 1);
    for (let n = start; n <= you; n++) {
      if (n === serving) out.push(`<span class="chip serving">#${n}</span>`);
      else if (n === you) out.push(`<span class="chip you">YOU #${n}</span>`);
      else out.push(`<span class="chip">#${n}</span>`);
      if (n < you) out.push(`<span class="chip-arrow">→</span>`);
    }
    return out.join("");
  }

  function queueStatusLine(a) {
    const q = a.queue || {
      nowServing: null,
      patientsAhead: 0,
      clinicStatus: "not-started",
    };
    const clinicActive = q.clinicStatus === "active";
    const isFirst = a.token === 1 || q.patientsAhead === 0;

    if (!clinicActive) {
      return isFirst
        ? "The clinic is currently closed. You are first in the queue."
        : "The clinic is currently closed.";
    }

    if (q.nowServing && q.nowServing === a.token) {
      return "You are currently being seen by the doctor.";
    }

    if (isFirst) {
      return "You are next. Please be ready.";
    }

    return "";
  }

  /* ---------------- MY APPOINTMENTS ---------------- */
  let apptFilter = "all",
    apptDateFilter = "";
  function renderAppointments() {
    let list = STATE.appointments.slice();
    if (apptFilter === "upcoming")
      list = list.filter((a) => ["waiting", "in-progress"].includes(a.status));
    else if (apptFilter === "completed")
      list = list.filter((a) => a.status === "completed");
    else if (apptFilter === "cancelled")
      list = list.filter((a) => a.status === "cancelled");
    if (apptDateFilter) list = list.filter((a) => a.dateISO === apptDateFilter);

    const box = $("#apptList");
    if (!list.length) {
      box.innerHTML = `<div class="card empty-state"><h3>No appointments</h3><p>Nothing matches this filter yet.</p></div>`;
      return;
    }

    box.innerHTML = list
      .map((a) => {
        const active = ["waiting", "in-progress"].includes(a.status);
        const metrics = active
          ? `
      <div class="appt-metrics">
        <div><div class="mk">Your token</div><div class="mv blue">#${a.token}</div></div>
        <div><div class="mk">Current token</div><div class="mv">${a.queue?.nowServing ? "#" + a.queue.nowServing : "—"}</div></div>
        <div><div class="mk">Patients ahead</div><div class="mv">${a.queue?.patientsAhead ?? "—"}</div></div>
        <div><div class="mk">Est. wait</div><div class="mv">~${a.queue?.wait ?? "—"} min</div></div>
      </div>`
          : a.note
            ? `<div class="appt-note">${a.note}</div>`
            : "";
        return `<div class="card appt-card clickable" data-details="${a.id}">
      <div class="appt-top">
        <div class="appt-patient"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" stroke-linecap="round"/></svg> ${a.patient}</div>
        <span class="pill ${a.status}"><span class="d"></span> ${cap(a.status)}</span>
      </div>
      <h3>${a.doctor}</h3><div class="spec">${a.spec}</div>
      <div class="appt-meta">
        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.2-7-11a7 7 0 0 1 14 0c0 5.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg> ${a.clinic}</span>
        <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M3 9h18M8 2v4M16 2v4" stroke-linecap="round"/></svg> ${a.date}</span>
      </div>${metrics}
    </div>`;
      })
      .join("");
  }
  $("#apptTabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (!t) return;
    $$("#apptTabs .tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    apptFilter = t.dataset.filter;
    renderAppointments();
  });
  $("#apptDate").addEventListener("change", (e) => {
    apptDateFilter = e.target.value;
    renderAppointments();
  });

  /* ---------------- QUEUE ---------------- */
  function renderQueue() {
    const a = activeAppt();
    const cards = $$(".q-card");
    if (!a) {
      $("#qMetrics").innerHTML = "";
      $("#qStepper").innerHTML = "";
      $("#queueSub").textContent = "No active appointment";
      $("#qStatus").textContent = "—";
      if (cards[0]) {
        cards[0].innerHTML = `<div class="empty-state">
        <div class="ei"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke-linecap="round"/></svg></div>
        <h3>No active queue</h3><p>You don't have a waiting or in-progress appointment right now.</p>
        <button class="btn btn-primary" data-book>Book New Appointment</button></div>`;
      }
      if (cards[1]) cards[1].hidden = true;
      return;
    }
    if (cards[0]) {
      cards[0].innerHTML = `
    <div class="section-label">Queue progress</div>
    <div id="qMsg" style="margin:0 0 14px;font-size:13.5px;color:var(--sub);background:var(--blue-tint);border:1px solid var(--line);border-radius:10px;padding:10px 14px;display:none;"></div>
    <div class="chips" id="qChips"></div>
    <div class="q-progress-rows" id="qRows"></div>`;
    }
    if (cards[1]) cards[1].hidden = false;
    const q = a.queue || {
      nowServing: null,
      patientsAhead: 0,
      wait: 0,
      clinicStatus: "not-started",
    };
    $("#queueSub").textContent = `${a.doctor} · ${a.clinic} · ${a.date}`;
    $("#qStatus").textContent =
      q.clinicStatus === "active" ? "Queue is active" : "Clinic is closed";
    $("#qMetrics").innerHTML = `
    <div class="q-metric"><div class="mk">Now serving</div><div class="mv blue">${q.nowServing ? "#" + q.nowServing : "—"}</div></div>
    <div class="q-metric"><div class="mk">Your token</div><div class="mv">#${a.token}</div></div>
    <div class="q-metric"><div class="mk">Patients ahead</div><div class="mv">${q.patientsAhead}</div></div>
    <div class="q-metric"><div class="mk">Estimated wait</div><div class="mv">~${q.wait} min</div></div>`;
    $("#qChips").innerHTML = chipTrack(a);

    const msgEl = $("#qMsg");
    const msg = queueStatusLine(a);
    if (msgEl) {
      msgEl.textContent = msg;
      msgEl.style.display = msg ? "block" : "none";
    }

    const serving = q.nowServing && q.nowServing > 0 ? q.nowServing : null;
    let rows = "";
    if (serving === null) {
      const label = a.token === 1 ? "You're first in line" : "Waiting";
      const right =
        q.clinicStatus === "active" ? "In queue" : "Clinic not open yet";
      rows = `<div class="qp-row you">
      <span class="qp-tok you">#${a.token}</span>
      <span class="qp-label">${label}</span>
      <span class="qp-right">${right}</span></div>`;
    } else {
      const start = Math.max(serving, 1);
      for (let n = start; n <= a.token; n++) {
        const isYou = n === a.token,
          isServing = n === serving;
        const tokCls = isServing ? "serving" : isYou ? "you" : "";
        const label = isServing
          ? "Currently being seen"
          : isYou
            ? "Your token"
            : "Waiting";
        const right = isServing
          ? "In progress"
          : isYou
            ? `~${q.wait} min`
            : "In queue";
        rows += `<div class="qp-row ${isYou ? "you" : ""}">
      <span class="qp-tok ${tokCls}">#${n}</span>
      <span class="qp-label">${label}</span>
      <span class="qp-right">${right}</span></div>`;
      }
    }
    $("#qRows").innerHTML = rows;
    $("#qStepper").innerHTML = stepperHTML(a.status);
  }

  const STEPS = ["Waiting", "In Progress", "Completed"];
  function stepIndex(status) {
    return (
      { waiting: 0, "in-progress": 1, completed: 2, cancelled: 0 }[status] ?? 0
    );
  }
  function stepperHTML(status) {
    if (status === "cancelled") {
      return `<div class="step"><div class="node">✕</div><div class="slabel">Cancelled</div></div>`;
    }
    const idx = stepIndex(status);
    return STEPS.map((s, i) => {
      const cls = i < idx ? "done" : i === idx ? "active" : "";
      const node = i < idx ? "✓" : i + 1;
      return `<div class="step ${cls}"><div class="node">${node}</div><div class="slabel">${s}</div></div>`;
    }).join("");
  }

  /* ---------------- PROFILE ---------------- */
  function renderProfile() {
    const u = STATE.user;

    $("#profileCard").innerHTML = `
    <div class="pc-head">
      <div>
        <div class="pn">${u.fullname}</div>
        <div class="pe">${u.email}</div>
      </div>

      <div class="pc-stats">
        <div>
          <div class="sk">Appointments</div>
          <div class="sv">${STATE.appointments.length}</div>
        </div>

        <div>
          <div class="sk">Blood group</div>
          <div class="sv blood">${u.bloodGroup || "—"}</div>
        </div>
      </div>
    </div>

    <div class="pc-grid">
      <div class="pc-field">
        <div class="fk">Full name</div>
        <div class="fv">${u.fullname}</div>
      </div>

      <div class="pc-field">
        <div class="fk">Email</div>
        <div class="fv">${u.email} <button type="button" class="change-email-btn" data-change-email>Change</button></div>
      </div>

      <div class="pc-field">
        <div class="fk">Phone</div>
        <div class="fv">${u.phone || "—"}</div>
      </div>

      <div class="pc-field">
        <div class="fk">Date of birth</div>
        <div class="fv">${u.dob || "—"}</div>
      </div>

      <div class="pc-field">
        <div class="fk">Gender</div>
        <div class="fv">${u.gender ? cap(u.gender) : "—"}</div>
      </div>

      <div class="pc-field">
        <div class="fk">Patient ID</div>
        <div class="fv">${u.patientId || "—"}</div>
      </div>
    </div>
  `;
  }

  $("#editProfileBtn").addEventListener("click", () => {
    const u = STATE.user;

    $("#editForm").innerHTML = `
    <div class="field" style="margin-bottom:16px">
      <label>Full name</label>
      <input
        name="fullname"
        value="${u.fullname || ""}"
      >
    </div>

    <div class="field" style="margin-bottom:16px">
      <label>Phone</label>
      <input
        name="phone"
        value="${u.phone || ""}"
      >
    </div>

    <div class="field" style="margin-bottom:16px">
      <label>Date of birth</label>
      <input
        type="date"
        name="dateOfBirth"
        value="${u.dob || ""}"
      >
    </div>

    <div class="field" style="margin-bottom:16px">
      <label>Gender</label>
      <select name="gender">
        <option value="">Select gender</option>
        <option value="male" ${u.gender === "male" ? "selected" : ""}>
          Male
        </option>
        <option value="female" ${u.gender === "female" ? "selected" : ""}>
          Female
        </option>
        <option value="other" ${u.gender === "other" ? "selected" : ""}>
          Other
        </option>
      </select>
    </div>

    <div class="field" style="margin-bottom:22px">
      <label>Blood group</label>
      <select name="bloodGroup">
        ${["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
          .map(
            (b) =>
              `<option ${b === u.bloodGroup ? "selected" : ""}>${b}</option>`,
          )
          .join("")}
      </select>
    </div>

    <div class="wfoot" style="border:none;padding:0;margin:0">
      <button type="button" class="link-btn" id="editCancel">
        Cancel
      </button>

      <button type="submit" class="btn btn-primary">
        Save changes
      </button>
    </div>
  `;

    $("#editOverlay").classList.add("open");

    $("#editCancel").onclick = () => $("#editOverlay").classList.remove("open");
  });

  $("#editClose").addEventListener("click", () =>
    $("#editOverlay").classList.remove("open"),
  );

  $("#editForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const fd = new FormData(e.target);

    const payload = {
      fullname: fd.get("fullname"),
      phone: fd.get("phone"),
      dateOfBirth: fd.get("dateOfBirth"),
      gender: fd.get("gender"),
      bloodGroup: fd.get("bloodGroup"),
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    try {
      let res;

      try {
        res = await fetch(API_BASE + "/patient/profile", {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch (networkErr) {
        throw new Error("Could not reach the server. Check your connection.");
      }

      if (res.status === 401) {
        window.location.href = "../../../Auth/login/login.html";

        throw new Error("Session expired. Please log in again.");
      }

      let json = null;

      try {
        json = await res.json();
      } catch {
        // Empty response body
      }

      if (!res.ok) {
        throw new Error(json?.message || `Request failed (${res.status})`);
      }

      applyPatientProfile(json?.data);

      $("#editOverlay").classList.remove("open");

      renderProfile();
      syncUserChrome();

      toast("Profile updated successfully.");
    } catch (err) {
      toast("Couldn't update profile", err.message, true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save changes";
    }
  });

  /* ---------------- BOOKING WIZARD ---------------- */
  const book = {
    step: 1,
    forWhom: "self",
    patientName: "",
    patientPhone: "",
    doctor: null,
    date: "",
  };

  async function loadDoctors() {
    try {
      const res = await fetch(API_BASE + "/doctor/getalldoctors", {
        method: "GET",
        credentials: "include",
      });

      if (res.status === 401) {
        window.location.href = "../../../Auth/login/login.html";
        throw new Error("Session expired. Please log in again.");
      }

      let json = null;

      try {
        json = await res.json();
      } catch {
        throw new Error("Invalid server response.");
      }

      if (!res.ok) {
        throw new Error(json?.message || `Request failed (${res.status})`);
      }

      const doctors = json?.data?.doctors || json?.data || [];

      STATE.doctors = doctors.map((doctor) => ({
        id: doctor._id || doctor.id,
        doctorId: doctor.doctorId,
        name: doctor.user?.fullname || doctor.fullname || "Unknown Doctor",
        spec: doctor.specialization || "—",
        clinic: doctor.clinicName || "—",
        area: doctor.clinicAddress || "—",
        fee: Number(doctor.consultationFee || 0),
      }));

      return STATE.doctors;
    } catch (error) {
      STATE.doctors = [];

      toast("Unable to load doctors", error.message, true);

      return [];
    }
  }

  async function openBooking() {
    book.step = 1;
    book.forWhom = "self";
    book.patientName = STATE.user.fullname;
    book.doctor = null;
    book.date = "";

    $("#bookOverlay").classList.add("open");

    renderWizard();

    if (!STATE.doctors.length) {
      await loadDoctors();
      renderWizard();
    }
  }

  $("#bookClose").addEventListener("click", () => {
    $("#bookOverlay").classList.remove("open");
  });

  $("#bookOverlay").addEventListener("click", (e) => {
    if (e.target.id === "bookOverlay") {
      $("#bookOverlay").classList.remove("open");
    }
  });

  function renderWizard() {
    $$("#wsteps .wstep").forEach((s) => {
      const n = Number(s.dataset.s);

      s.classList.toggle("active", n === book.step);

      s.classList.toggle("done", n < book.step);

      s.querySelector(".num").innerHTML = n < book.step ? "✓" : n;
    });

    const body = $("#wbody");
    const foot = $("#wfoot");

    if (book.step === 1) {
      body.innerHTML = `
      <h3>Who is this appointment for?</h3>

      <div class="who-grid">

        <div
          class="who-opt ${book.forWhom === "self" ? "sel" : ""}"
          data-who="self"
        >
          <span class="radio"></span>

          <div>
            <div class="wt">
              Book for Myself
            </div>

            <div class="ws">
              ${STATE.user.fullname}
            </div>
          </div>
        </div>

        <div
          class="who-opt ${book.forWhom === "other" ? "sel" : ""}"
          data-who="other"
        >
          <span class="radio"></span>

          <div>
            <div class="wt">
              Book for Someone Else
            </div>

            <div class="ws">
              Family member, child, parent
            </div>
          </div>
        </div>

      </div>

      <div class="field">

        <label>
          Patient name
        </label>

        <input
          id="wPatient"
          value="${book.patientName}"
          placeholder="Enter patient name"
        />

        <div class="hint">
          Booked by ${STATE.user.fullname}.
          The patient name can be edited.
        </div>

      </div>

      ${
        book.forWhom === "other"
          ? `
      <div class="field" style="margin-top:16px">
        <label>
          Patient phone number
        </label>

        <input
          id="wPatientPhone"
          value="${book.patientPhone}"
          placeholder="03XXXXXXXXX"
        />

        <div class="hint">
          Used to tell them apart from other patients with the same name.
        </div>
      </div>`
          : ""
      }
    `;

      foot.innerHTML = `
      <button
        class="link-btn"
        id="wCancel"
      >
        Cancel
      </button>

      <button
        class="btn btn-primary"
        id="wNext"
      >
        Continue
      </button>
    `;

      $$(".who-opt", body).forEach((option) => {
        option.onclick = () => {
          book.forWhom = option.dataset.who;

          if (book.forWhom === "self") {
            book.patientName = STATE.user.fullname;
          } else {
            book.patientName = "";
          }

          renderWizard();
        };
      });

      $("#wPatient").oninput = (e) => {
        book.patientName = e.target.value;
      };

      const phoneInput = $("#wPatientPhone");
      if (phoneInput) {
        phoneInput.oninput = (e) => {
          book.patientPhone = e.target.value;
        };
      }

      $("#wCancel").onclick = () => {
        $("#bookOverlay").classList.remove("open");
      };

      $("#wNext").onclick = () => {
        if (!book.patientName.trim()) {
          return toast("Enter a patient name.", "", true);
        }
        if (book.forWhom === "other" && !book.patientPhone.trim()) {
          return toast("Enter the patient's phone number.", "", true);
        }

        book.patientName = book.patientName.trim();
        book.patientPhone = book.patientPhone.trim();

        book.step = 2;

        renderWizard();
      };
    } else if (book.step === 2) {
      body.innerHTML = STATE.doctors.length
        ? STATE.doctors
            .map(
              (d) => `
              <div
                class="doc-opt ${book.doctor?.id === d.id ? "sel" : ""}"
                data-doc="${d.id}"
              >

                <div>

                  <div class="dname">
                    ${d.name}
                  </div>

                  <div class="dspec">
                    ${d.spec}
                  </div>

                  <div class="dloc">
                    ${d.clinic}
                    —
                    ${d.area}
                  </div>

                </div>

                <div class="dfee">
                  PKR ${d.fee.toLocaleString()}
                </div>

              </div>
            `,
            )
            .join("")
        : `
          <div
            class="empty-state"
            style="padding:20px 0"
          >
            <p>
              No doctors available.
            </p>
          </div>
        `;

      foot.innerHTML = `
      <button
        class="wback"
        id="wBack"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="m15 18-6-6 6-6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>

        Back
      </button>

      <button
        class="btn btn-primary"
        id="wNext"
        ${book.doctor ? "" : "disabled"}
      >
        Continue
      </button>
    `;

      $$(".doc-opt", body).forEach((option) => {
        option.onclick = () => {
          book.doctor = STATE.doctors.find((d) => d.id === option.dataset.doc);

          renderWizard();
        };
      });

      $("#wBack").onclick = () => {
        book.step = 1;
        renderWizard();
      };

      $("#wNext").onclick = () => {
        if (!book.doctor) return;

        book.step = 3;

        renderWizard();
      };
    } else if (book.step === 3) {
      body.innerHTML = `
      <div
        class="field"
        style="margin-bottom:22px"
      >

        <label>
          Appointment date
        </label>

        <input
          type="date"
          id="wDate"
          value="${book.date}"
          min="${todayISO()}"
        />

      </div>
    `;

      foot.innerHTML = `
      <button
        class="wback"
        id="wBack"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="m15 18-6-6 6-6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>

        Back
      </button>

      <button
        class="btn btn-primary"
        id="wNext"
        ${book.date ? "" : "disabled"}
      >
        Continue
      </button>
    `;

      const dateInput = $("#wDate");

      dateInput.onchange = (e) => {
        const val = e.target.value;

        if (val && val < todayISO()) {
          toast(
            "Invalid date",
            "You can't book an appointment in the past.",
            true,
          );
          e.target.value = "";
          book.date = "";
          $("#wNext").disabled = true;
          return;
        }

        book.date = val;

        $("#wNext").disabled = !book.date;
      };

      $("#wBack").onclick = () => {
        book.step = 2;
        renderWizard();
      };

      $("#wNext").onclick = () => {
        if (!book.date) {
          return toast("Select an appointment date.", "", true);
        }

        if (book.date < todayISO()) {
          return toast(
            "Invalid date",
            "You can't book an appointment in the past.",
            true,
          );
        }

        book.step = 4;

        renderWizard();
      };
    } else if (book.step === 4) {
      const d = book.doctor;

      const dateNice = book.date ? niceDate(book.date) : "—";

      body.innerHTML = `
      <div class="review-row">
        <span class="rk">
          Patient
        </span>

        <span class="rv">
          ${book.patientName}
        </span>
      </div>

      <div class="review-row">
        <span class="rk">
          Booked by
        </span>

        <span class="rv">
          ${STATE.user.fullname}
        </span>
      </div>

      <div class="review-row">
        <span class="rk">
          Doctor
        </span>

        <span class="rv">
          ${d.name}
        </span>
      </div>

      <div class="review-row">
        <span class="rk">
          Specialization
        </span>

        <span class="rv">
          ${d.spec}
        </span>
      </div>

      <div class="review-row">
        <span class="rk">
          Clinic
        </span>

        <span class="rv">
          ${d.clinic}
          —
          ${d.area}
        </span>
      </div>

      <div class="review-row">
        <span class="rk">
          Appointment date
        </span>

        <span class="rv">
          ${dateNice}
        </span>
      </div>

      <div class="review-row">
        <span class="rk">
          Consultation fee
        </span>

        <span class="rv">
          PKR ${d.fee.toLocaleString()}
        </span>
      </div>

      <div class="review-row">
        <span class="rk">
          Token
        </span>

        <span class="rv">
          Assigned on confirmation
        </span>
      </div>
    `;

      foot.innerHTML = `
      <button
        class="wback"
        id="wBack"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path
            d="m15 18-6-6 6-6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>

        Back
      </button>

      <button
        class="btn btn-primary"
        id="wConfirm"
      >
        Confirm Appointment
      </button>
    `;

      $("#wBack").onclick = () => {
        book.step = 3;
        renderWizard();
      };

      $("#wConfirm").onclick = confirmBooking;
    }
  }

  // Fully self-contained overlay — built entirely in JS rather than
  // depending on any pre-existing HTML overlay markup. Reuses the
  // existing booking-wizard state (`book`) and renderWizard() so
  // "Change Date" / "Choose Another Doctor" are real actions, not
  // just decorative buttons.
  function showQueueFullModal(doctorName) {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:999;" +
      "display:flex;align-items:center;justify-content:center;padding:20px;";
    wrap.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:28px;text-align:center;font-family:inherit;box-shadow:0 20px 50px rgba(15,23,42,.2);">
      <div style="width:48px;height:48px;border-radius:50%;background:#FEF3C7;color:#92400E;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:22px;">⏳</div>
      <h3 style="margin:0 0 8px;font-size:19px;font-weight:700;">Today's queue is full</h3>
      <p style="color:#64748B;font-size:14.5px;margin:0 0 22px;line-height:1.5;">
        ${doctorName ? doctorName : "This doctor"} has reached the maximum number of appointments for today. Please choose another date or doctor.
      </p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button id="qfChangeDate" style="padding:11px 18px;border-radius:10px;border:1px solid #E9EDF2;background:#fff;font-weight:600;cursor:pointer;font-size:14px;">Change Date</button>
        <button id="qfChangeDoctor" style="padding:11px 18px;border-radius:10px;border:none;background:#2563EB;color:#fff;font-weight:600;cursor:pointer;font-size:14px;">Choose Another Doctor</button>
      </div>
    </div>`;
    document.body.appendChild(wrap);

    const close = () => wrap.remove();
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) close();
    });
    wrap.querySelector("#qfChangeDate").onclick = () => {
      close();
      book.step = 3; // back to date-picking; doctor stays selected
      renderWizard();
    };
    wrap.querySelector("#qfChangeDoctor").onclick = () => {
      close();
      book.step = 2; // back to doctor selection
      book.doctor = null;
      renderWizard();
    };
  }

  async function confirmBooking() {
    const d = book.doctor;
    const confirmBtn = $("#wConfirm");

    if (!d) {
      return toast("Please select a doctor.", "", true);
    }

    if (!book.date) {
      return toast("Please select an appointment date.", "", true);
    }

    if (book.date < todayISO()) {
      return toast(
        "Invalid date",
        "You can't book an appointment in the past.",
        true,
      );
    }

    if (!book.patientName.trim()) {
      return toast("Patient name is required.", "", true);
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = "Booking…";

    try {
      const payload = {
        doctorId: d.id,
        appointmentDate: new Date(`${book.date}T00:00:00`).toISOString(),

        bookFor: book.forWhom,

        ...(book.forWhom === "other"
          ? {
              patientName: book.patientName.trim(),
              patientPhone: book.patientPhone.trim(),
            }
          : {}),
      };

      let res;

      try {
        res = await fetch(API_BASE + "/appointments/book", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch (networkErr) {
        throw new Error("Could not reach the server. Check your connection.");
      }

      if (res.status === 401) {
        window.location.href = "../../../Auth/login/login.html";

        throw new Error("Session expired. Please log in again.");
      }

      let json = null;

      try {
        json = await res.json();
      } catch {
        throw new Error("Invalid server response.");
      }

      if (!res.ok) {
        throw new Error(json?.message || `Request failed (${res.status})`);
      }

      const resData = json?.data;

      $("#bookOverlay").classList.remove("open");

      toast(
        "Appointment confirmed",
        `Token #${resData?.queue?.yourToken ?? "—"} — ${d.name}, ${niceDate(
          book.date,
        )}.`,
      );

      await loadAppointments();
      syncQueueRooms();

      renderOverview();
      renderAppointments();

      book.step = 1;
      book.forWhom = "self";
      book.patientName = "";
      book.doctor = null;
      book.date = "";
    } catch (err) {
      // Detect the queue-full business condition by message text
      // (the backend throws a plain ApiError, no guaranteed
      // structured data.queueFull field) — matches on the phrase
      // the backend always includes. Real server/network errors
      // still fall through to the generic toast unchanged.
      if (/queue is full/i.test(err.message || "")) {
        $("#bookOverlay").classList.remove("open");
        showQueueFullModal(d?.name);
      } else {
        toast("Booking failed", err.message, true);
      }
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Confirm Appointment";
    }
  }
  /* ---------------- DETAILS SLIDE-OVER ---------------- */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-details]");
    if (el) {
      e.preventDefault();
      openDetails(el.dataset.details);
    }
  });
  function openDetails(id) {
    const a = STATE.appointments.find((x) => x.id === id);
    if (!a) return;
    const active = ["waiting", "in-progress"].includes(a.status);
    const live = active
      ? `
    <div class="so-sec-label">Live queue</div>
    <div class="so-live">
      <div><div class="lk">Your token</div><div class="lv blue">#${a.token}</div></div>
      <div><div class="lk">Current token</div><div class="lv">${a.queue?.nowServing ? "#" + a.queue.nowServing : "Not started"}</div></div>
      <div><div class="lk">Patients ahead</div><div class="lv">${a.queue?.patientsAhead ?? "—"}</div></div>
      <div><div class="lk">Estimated wait</div><div class="lv">~${a.queue?.wait ?? "—"} min</div></div>
    </div>`
      : "";
    const cancelBtn = active
      ? `<button class="btn btn-danger-ghost" data-cancel="${a._id}" style="margin-top:22px">Cancel appointment</button>`
      : "";
    $("#slideover").innerHTML = `
    <div class="so-head">
      <div class="so-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3v6a4 4 0 0 0 8 0V3M8 21a4 4 0 0 0 4-4v-4" stroke-linecap="round"/><circle cx="18" cy="17" r="3"/></svg> Appointment details</div>
      <button class="modal-close" id="soClose"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button>
    </div>
    <span class="pill ${a.status}" style="margin-bottom:18px"><span class="d"></span> ${cap(a.status)}</span>
    <div class="so-rows">
      <div class="so-row"><span class="k">Patient</span><span class="v">${a.patient}</span></div>
      <div class="so-row"><span class="k">Booked by</span><span class="v">${a.bookedBy}</span></div>
      <div class="so-row"><span class="k">Doctor</span><span class="v">${a.doctor}</span></div>
      <div class="so-row"><span class="k">Specialization</span><span class="v">${a.spec}</span></div>
      <div class="so-row"><span class="k">Clinic</span><span class="v">${a.clinic}</span></div>
      <div class="so-row"><span class="k">Clinic address</span><span class="v">${a.address}</span></div>
      <div class="so-row"><span class="k">Appointment date</span><span class="v">${a.date}</span></div>
      <div class="so-row"><span class="k">Consultation fee</span><span class="v">PKR ${a.fee.toLocaleString()}</span></div>
    </div>
    ${live}
    <div class="so-sec-label">Status</div>
    <div class="stepper">${stepperHTML(a.status)}</div>
    ${cancelBtn}`;
    $("#slideover").classList.add("open");
    $("#soBackdrop").classList.add("open");
    $("#soClose").onclick = closeDetails;
  }
  function closeDetails() {
    $("#slideover").classList.remove("open");
    $("#soBackdrop").classList.remove("open");
  }
  $("#soBackdrop").addEventListener("click", closeDetails);
  document.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-cancel]");
    if (c) {
      const btn = c;
      btn.disabled = true;
      btn.textContent = "Cancelling…";
      try {
        let res;
        try {
          res = await fetch(
            `${API_BASE}/appointments/${c.dataset.cancel}/cancel`,
            {
              method: "PATCH",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
            },
          );
        } catch (networkErr) {
          throw new Error("Could not reach the server. Check your connection.");
        }

        if (res.status === 401) {
          window.location.href = "../../../Auth/login/login.html";
          throw new Error("Session expired. Please log in again.");
        }

        let json = null;
        try {
          json = await res.json();
        } catch {
          /* empty body */
        }

        if (!res.ok) {
          throw new Error(json?.message || `Request failed (${res.status})`);
        }

        await loadAppointments();
        syncQueueRooms();
        closeDetails();
        renderOverview();
        renderAppointments();
        toast("Appointment cancelled", "Your appointment has been cancelled.");
      } catch (err) {
        toast("Couldn't cancel", err.message, true);
        btn.disabled = false;
        btn.textContent = "Cancel appointment";
      }
    }
  });

  /* ---------------- CHANGE EMAIL ---------------- */
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
        <div class="wfoot" style="border:none;padding:0;margin:0">
          <button type="button" class="link-btn" id="ecCancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="ecSubmit">Send Code</button>
        </div>`;

      form.onsubmit = async (e) => {
        e.preventDefault();
        const val = $("#ecEmail").value.trim();
        if (!val) return toast("Enter a new email address.", "", true);

        const btn = $("#ecSubmit");
        btn.disabled = true;
        btn.textContent = "Sending…";

        try {
          let res;
          try {
            res = await fetch(API_BASE + "/auth/email/request", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ newEmail: val }),
            });
          } catch (networkErr) {
            throw new Error(
              "Could not reach the server. Check your connection.",
            );
          }

          if (res.status === 401) {
            window.location.href = "../../../Auth/login/login.html";
            throw new Error("Session expired. Please log in again.");
          }

          let json = null;
          try {
            json = await res.json();
          } catch {
            /* empty body */
          }

          if (!res.ok) {
            throw new Error(json?.message || `Request failed (${res.status})`);
          }

          emailChange.newEmail = json?.data?.newEmail || val;
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
              <input
                class="otp-box"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="1"
                data-otp-i="${i}"
                autocomplete="one-time-code"
              >`,
            ).join("")}
          </div>
        </div>
        <div class="wfoot" style="border:none;padding:0;margin:0">
          <button type="button" class="wback" id="ecBack">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m15 18-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            Back
          </button>
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
          let res;
          try {
            res = await fetch(API_BASE + "/auth/email/verify", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ otp }),
            });
          } catch (networkErr) {
            throw new Error(
              "Could not reach the server. Check your connection.",
            );
          }

          if (res.status === 401) {
            window.location.href = "../../../Auth/login/login.html";
            throw new Error("Session expired. Please log in again.");
          }

          let json = null;
          try {
            json = await res.json();
          } catch {
            /* empty body */
          }

          if (!res.ok) {
            throw new Error(json?.message || `Request failed (${res.status})`);
          }

          STATE.user.email = json?.data?.email || emailChange.newEmail;
          $("#emailChangeOverlay").classList.remove("open");
          renderProfile();
          syncUserChrome();
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
  /* ---------------- DROPDOWNS ---------------- */
  function closeMenus() {
    $("#notifMenu").classList.remove("open");
    $("#userMenu").classList.remove("open");
  }
  $("#notifBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#userMenu").classList.remove("open");
    $("#notifMenu").classList.toggle("open");
    $("#notifDot").style.display = "none";
    STATE.notifications.forEach((n) => (n.read = true));
    renderNotifs();
  });
  $("#userBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#notifMenu").classList.remove("open");
    $("#userMenu").classList.toggle("open");
  });
  document.addEventListener("click", () => closeMenus());

  $("#notifMenu").addEventListener("click", (e) => e.stopPropagation());
  $("#userMenu").addEventListener("click", (e) => {
    const link = e.target.closest("[data-view]");
    if (link) {
      e.preventDefault();
      showView(link.dataset.view);
      return;
    }
    e.stopPropagation();
  });
  function renderNotifs() {
    if (!STATE.notifications.length) {
      $("#notifList").innerHTML =
        `<div class="notif-item read"><div><div class="nt">No notifications yet.</div></div></div>`;
      $("#notifDot").style.display = "none";
      return;
    }
    $("#notifList").innerHTML = STATE.notifications
      .map(
        (n) => `
    <div class="notif-item ${n.read ? "read" : ""}"><span class="nd"></span><div><div class="nt">${n.text}</div><div class="ntime">${n.time}</div></div></div>`,
      )
      .join("");
    $("#notifDot").style.display = STATE.notifications.some((n) => !n.read)
      ? "block"
      : "none";
  }

  /* ---------------- HELP FAQ ---------------- */
  const FAQS = [
    {
      q: "How is my token number assigned?",
      a: "Your token is issued automatically when your booking is confirmed — it's the next number in that doctor's queue for the day.",
    },
    {
      q: "Can I book an appointment for a family member?",
      a: 'Yes. Choose "Book for Someone Else" and enter their name. The appointment stays linked to your account, but the patient name is theirs.',
    },
    {
      q: "Why did my estimated wait time change?",
      a: "Wait time is recalculated live as the doctor calls each patient, and updates if the clinic reports a delay.",
    },
    {
      q: "How do I cancel an appointment?",
      a: 'Open the appointment from My Appointments and use "Cancel appointment". You can only cancel appointments that haven\'t started.',
    },
  ];
  function renderFAQ() {
    $("#faqList").innerHTML = FAQS.map(
      (f, i) => `
    <div class="faq-item" data-faq="${i}">
      <button class="faq-q">${f.q}<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="faq-a"><p>${f.a}</p></div></div>`,
    ).join("");
    $$("#faqList .faq-q").forEach(
      (q) =>
        (q.onclick = () => {
          const item = q.closest(".faq-item");
          const a = item.querySelector(".faq-a");
          const open = item.classList.contains("open");
          $$("#faqList .faq-item").forEach((it) => {
            it.classList.remove("open");
            it.querySelector(".faq-a").style.maxHeight = 0;
          });
          if (!open) {
            item.classList.add("open");
            a.style.maxHeight = a.scrollHeight + "px";
          }
        }),
    );
  }

  /* ---------------- MY REPORTS ---------------- */
  const REPORT_STATUS_STYLE = {
    open: { label: "Pending", bg: "#FEF3C7", fg: "#92400E" },
    reviewed: { label: "Under Review", bg: "#DBEAFE", fg: "#1D4ED8" },
    resolved: { label: "Resolved", bg: "#DCFCE7", fg: "#15803D" },
  };

  function renderMyReports() {
    const box = $("#myReportsList");
    if (!box) return;

    const countEl = $("#myReportsCount");
    if (countEl) countEl.textContent = STATE.reports.length;

    if (!STATE.reports.length) {
      box.innerHTML = `<div class="reports-empty">
        <p>You don't have any reports yet.</p>
      </div>`;
      return;
    }

    box.innerHTML = STATE.reports
      .map((r) => {
        const s = REPORT_STATUS_STYLE[r.status] || REPORT_STATUS_STYLE.open;
        const created = r.createdAt
          ? new Date(r.createdAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "";
        return `<div class="hrow" style="align-items:flex-start">
          <div>
            <div class="dn">${escapeHtml(r.message)}</div>
            <div class="dsub">${created}</div>
          </div>
          <span style="background:${s.bg};color:${s.fg};padding:4px 10px;border-radius:999px;font-size:12.5px;font-weight:600;white-space:nowrap">${s.label}</span>
        </div>`;
      })
      .join("");
  }

  /* ---------------- TOAST ---------------- */
  function toast(title, msg = "", isError = false) {
    const el = document.createElement("div");
    el.className = "toast";
    if (isError) {
      el.style.background = "#FDECEC";
      el.style.borderColor = "#f3c7c7";
    }
    el.innerHTML = `<span class="tic">${isError ? "!" : "✓"}</span><div><div class="tt">${title}</div>${msg ? `<div class="tm">${msg}</div>` : ""}</div>`;
    if (isError) {
      el.querySelector(".tic").style.background = "#EF4444";
      el.querySelector(".tt").style.color = "#DC2626";
    }
    $("#toasts").appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .3s";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, 3800);
  }

  /* ---------------- SIDEBAR (mobile) ---------------- */
  $("#sbOpen").addEventListener("click", () =>
    $("#sidebar").classList.add("open"),
  );
  $$("#sbClose").forEach((b) => b.addEventListener("click", closeSidebar));
  function closeSidebar() {
    $("#sidebar").classList.remove("open");
  }

  /* ---------------- LOGOUT ---------------- */
  [$("#logoutBtn"), $("#logoutBtn2")].forEach(
    (b) =>
      b &&
      b.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          await fetch(API_BASE + "/auth/logout", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
          });
        } catch {
          /* even if the call fails, still send them to login */
        }
        window.location.href = "../../../Auth/login/login.html";
      }),
  );

  /* ---------------- helpers ---------------- */
  function cap(s) {
    return (
      { "in-progress": "In Progress" }[s] ||
      (s ? s.charAt(0).toUpperCase() + s.slice(1) : "")
    );
  }
  function greetWord() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }
  function niceDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso + "T00:00");
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  }
  function syncUserChrome() {
    const u = STATE.user;
    $("#topName").textContent = u.fullname;
    $("#ddName").textContent = u.fullname;
    $("#ddEmail").textContent = u.email;
  }
  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  /* ---------------- SOCKET.IO — live queue updates ---------------- */
  let socket = null;
  let joinedRooms = new Set();

  function syncQueueRooms() {
    if (!socket || !socket.connected) return;

    const wanted = new Set(
      activeAppts()
        .map((a) => a.doctorId)
        .filter(Boolean),
    );

    for (const doctorId of joinedRooms) {
      if (!wanted.has(doctorId)) {
        socket.emit("leaveQueue", doctorId);
      }
    }
    for (const doctorId of wanted) {
      if (!joinedRooms.has(doctorId)) {
        socket.emit("joinQueue", doctorId);
      }
    }
    joinedRooms = wanted;
  }

  async function refreshLiveViews() {
    try {
      await loadAppointments();
    } catch (err) {
      console.warn("Live queue refresh failed:", err.message);
      return;
    }
    syncQueueRooms();
    renderOverview();
    renderAppointments();
    if (!$("#view-queue").hidden) renderQueue();
  }

  function initSocket() {
    if (typeof io !== "function") {
      console.warn(
        "socket.io client not found — live queue push updates disabled; the dashboard still works via refresh-after-action.",
      );
      return;
    }

    socket = io(API_BASE, { withCredentials: true });

    socket.on("connect", () => {
      joinedRooms = new Set();
      syncQueueRooms();
    });

    socket.on("queueUpdated", refreshLiveViews);
    socket.on("clinicStarted", refreshLiveViews);
    socket.on("clinicClosed", refreshLiveViews);
    socket.on("delayUpdated", refreshLiveViews);
    socket.on("queueLengthUpdated", refreshLiveViews);

    socket.on("connect_error", (err) => {
      console.warn("Socket connection error:", err.message);
    });

    window.addEventListener("beforeunload", () => {
      if (!socket) return;
      joinedRooms.forEach((doctorId) => socket.emit("leaveQueue", doctorId));
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
  /* ---------------- INIT ---------------- */
  async function init() {
    showView(location.hash.replace("#", "") || "overview");
    try {
      await loadUser();
      syncUserChrome();
    } catch (err) {
      toast("Couldn't load your profile", err.message, true);
    }

    try {
      await loadAppointments();
    } catch (err) {
      toast("Couldn't load appointments", err.message, true);
    }

    initSocket();
    syncQueueRooms();

    await loadMyReports();

    renderNotifs();
    renderOverview();
    renderAppointments();
    renderFAQ();
    renderMyReports();

    const hash = location.hash.replace("#", "");
    showView(TITLES[hash] ? hash : "overview");
  }

  /* ---------------- REPORT A PROBLEM ---------------- */
  $("#reportBtn").addEventListener("click", () => {
    $("#reportText").value = "";
    $("#reportOverlay").classList.add("open");
  });
  $("#reportClose").addEventListener("click", () =>
    $("#reportOverlay").classList.remove("open"),
  );
  $("#reportCancel").addEventListener("click", () =>
    $("#reportOverlay").classList.remove("open"),
  );
  $("#reportOverlay").addEventListener("click", (e) => {
    if (e.target.id === "reportOverlay") {
      $("#reportOverlay").classList.remove("open");
    }
  });
  $("#reportForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#reportText").value.trim();
    if (!msg) return toast("Please describe the problem first.", "", true);

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Submitting…";
    try {
      let res;
      try {
        res = await fetch(API_BASE + "/support/report", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: msg }),
        });
      } catch (networkErr) {
        throw new Error("Could not reach the server. Check your connection.");
      }

      if (res.status === 401) {
        window.location.href = "../../../Auth/login/login.html";
        throw new Error("Session expired. Please log in again.");
      }

      let json = null;
      try {
        json = await res.json();
      } catch {
        /* empty body */
      }

      if (!res.ok) {
        throw new Error(json?.message || `Request failed (${res.status})`);
      }

      $("#reportOverlay").classList.remove("open");
      toast("Report submitted", "Thanks — our team will look into it.");

      await loadMyReports();
      renderMyReports();
    } catch (err) {
      toast("Couldn't submit report", err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Submit Report";
    }
  });
  init();
})();
