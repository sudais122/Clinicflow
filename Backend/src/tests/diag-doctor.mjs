const BASE = "http://localhost:8000";
const id = Date.now();

async function call(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  let json = null;
  try { json = await res.json(); } catch {}
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookie.join("; ").split(",").map((c) => c.trim().split(";")[0]).join("; ");
  return { status: res.status, json, cookie };
}

const email = `diag.doctor.${id}@example.com`;
const password = "TestPass123!";

const reg = await call("/auth/register-doctor", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    fullname: "Diag Doctor",
    email,
    password,
    phone: `03${String(id).slice(-9)}`,
    clinicName: "Diag Clinic",
    clinicAddress: "1 Diag Street, Test City, Test Province",
    specialization: "General Medicine",
    licenseNumber: `DIAG-${id}`,
    experience: "5",
    consultationFee: "1000",
  }),
});
console.log("REGISTER:", reg.status, JSON.stringify(reg.json, null, 2));

const login = await call("/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
console.log("\nLOGIN:", login.status);

const dash = await call("/dashboard/doctor", { headers: { Cookie: login.cookie } });
console.log("\nDASHBOARD:", dash.status, JSON.stringify(dash.json, null, 2));