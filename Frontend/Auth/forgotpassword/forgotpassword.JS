// ===== ClinicFlow auth — shared API helpers =====
const CFG = window.CLINICFLOW_CONFIG || {};
const API_BASE = CFG.API_BASE || "http://localhost:8000";
const MOCK = !!CFG.MOCK;
const MOCK_OTP = CFG.MOCK_OTP || "123456";
const MOCK_EMAIL = (CFG.MOCK_EMAIL || "").toLowerCase();

// simulate a network delay so loading spinners are visible
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Mock backend: fake responses for demo mode ----
async function mockPost(path, body) {
  await wait(700);
  const email = (body.email || "").toLowerCase();

  switch (path) {
    case "/auth/forgot-password":
    case "/auth/resend-otp":
      // pretend we emailed a code. (Log it so you can "read" the email.)
      console.log(
        `%c[MOCK] OTP for ${email}: ${MOCK_OTP}`,
        "color:#1769E8;font-weight:bold",
      );
      if (MOCK_EMAIL && email !== MOCK_EMAIL) {
        throw new Error("Email not found");
      }
      return { statusCode: 200, data: {}, message: "Reset code sent (mock)" };

    case "/auth/verify-otp":
      if (body.otp !== MOCK_OTP) throw new Error("Invalid or expired OTP");
      return { statusCode: 200, data: {}, message: "OTP verified (mock)" };

    case "/auth/reset-password":
      if (body.otp !== MOCK_OTP) throw new Error("Invalid or expired OTP");
      return { statusCode: 200, data: {}, message: "Password reset (mock)" };

    case "/auth/login":
      // any password works in mock; role guessed from the email
      return {
        statusCode: 200,
        message: "Logged in (mock)",
        data: {
          user: {
            email,
            role: email.includes("doctor") ? "doctor" : "patient",
          },
        },
      };

    case "/auth/register-patient":
      return {
        statusCode: 201,
        data: {},
        message: "Patient registered (mock)",
      };

    default:
      return { statusCode: 200, data: {}, message: "OK (mock)" };
  }
}

async function apiPost(path, body) {
  if (MOCK) return mockPost(path, body);

  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok)
    throw new Error(data?.message || "Something went wrong. Please try again.");
  return data;
}

// ---- UI helpers ----
function showAlert(el, type, msg) {
  el.textContent = msg;
  el.className = `alert ${type} show`;
}
function clearAlert(el) {
  el.className = "alert";
}
function setFieldError(field, msg) {
  field.classList.add("invalid");
  const err = field.querySelector(".err");
  if (err) err.textContent = msg;
}
function clearFieldError(field) {
  field.classList.remove("invalid");
}
function setLoading(btn, on) {
  btn.classList.toggle("loading", on);
  btn.disabled = on;
}

// ---- validation ----
const validators = {
  email: (v) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || "Enter a valid email",
  password: (v) =>
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_\-+=]).{8,}$/.test(v) ||
    "8+ chars with upper, lower, number & special character",
  fullname: (v) =>
    (v.trim().length >= 3 && /^[A-Za-z\s]+$/.test(v.trim())) ||
    "Letters only, at least 3 characters",
  phone: (v) =>
    /^03\d{9}$/.test(v.trim()) || "Must be 11 digits starting with 03",
  required: (v) => (v && v.trim() !== "") || "This field is required",
};
