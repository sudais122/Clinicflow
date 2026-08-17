/* ============================================================
   ClinicFlow — Doctor Dashboard API layer
   Matches your exact backend routes and response shapes.
   All requests use credentials:"include" (httpOnly cookies).
   ============================================================ */
(function () {
  const CFG = window.CLINICFLOW_CONFIG || {};
  const BASE = CFG.API_BASE || "http://localhost:8000";
  const MOCK = !!CFG.MOCK;

  async function req(path, { method = "GET", body } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401 || res.status === 403) {
      const e = new Error(data?.message || "Unauthorized");
      e.status = res.status; throw e;
    }
    if (!res.ok) {
      const e = new Error(data?.message || `Error ${res.status}`);
      e.status = res.status; throw e;
    }
    // ApiResponse wrapper: { statusCode, data, message, success }
    return (data && "data" in data) ? data.data : data;
  }

  window.DRAPI = {
    MOCK,

    // GET /auth/current-user  ->  req.user (populated with doctor profile in verifyJWT)
    // We use GET /dashboard/doctor which already returns doctor info.
    getDashboard: (date) => req("/dashboard/doctor" + (date ? `?date=${date}` : "")),

    // GET /appointments/doctor (doctor appointments)
    getAppointments: () => req("/appointments/doctor"),

    // GET /doctor/getalldoctors  (for reference — not used on doctor dashboard)
    getDoctors: () => req("/doctor/getalldoctors"),

    // PATCH /queue/start
    startClinic: () => req("/queue/start", { method: "PATCH" }),

    // PATCH /queue/end
    endClinic: () => req("/queue/end", { method: "PATCH" }),

    // PATCH /queue/next
    nextPatient: () => req("/queue/next", { method: "PATCH" }),

    // PATCH /queue/delay  { delay: number }
    updateDelay: (minutes) => req("/queue/delay", { method: "PATCH", body: { delay: minutes } }),

    // PATCH /queue/reset
    resetQueue: () => req("/queue/reset", { method: "PATCH" }),

    // PATCH /appointments/:id/cancel  (doctor cancels)
    cancelAppointment: (id) => req(`/appointments/${id}/cancel`, { method: "PATCH" }),

    // PATCH /doctor/profile
    updateProfile: (payload) => req("/doctor/profile", { method: "PATCH", body: payload }),

    // GET /subscription/me
    getSubscription: () => req("/subscription/me"),

    // POST /auth/logout
    logout: () => req("/auth/logout", { method: "POST" }),
  };
})();