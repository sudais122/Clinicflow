  const form = document.getElementById("loginForm");
  const alertBox = document.getElementById("alert");
  const btn = document.getElementById("submitBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAlert(alertBox);
    const fEmail = document.getElementById("f-email");
    const fPass = document.getElementById("f-password");
    [fEmail, fPass].forEach(clearFieldError);

    const email = form.email.value;
    const password = form.password.value;

    let ok = true;
    const ev = validators.email(email);
    if (ev !== true) { setFieldError(fEmail, ev); ok = false; }
    if (validators.required(password) !== true) { setFieldError(fPass, "Password is required"); ok = false; }
    if (!ok) return;

    setLoading(btn, true);
    try {
      const data = await apiPost("/auth/login", { email, password });
      const role = data?.data?.user?.role;
      showAlert(alertBox, "success", "Logged in! Redirecting\u2026");
      setTimeout(() => {
        if (role === "doctor") window.location.href = "./dashboard-doctor.html";
        else if (role === "patient") window.location.href = "./dashboard-patient.html";
        else window.location.href = "./index.html";
      }, 700);
    } catch (err) {
      showAlert(alertBox, "error", err.message);
    } finally {
      setLoading(btn, false);
    }
  });