const BASE_URL = "http://localhost:8000";
const REGISTER_ENDPOINT = `${BASE_URL}/auth/register/register-patient`; // GUESS — confirm real path

const payload = {
  fullname: "Test Patient",
  email: "testpatient1@gmail.com", // ADJUST — must be unique
  password: "PAtient@123",
  phone: "03001112222", // ADJUST — must be unique
  gender: "male", // ADJUST if required: male | female | other
  bloodGroup: "O+", // ADJUST if required
  dateOfBirth: "1995-01-01", // ADJUST if required
};

async function run() {
  console.log(`=== Registering patient: ${payload.email} ===`);

  const res = await fetch(REGISTER_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }

  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2));

  if (res.status === 404) {
    console.log("\nThe endpoint path is wrong — send me the real registration route/controller.");
  } else if (res.status === 400) {
    console.log("\nField-validation error — this message tells us exactly which field name/shape to fix.");
  } else if (res.ok) {
    console.log("\nRegistered successfully.");
  }
}

run().catch((err) => {
  console.error("Request failed:", err.message);
  process.exit(1);
});