// ===== ClinicFlow auth — shared API helpers =====
// API base comes from config.js (loaded before this file).
const API_BASE =
  (window.CLINICFLOW_CONFIG && window.CLINICFLOW_CONFIG.API_BASE) ||
  "http://localhost:8000";

async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    const msg = data?.message || "Something went wrong. Please try again.";
    throw new Error(msg);
  }
  return data;
}

// ---- UI helpers ----
function showAlert(el, type, msg) { el.textContent = msg; el.className = `alert ${type} show`; }
function clearAlert(el) { el.className = "alert"; }
function setFieldError(field, msg) {
  field.classList.add("invalid");
  const err = field.querySelector(".err");
  if (err) err.textContent = msg;
}
function clearFieldError(field) { field.classList.remove("invalid"); }
function setLoading(btn, on) { btn.classList.toggle("loading", on); btn.disabled = on; }

// ---- validation ----
const validators = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || "Enter a valid email",
  password: (v) =>
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_\-+=]).{8,}$/.test(v) ||
    "8+ chars with upper, lower, number & special character",
  fullname: (v) => (v.trim().length >= 3 && /^[A-Za-z\s]+$/.test(v.trim())) || "Letters only, at least 3 characters",
  phone: (v) => /^03\d{9}$/.test(v.trim()) || "Must be 11 digits starting with 03",
  required: (v) => (v && v.trim() !== "") || "This field is required",
};