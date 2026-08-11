// ============================================================
// ClinicFlow Authentication
// Shared frontend authentication logic
// ============================================================

// config.js should be loaded BEFORE this file.

const API_BASE =
  (window.CLINICFLOW_CONFIG &&
    window.CLINICFLOW_CONFIG.API_BASE) ||
  "http://localhost:8000";


// ============================================================
// API HELPER
// ============================================================

async function apiRequest(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    ...options,

    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },

    // IMPORTANT:
    // Allows browser to send/receive httpOnly cookies.
    credentials: "include",
  });

  let data = null;

  try {
    data = await response.json();
  } catch (error) {
    // Response may not contain JSON.
  }

  if (!response.ok) {
    const message =
      data?.message ||
      "Something went wrong. Please try again.";

    throw new Error(message);
  }

  return data;
}


// ============================================================
// POST HELPER
// ============================================================

async function apiPost(path, body = {}) {
  return apiRequest(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}


// ============================================================
// GET HELPER
// ============================================================

async function apiGet(path) {
  return apiRequest(path, {
    method: "GET",
  });
}

// UI HELPER

function showAlert(element, type, message) {
  if (!element) return;

  element.textContent = message;
  element.className = `alert ${type} show`;
}


function clearAlert(element) {
  if (!element) return;

  element.textContent = "";
  element.className = "alert";
}


function setFieldError(field, message) {
  if (!field) return;

  field.classList.add("invalid");

  const errorElement = field.querySelector(".err");

  if (errorElement) {
    errorElement.textContent = message;
  }
}


function clearFieldError(field) {
  if (!field) return;

  field.classList.remove("invalid");

  const errorElement = field.querySelector(".err");

  if (errorElement) {
    errorElement.textContent = "";
  }
}


function setLoading(button, loading) {
  if (!button) return;

  button.classList.toggle("loading", loading);
  button.disabled = loading;
}


// VALIDATION

const validators = {

  fullname: (value) => {
    const v = value.trim();

    if (
      v.length >= 3 &&
      v.length <= 50 &&
      /^[A-Za-z\s]+$/.test(v)
    ) {
      return true;
    }

    return "Full name must contain only letters and spaces and be 3–50 characters.";
  },


  email: (value) => {
    const v = value.trim();

    return (
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ||
      "Enter a valid email address."
    );
  },


  password: (value) => {
    return (
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_\-+=]).{8,}$/.test(
        value
      ) ||
      "Password must be at least 8 characters and contain uppercase, lowercase, number and special character."
    );
  },


  phone: (value) => {
    const v = value.trim();

    return (
      /^03\d{9}$/.test(v) ||
      "Phone must be 11 digits and start with 03."
    );
  },


  required: (value) => {
    return (
      (value && value.trim() !== "") ||
      "This field is required."
    );
  },


  clinicName: (value) => {
    const v = value.trim();

    return (
      (v.length >= 3 && v.length <= 100) ||
      "Clinic name must be between 3 and 100 characters."
    );
  },


  clinicAddress: (value) => {
    const v = value.trim();

    return (
      (v.length >= 10 && v.length <= 200) ||
      "Clinic address must be between 10 and 200 characters."
    );
  },


  specialization: (value) => {
    const v = value.trim();

    return (
      (v.length >= 3 && v.length <= 50) ||
      "Specialization must be between 3 and 50 characters."
    );
  },


  consultationFee: (value) => {
    const number = Number(value);

    return (
      (!isNaN(number) && number > 0) ||
      "Consultation fee must be greater than 0."
    );
  },


  dateOfBirth: (value) => {
    if (!value) {
      return "Date of birth is required.";
    }

    const date = new Date(value);

    if (isNaN(date.getTime())) {
      return "Invalid date of birth.";
    }

    if (date >= new Date()) {
      return "Date of birth must be in the past.";
    }

    return true;
  },


  gender: (value) => {
    return (
      ["male", "female", "other"].includes(value) ||
      "Please select a valid gender."
    );
  },


  bloodGroup: (value) => {
    const validGroups = [
      "A+",
      "A-",
      "B+",
      "B-",
      "AB+",
      "AB-",
      "O+",
      "O-",
    ];

    return (
      validGroups.includes(value) ||
      "Please select a valid blood group."
    );
  },
};


// VALIDATE SINGLE FIELD

function validateField(input, validator) {
  if (!input) return true;

  const result = validator(input.value);

  const wrapper =
    input.closest(".field") ||
    input.parentElement;

  if (result !== true) {
    setFieldError(wrapper, result);
    return false;
  }

  clearFieldError(wrapper);

  return true;
}


// PATIENT REGISTRATION

const patientRegisterForm =
  document.getElementById("patientRegisterForm");


