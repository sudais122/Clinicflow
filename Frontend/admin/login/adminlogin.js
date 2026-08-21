/* ClinicFlow — Admin Login
   POST /admin/login, cookie-based auth (credentials: "include").
   On success, redirects to the dashboard — adjust DASHBOARD_PATH
   below if admin-dashboard.html isn't in the same folder as this file. */

const API_BASE = window.CLINICFLOW_CONFIG?.API_BASE || "http://localhost:8000";
const DASHBOARD_PATH = "../index.html";

const $ = (s) => document.querySelector(s);

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = $("#email").value.trim();
  const password = $("#password").value;
  const btn = $("#loginBtn");
  const banner = $("#errorBanner");

  banner.hidden = true;
  btn.disabled = true;
  btn.textContent = "Signing in…";

  try {
    const res = await fetch(`${API_BASE}/admin/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    let payload = null;
    try { payload = await res.json(); } catch { /* empty body */ }

    if (!res.ok) {
      throw new Error(payload?.message || `Sign in failed (${res.status})`);
    }

    window.location.href = DASHBOARD_PATH;
  } catch (err) {
    banner.textContent = err.message || "Something went wrong. Please try again.";
    banner.hidden = false;
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});