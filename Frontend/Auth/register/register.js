// ---- Show / hide password toggle -----------------------------------
// Generic: works for any ".pw-wrap" that contains an <input> and a
// sibling ".eye" icon — no data-target attribute required, since it
// just targets the input inside its own wrapper.

const EYE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>`;

const EYE_OFF_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a13.16 13.16 0 0 1-4.17 4.71"/><path d="M6.61 6.61A13.53 13.53 0 0 0 1 11s4 7 11 7a10.94 10.94 0 0 0 5.39-1.61"/><path d="M9.9 14.1a3 3 0 1 0 4.2-4.2"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function showStep(step) {
  document.getElementById("step-select").style.display =
    step === "select" ? "block" : "none";
  document
    .getElementById("step-patient")
    .classList.toggle("active", step === "patient");
  document
    .getElementById("step-doctor")
    .classList.toggle("active", step === "doctor");
  document.querySelector(".right").scrollTo(0, 0);
}
document.querySelectorAll(".pw-wrap .eye").forEach((eye) => {
  eye.setAttribute("role", "button");
  eye.setAttribute("tabindex", "0");
  eye.setAttribute("aria-label", "Show password");

  const toggle = () => {
    const input = eye.parentElement.querySelector("input");
    if (!input) return;
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    eye.innerHTML = isHidden ? EYE_OFF_ICON : EYE_ICON;
    eye.setAttribute(
      "aria-label",
      isHidden ? "Hide password" : "Show password",
    );
  };

  eye.addEventListener("click", toggle);
  eye.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
});

// ---------------------------------------------------------------------

const form = document.getElementById("registerForm");
const alertBox = document.getElementById("alert");
const btn = document.getElementById("submitBtn");

const fields = {
  fullname: document.getElementById("f-fullname"),
  email: document.getElementById("f-email"),
  phone: document.getElementById("f-phone"),
  password: document.getElementById("f-password"),
  dateOfBirth: document.getElementById("f-dob"),
  gender: document.getElementById("f-gender"),
  bloodGroup: document.getElementById("f-blood"),
};

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(alertBox);
  Object.values(fields).forEach(clearFieldError);

  const v = {
    fullname: form.fullname.value,
    email: form.email.value,
    phone: form.phone.value,
    password: form.password.value,
    dateOfBirth: form.dateOfBirth.value,
    gender: form.gender.value,
    bloodGroup: form.bloodGroup.value,
  };

  let ok = true;
  const check = (key, result) => {
    if (result !== true) {
      setFieldError(fields[key], result);
      ok = false;
    }
  };
  check("fullname", validators.fullname(v.fullname));
  check("email", validators.email(v.email));
  check("phone", validators.phone(v.phone));
  check("password", validators.password(v.password));
  if (!v.dateOfBirth) check("dateOfBirth", "Date of birth is required");
  else if (new Date(v.dateOfBirth) >= new Date())
    check("dateOfBirth", "Must be in the past");
  check("gender", validators.required(v.gender));
  check("bloodGroup", validators.required(v.bloodGroup));
  if (!ok) return;

  setLoading(btn, true);
  try {
    await apiPost("/auth/register-patient", v);
    showAlert(
      alertBox,
      "success",
      "Account created! Redirecting to login\u2026",
    );
    setTimeout(() => {
      window.location.href = "../login/login.html";
    }, 900);
  } catch (err) {
    showAlert(alertBox, "error", err.message);
  } finally {
    setLoading(btn, false);
  }
});
