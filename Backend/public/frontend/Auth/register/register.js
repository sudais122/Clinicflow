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
