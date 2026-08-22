const alertBox = document.getElementById("alert");
const belowLink = document.getElementById("belowLink");

const steps = {
  1: document.getElementById("step-email"),
  2: document.getElementById("step-otp"),
  3: document.getElementById("step-reset"),
  4: document.getElementById("step-success"),
};

const state = { email: "", otp: "" };

function goToStep(n) {
  Object.values(steps).forEach((el) => el.classList.remove("active"));
  steps[n].classList.add("active");
  belowLink.style.display = n === 1 ? "" : "none";
  clearAlert(alertBox);
}

function maskEmail(email) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  const visible = name.slice(0, Math.min(2, name.length));
  const masked = visible + "*".repeat(Math.max(name.length - visible.length, 3));
  return `${masked}@${domain}`;
}

/* ---------------- STEP 1: email ---------------- */
const emailForm = document.getElementById("emailForm");
const fEmail = document.getElementById("f-fp-email");
const sendCodeBtn = document.getElementById("sendCodeBtn");

document.getElementById("backToLogin").addEventListener("click", () => {
  window.location.href = "../login/login.html";
});

emailForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(alertBox);
  clearFieldError(fEmail);

  const email = emailForm.email.value.trim();
  const ev = validators.email(email);
  if (ev !== true) {
    setFieldError(fEmail, ev);
    return;
  }

  setLoading(sendCodeBtn, true);
  try {
    await apiPost("/auth/password/forgot-password", { email: email.toLowerCase() });
    state.email = email.toLowerCase();
    state.otp = "";
    document.getElementById("maskedEmail").textContent = maskEmail(state.email);
    resetOtpBoxes();
    goToStep(2);
    startResendCooldown();
  } catch (err) {
    showAlert(alertBox, "error", err.message);
  } finally {
    setLoading(sendCodeBtn, false);
  }
});

/* ---------------- STEP 2: OTP verification ---------------- */
const otpForm = document.getElementById("otpForm");
const otpRow = document.getElementById("otpRow");
const otpBoxes = Array.from(otpRow.querySelectorAll(".af-otp-box"));
const otpError = document.getElementById("otpError");
const verifyBtn = document.getElementById("verifyBtn");
const resendBtn = document.getElementById("resendBtn");

document.getElementById("backToEmail").addEventListener("click", () => {
  clearInterval(resendInterval);
  goToStep(1);
});

function resetOtpBoxes() {
  otpBoxes.forEach((b) => {
    b.value = "";
    b.classList.remove("filled");
  });
  otpRow.classList.remove("invalid");
  otpError.textContent = "";
  otpBoxes[0]?.focus();
}

otpBoxes.forEach((box, i) => {
  box.addEventListener("input", (e) => {
    const val = e.target.value.replace(/\D/g, "").slice(-1);
    e.target.value = val;
    e.target.classList.toggle("filled", !!val);
    if (val && otpBoxes[i + 1]) otpBoxes[i + 1].focus();
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !e.target.value && otpBoxes[i - 1]) {
      otpBoxes[i - 1].focus();
    }
  });
  box.addEventListener("paste", (e) => {
    e.preventDefault();
    const digits = (e.clipboardData.getData("text") || "")
      .replace(/\D/g, "")
      .slice(0, 6)
      .split("");
    digits.forEach((d, j) => {
      if (otpBoxes[j]) {
        otpBoxes[j].value = d;
        otpBoxes[j].classList.add("filled");
      }
    });
    otpBoxes[Math.min(digits.length, 5)]?.focus();
  });
});

otpForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(alertBox);
  otpRow.classList.remove("invalid");
  otpError.textContent = "";

  const otp = otpBoxes.map((b) => b.value).join("");
  if (otp.length !== 6) {
    otpRow.classList.add("invalid");
    otpError.textContent = "Enter all 6 digits.";
    return;
  }

  setLoading(verifyBtn, true);
  try {
    await apiPost("/auth/password/verify-otp", { email: state.email, otp });
    state.otp = otp;
    goToStep(3);
  } catch (err) {
    otpRow.classList.add("invalid");
    otpError.textContent = err.message;
  } finally {
    setLoading(verifyBtn, false);
  }
});

