

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
    const data = await apiPost("/auth/login", {
      email,
      password,
    });

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
