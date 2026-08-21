const EYE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>`;

const EYE_OFF_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a13.16 13.16 0 0 1-4.17 4.71"/><path d="M6.61 6.61A13.53 13.53 0 0 0 1 11s4 7 11 7a10.94 10.94 0 0 0 5.39-1.61"/><path d="M9.9 14.1a3 3 0 1 0 4.2-4.2"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

document.querySelectorAll(".pw-wrap .eye").forEach((eye) => {
  if (eye.dataset.pwToggleBound === "1") return;
  eye.dataset.pwToggleBound = "1";

  eye.setAttribute("role", "button");
  eye.setAttribute("tabindex", "0");
  eye.setAttribute("aria-label", "Show password");

  const toggle = () => {
    const input = eye.parentElement.querySelector("input");
    if (!input) {
      console.warn("Password eye toggle: no sibling <input> found.", eye);
      return;
    }
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    eye.innerHTML = isHidden ? EYE_OFF_ICON : EYE_ICON;
    eye.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
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

// ---- Full-screen success overlay ---------------------------------
function showSuccessModal({ title, message, redirectTo }) {
  const overlay = document.getElementById("successOverlay");
  if (!overlay) {
    alert(`${title}\n\n${message}`);
    window.location.href = redirectTo;
    return;
  }

  document.getElementById("successTitle").textContent = title;
  document.getElementById("successMessage").textContent = message;
  overlay.classList.add("open");

  const close = () => {
    overlay.classList.remove("open");
    document.removeEventListener("keydown", onKeydown);
    window.location.href = redirectTo;
  };
  const onKeydown = (e) => {
    if (e.key === "Escape") close();
  };

  document.getElementById("successCloseBtn").onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  document.addEventListener("keydown", onKeydown);
}

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
    form.reset();
    showSuccessModal({
      title: "Account created successfully",
      message: "Your ClinicFlow account is ready to go.",
      redirectTo: "../login/login.html",
    });
  } catch (err) {
    showAlert(alertBox, "error", err.message);
  } finally {
    setLoading(btn, false);
  }
});

//doctor register

const drForm = document.getElementById("registerDoctorForm");
const drAlertBox = document.getElementById("doctorAlert");
const drBtn = document.getElementById("submitBtnDoctor");

const drFields = {
  fullname: document.getElementById("f-dr-fullname"),
  email: document.getElementById("f-dr-email"),
  phone: document.getElementById("f-dr-phone"),
  password: document.getElementById("f-dr-password"),
  specialization: document.getElementById("f-specialization"),
  clinicName: document.getElementById("f-clinicName"),
  clinicAddress: document.getElementById("f-clinicAddress"),
  consultationFee: document.getElementById("f-consultationFee"),
  licenseNumber: document.getElementById("f-licenseNumber"),
  experience: document.getElementById("f-experience"),
  bio: document.getElementById("f-bio"),
};

// Local checks for fields the shared auth.js validators don't cover.
// Kept here rather than edited into auth.js so patient registration's
// validators aren't touched by doctor-only rules.
function validateLicenseNumber(value) {
  const v = (value || "").trim();
  return (
    (v.length >= 3 && v.length <= 50) ||
    "License number must be between 3 and 50 characters."
  );
}

function validateExperience(value) {
  if (value === "") return "Years of experience is required.";
  const n = Number(value);
  return (
    (!isNaN(n) && n >= 0 && n <= 70) ||
    "Enter a valid number of years (0–70)."
  );
}

function validateBioOptional(value) {
  const v = (value || "").trim();
  if (v.length === 0) return true; // optional on the backend
  return v.length <= 1000 || "Bio cannot exceed 1000 characters.";
}

drForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(drAlertBox);
  Object.values(drFields).forEach(clearFieldError);

  const v = {
    fullname: drForm.fullname.value,
    email: drForm.email.value,
    phone: drForm.phone.value,
    password: drForm.password.value,
    specialization: drForm.specialization.value,
    clinicName: drForm.clinicName.value,
    clinicAddress: drForm.clinicAddress.value,
    consultationFee: drForm.consultationFee.value,
    licenseNumber: drForm.licenseNumber.value,
    experience: drForm.experience.value,
    bio: drForm.bio.value,
  };

  let ok = true;
  const check = (key, result) => {
    if (result !== true) {
      setFieldError(drFields[key], result);
      ok = false;
    }
  };

  check("fullname", validators.fullname(v.fullname));
  check("email", validators.email(v.email));
  check("phone", validators.phone(v.phone));
  check("password", validators.password(v.password));
  check("specialization", validators.specialization(v.specialization));
  check("clinicName", validators.clinicName(v.clinicName));
  check("clinicAddress", validators.clinicAddress(v.clinicAddress));
  check("licenseNumber", validateLicenseNumber(v.licenseNumber));
  check("consultationFee", validators.consultationFee(v.consultationFee));
  check("experience", validateExperience(v.experience));
  check("bio", validateBioOptional(v.bio));

  if (!ok) return;

  // Keys match req.body destructuring in registerDoctor exactly.
  const payload = {
    fullname: v.fullname,
    email: v.email,
    password: v.password,
    phone: v.phone,
    clinicName: v.clinicName,
    clinicAddress: v.clinicAddress,
    specialization: v.specialization,
    licenseNumber: v.licenseNumber,
    experience: Number(v.experience),
    consultationFee: Number(v.consultationFee),
    ...(v.bio.trim() ? { bio: v.bio.trim() } : {}),
  };

  setLoading(drBtn, true);
  try {
    await apiPost("/auth/register-doctor", payload);
    drForm.reset();
    showSuccessModal({
      title: "Account created successfully",
      message:
        "Your profile will go live once our admin team approves it — usually within 24 hours. We'll email you as soon as you're approved.",
      redirectTo: "../login/login.html",
    });
  } catch (err) {
    showAlert(drAlertBox, "error", err.message);
  } finally {
    setLoading(drBtn, false);
  }
});