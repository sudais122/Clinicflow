const BASE_URL = "http://localhost:8000";
const REGISTER_ENDPOINT = `${BASE_URL}/auth/register-doctor`; // GUESS — confirm real path

const payload = {
  fullname: "Test one",
  email: "test1@gmail.com", // ADJUST — must be unique
  password: "Doctor@123",
  phone: "03009998888", // ADJUST — must be unique
  clinicName: "Test Clinic",
  clinicAddress: "123 Test Street, Test City",
  specialization: "General Physician",
  licenseNumber: "LIC-TEST-0001", // ADJUST — must be unique
  experience: 5,
  consultationFee: 1500,
};

async function run() {
  console.log(`=== Registering doctor: ${payload.email} ===`);

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
    console.log("Reminder: status is likely 'pending' until an admin approves it.");
  }
}

run().catch((err) => {
  console.error("Request failed:", err.message);
  process.exit(1);
});