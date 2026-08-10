// ============================================================
//  ClinicFlow — API configuration
//  Change this file per environment. It is the ONLY place the
//  API URL and demo settings live.
// ============================================================
window.CLINICFLOW_CONFIG = {
  // Real backend base URL (used when MOCK is false).
  API_BASE: "http://localhost:8000",

  // ---- Demo / mock mode ----
  // true  = no backend needed; OTP flow is simulated in the browser.
  // false = calls hit the real API_BASE above.
  MOCK: true,

  // Fake credentials used only when MOCK is true:
  MOCK_OTP: "123456",                 // the code that "works"
  MOCK_EMAIL: "patient@clinicflow.test", // a registered demo email
};