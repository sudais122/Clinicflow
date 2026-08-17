console.log("LOGIN.JS FILE EXECUTED");


const form = document.getElementById("loginForm");
console.log("FORM FOUND:", form);

const alertBox = document.getElementById("alert");
const btn = document.getElementById("submitBtn");

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
        credentials: "include", // required so the Set-Cookie on the response is actually stored
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