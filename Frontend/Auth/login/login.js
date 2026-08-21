console.log("LOGIN.JS FILE EXECUTED");

const form = document.getElementById("loginForm");
console.log("FORM FOUND:", form);

const alertBox = document.getElementById("alert");
const btn = document.getElementById("submitBtn");

// ---- Show / hide password toggle -----------------------------------
// Wires every .af-toggle-pass button to the input named in its
// data-target attribute. Toggles input type password <-> text and
// swaps the icon between "eye" and "eye-off" so there's visual
// feedback, not just a silent state change.

const EYE_ICON = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>`;

const EYE_OFF_ICON = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a13.16 13.16 0 0 1-4.17 4.71" />
    <path d="M6.61 6.61A13.53 13.53 0 0 0 1 11s4 7 11 7a10.94 10.94 0 0 0 5.39-1.61" />
    <path d="M9.9 14.1a3 3 0 1 0 4.2-4.2" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>`;

document.querySelectorAll(".af-toggle-pass").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const targetId = toggle.getAttribute("data-target");
    const input = document.getElementById(targetId);
    if (!input) return;

    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";

    toggle.innerHTML = isHidden ? EYE_OFF_ICON : EYE_ICON;
    toggle.setAttribute(
      "aria-label",
      isHidden ? "Hide password" : "Show password"
    );
  });
});

// ---------------------------------------------------------------------

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  console.log("LOGIN JS LOADED");
  console.log("LOGIN FORM SUBMITTED");

  clearAlert(alertBox);
  const fEmail = document.getElementById("f-email");
  const fPass = document.getElementById("f-password");
  [fEmail, fPass].forEach(clearFieldError);

  const email = form.email.value;
  const password = form.password.value;

  let ok = true;
  const ev = validators.email(email);
  if (ev !== true) {
    setFieldError(fEmail, ev);
    ok = false;
  }
  if (validators.required(password) !== true) {
    setFieldError(fPass, "Password is required");
    ok = false;
  }
  if (!ok) return;

  setLoading(btn, true);
  try {
    let res;
    try {
      res = await fetch("http://localhost:8000/auth/login", {
        method: "POST",
        credentials: "include", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch (networkErr) {
      throw new Error("Could not reach the server. Check your connection.");
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

    const data = json;
    console.log("Login response:", data);

    const role = data?.data?.user?.role;

    console.log("Logged in role:", role);

    showAlert(alertBox, "success", "Logged in successfully!");

    setTimeout(() => {
      if (role === "doctor") {
        window.location.href = "/frontend/Dashboards/Patient/doctor/index.html";
      } else if (role === "patient") {
        window.location.href =
          "/frontend/Dashboards/Patient/patient/index.html";
      } else {
        console.error("Unknown role:", role);
        showAlert(alertBox, "error", "User role not found.");
      }
    }, 700);
  } catch (err) {
    showAlert(alertBox, "error", err.message);
  } finally {
    setLoading(btn, false);
  }
});