  // ============================================================
  //  PLACEHOLDER DATA (design-only)
  //  Replace loadDashboard() body with a real fetch when ready:
  //    GET {API_BASE}/appointments/patient   (JWT cookie sent)
  //  The API returns the patient's appointments; the newest
  //  waiting/in-progress one drives the live queue card, and
  //  its `queue` block gives nowServing / patientsAhead / wait.
  // ============================================================
  const PLACEHOLDER = {
    user: { fullname: "Ali Ahmed", patientId: "PT-000042" },
    current: {
      appointmentId: "APT-000188",
      status: "waiting",
      date: "10 Aug 2026",
      yourToken: 22,
      doctor: { name: "Dr Hassan Qureshi", specialization: "Cardiologist", clinicName: "Care Point Clinic" },
      queue: { nowServing: 18, patientsAhead: 3, estimatedWaitMinutes: 30, clinicStatus: "open" },
    },
    history: [
      { appointmentId: "APT-000181", doctor: "Dr Fatima Noor",   date: "05 Aug 2026", status: "completed" },
      { appointmentId: "APT-000164", doctor: "Dr Hassan Qureshi", date: "28 Jul 2026", status: "completed" },
      { appointmentId: "APT-000140", doctor: "Dr Fatima Noor",   date: "14 Jul 2026", status: "cancelled" },
    ],
  };

  const $ = (id) => document.getElementById(id);
  const initials = (name) => name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  function renderQueue(c) {
    $("yourToken").textContent = "#" + c.yourToken;
    $("nowServing").textContent = "#" + c.queue.nowServing;
    $("patientsAhead").textContent = c.queue.patientsAhead;
    $("estWait").textContent = c.queue.patientsAhead === 0 ? "Now" : c.queue.estimatedWaitMinutes + " min";

    // clinic status badge
    const badge = $("clinicBadge");
    if (c.queue.clinicStatus === "open") {
      badge.className = "badge-live"; badge.innerHTML = '<span class="dot"></span> Clinic open';
    } else {
      badge.className = "badge-live badge-closed"; badge.innerHTML = '<span class="dot"></span> Clinic closed';
    }
    // "your turn" banner when nobody's ahead and you're being served
    $("turnBanner").classList.toggle("show", c.queue.patientsAhead === 0 && c.queue.nowServing >= c.yourToken);
  }

  function renderDoctor(c) {
    $("docName").textContent = c.doctor.name;
    $("docSpec").textContent = c.doctor.specialization;
    $("docAvatar").textContent = initials(c.doctor.name.replace(/^Dr\s+/, ""));
    $("clinicName").textContent = c.doctor.clinicName;
    $("aptId").textContent = c.appointmentId;
    $("aptDate").textContent = c.date;
    const st = $("aptStatus");
    st.textContent = c.status;
    st.className = "pill " + (c.status === "in-progress" ? "progress" : c.status);
  }

  function renderHistory(list) {
    const wrap = $("historyList");
    if (!list.length) { wrap.innerHTML = '<div class="empty">No past appointments yet.</div>'; return; }
    wrap.innerHTML = list.map((h) => {
      const cls = h.status === "in-progress" ? "progress" : h.status;
      return `<div class="hist-item">
        <span class="apt">${h.appointmentId}</span>
        <div class="info"><div class="dr">${h.doctor}</div><div class="dt">${h.date}</div></div>
        <span class="pill ${cls}">${h.status}</span>
      </div>`;
    }).join("");
  }

  function renderUser(u) {
    $("userName").textContent = u.fullname;
    $("userId").textContent = u.patientId;
    $("userAvatar").textContent = initials(u.fullname);
  }

  // ---- load (currently placeholder; swap for a fetch later) ----
  async function loadDashboard() {
    // TODO (real): 
    // const data = await apiGet("/appointments/patient");
    // ...map data -> renderUser / renderQueue / renderDoctor / renderHistory
    const d = PLACEHOLDER;
    renderUser(d.user);
    renderQueue(d.current);
    renderDoctor(d.current);
    renderHistory(d.history);
  }

  // refresh button re-fetches (re-renders placeholder for now)
  $("refreshBtn").addEventListener("click", async () => {
    const btn = $("refreshBtn");
    btn.disabled = true; btn.style.opacity = ".6";
    await new Promise((r) => setTimeout(r, 500)); // simulate load
    await loadDashboard();
    btn.disabled = false; btn.style.opacity = "1";
  });

  $("logoutBtn").addEventListener("click", () => {
    // TODO (real): await apiPost("/auth/logout", {});
    window.location.href = "./login.html";
  });

  loadDashboard();