if (patientRegisterForm) {

  patientRegisterForm.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();

      const alertBox =
        patientRegisterForm.querySelector(".alert");

      const button =
        patientRegisterForm.querySelector(
          'button[type="submit"]'
        );

      clearAlert(alertBox);

      const fullname =
        document.getElementById("fullname");

      const email =
        document.getElementById("email");

      const password =
        document.getElementById("password");

      const phone =
        document.getElementById("phone");

      const dateOfBirth =
        document.getElementById("dateOfBirth");

      const gender =
        document.getElementById("gender");

      const bloodGroup =
        document.getElementById("bloodGroup");


      // Validate
      const valid =
        validateField(fullname, validators.fullname) &&
        validateField(email, validators.email) &&
        validateField(password, validators.password) &&
        validateField(phone, validators.phone) &&
        validateField(dateOfBirth, validators.dateOfBirth) &&
        validateField(gender, validators.gender) &&
        validateField(bloodGroup, validators.bloodGroup);


      if (!valid) {
        showAlert(
          alertBox,
          "error",
          "Please correct the highlighted fields."
        );

        return;
      }


      try {

        setLoading(button, true);


        const response = await apiPost(
          "/auth/register-patient",
          {
            fullname: fullname.value.trim(),
            email: email.value.trim().toLowerCase(),
            password: password.value,
            phone: phone.value.trim(),
            dateOfBirth: dateOfBirth.value,
            gender: gender.value,
            bloodGroup: bloodGroup.value,
          }
        );


        showAlert(
          alertBox,
          "success",
          response.message ||
            "Patient registered successfully."
        );


        patientRegisterForm.reset();


        // Redirect after successful registration.
        setTimeout(() => {
          window.location.href = "../Auth/login/login.html";
        }, 1500);


      } catch (error) {

        showAlert(
          alertBox,
          "error",
          error.message
        );

      } finally {

        setLoading(button, false);
      }
    }
  );
}



// LOGIN
const loginForm =
  document.getElementById("loginForm");


if (loginForm) {

  loginForm.addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();


      const alertBox =
        loginForm.querySelector(".alert");

      const button =
        loginForm.querySelector(
          'button[type="submit"]'
        );


      clearAlert(alertBox);


      const email =
        document.getElementById("loginEmail");

      const password =
        document.getElementById("loginPassword");


      const valid =
        validateField(email, validators.email) &&
        validateField(password, validators.required);


      if (!valid) {

        showAlert(
          alertBox,
          "error",
          "Please enter your email and password."
        );

        return;
      }


      try {

        setLoading(button, true);


        const response = await apiPost(
          "/auth/login",
          {
            email:
              email.value.trim().toLowerCase(),

            password:
              password.value,
          }
        );


        showAlert(
          alertBox,
          "success",
          response.message ||
            "Logged in successfully."
        );


        /*
         * The backend sets:
         *
         * accessToken
         * refreshToken
         *
         * as cookies.
         *
         * We do NOT save them to localStorage.
         */


        const user =
          response.data?.user;

        const role =
          user?.role;


        setTimeout(() => {

          if (role === "doctor") {

            window.location.href =
              "../Dashboards/Patient/doctor/index.html";

          } else if (role === "patient") {

            window.location.href =
              "../Dashboards/Patient/patient/index.html";

          } else if (role === "admin") {

            window.location.href =
              "../Dashboards/";

          } else {

            window.location.href =
              "/dashboard.html";
          }

        }, 700);


      } catch (error) {

        showAlert(
          alertBox,
          "error",
          error.message
        );

      } finally {

        setLoading(button, false);
      }
    }
  );
}


// LOGOUT

const logoutButton =
  document.getElementById("logoutBtn");


if (logoutButton) {

  logoutButton.addEventListener(
    "click",
    async () => {

      try {

        setLoading(logoutButton, true);


        const response =
          await apiPost("/auth/logout");


        console.log(
          response.message ||
            "Logged out successfully."
        );


      } catch (error) {

        console.error(
          "Logout error:",
          error.message
        );

      } finally {

        /*
         * Even if the logout request fails,
         * don't leave the user on the protected page.
         */

        window.location.href =
          "../Auth/login/login.html";
      }
    }
  );
}


// REFRESH ACCESS TOKEN

async function refreshAccessToken() {

  try {

    const response =
      await apiPost("/auth/refresh-token");


    return response.data;

  } catch (error) {

    console.error(
      "Token refresh failed:",
      error.message
    );

    return null;
  }
}


// GET CURRENT LOGGED-IN USER

async function getCurrentUser() {

  try {

    const response =
      await apiGet("/auth/me");


    return response.data;

  } catch (error) {

    console.error(
      "Unable to get current user:",
      error.message
    );

    return null;
  }
}


// CHECK AUTHENTICATION
async function requireAuth() {

  let user =
    await getCurrentUser();


  if (user) {
    return user;
  }


  // Access token may have expired.
  // Try refreshing it.

  const refreshed =
    await refreshAccessToken();


  if (!refreshed) {

    window.location.href =
      "../Auth/login/login.html";

    return null;
  }


  user =
    await getCurrentUser();


  if (!user) {

    window.location.href =
      "../Auth/login/login.html";

    return null;
  }


  return user;
}


// ROLE PROTECTION
async function requireRole(requiredRole) {

  const user =
    await requireAuth();


  if (!user) {
    return null;
  }


  if (user.role !== requiredRole) {

    if (user.role === "doctor") {

      window.location.href =
        "../Dashboards/Patient/doctor/index.html";

    } else if (user.role === "patient") {

      window.location.href =
        "../Dashboards/Patient/patient/index.html";

    } else if (user.role === "admin") {

      window.location.href =
        "../admin";
    }


    return null;
  }


  return user;
}