let resendInterval = null;
function startResendCooldown(seconds = 30) {
  clearInterval(resendInterval);
  let remaining = seconds;
  resendBtn.disabled = true;
  renderResendLabel(remaining);

  resendInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(resendInterval);
      resendBtn.disabled = false;
      resendBtn.textContent = "Resend code";
    } else {
      renderResendLabel(remaining);
    }
  }, 1000);
}
function renderResendLabel(remaining) {
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  resendBtn.innerHTML = `Resend code in <span>${mm}:${ss}</span>`;
}

resendBtn.addEventListener("click", async () => {
  if (resendBtn.disabled) return;
  clearAlert(alertBox);
  resendBtn.disabled = true;
  try {
    await apiPost("/auth/password/resend-otp", { email: state.email });
    resetOtpBoxes();
    showAlert(alertBox, "success", "A new code has been sent.");
    startResendCooldown();
  } catch (err) {
    showAlert(alertBox, "error", err.message);
    resendBtn.disabled = false;
    resendBtn.textContent = "Resend code";
  }
});

/* ---------------- STEP 3: reset password ---------------- */
const resetForm = document.getElementById("resetForm");
const fNewPass = document.getElementById("f-new-pass");
const fConfirmPass = document.getElementById("f-confirm-pass");
const newPassInput = document.getElementById("new-pass");
const confirmPassInput = document.getElementById("confirm-pass");
const resetBtn = document.getElementById("resetBtn");
const strengthMeter = document.getElementById("strengthMeter");
const strengthLabel = document.getElementById("strengthLabel");

newPassInput.addEventListener("input", () => {
  const val = newPassInput.value;
  if (!val) {
    strengthMeter.classList.remove("show");
    strengthMeter.dataset.level = "";
    return;
  }
  strengthMeter.classList.add("show");
  const level = passwordStrength(val);
  strengthMeter.dataset.level = level;
  strengthLabel.textContent =
    level === "weak" ? "Weak" : level === "medium" ? "Medium strength" : "Strong password";
});

function passwordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[@$!%*?&#^()_\-+=]/.test(pw)) score++;
  if (pw.length >= 12) score++;
  if (score <= 2) return "weak";
  if (score <= 3) return "medium";
  return "strong";
}

// Show/hide toggles — data-target based, matching login.js's pattern.
document.querySelectorAll(".af-toggle-pass").forEach((btn) => {
  btn.addEventListener("click", () => {
    const targetId = btn.getAttribute("data-target");
    const input = document.getElementById(targetId);
    if (!input) return;
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    btn.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
  });
});

resetForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlert(alertBox);
  clearFieldError(fNewPass);
  clearFieldError(fConfirmPass);

  const newPassword = newPassInput.value;
  const confirmPassword = confirmPassInput.value;

  let ok = true;
  const pv = validators.password(newPassword);
  if (pv !== true) {
    setFieldError(fNewPass, pv);
    ok = false;
  }
  if (!confirmPassword) {
    setFieldError(fConfirmPass, "Please confirm your password");
    ok = false;
  } else if (confirmPassword !== newPassword) {
    setFieldError(fConfirmPass, "Passwords do not match");
    ok = false;
  }
  if (!ok) return;

  setLoading(resetBtn, true);
  try {
    await apiPost("/auth/password/reset-password", {
      email: state.email,
      otp: state.otp,
      newPassword,
    });
    goToStep(4);
  } catch (err) {
    showAlert(alertBox, "error", err.message);
    if (/otp/i.test(err.message)) {
      setTimeout(() => goToStep(2), 1800);
    }
  } finally {
    setLoading(resetBtn, false);
  }
});

/* ---------------- init ---------------- */
goToStep(1);