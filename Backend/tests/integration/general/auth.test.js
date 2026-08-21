import request from "supertest";
import { app } from "../../../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "../../setup/testDb.js";
import { createDoctorUser, createPatientUser } from "../../helpers/factories.js";
import { authHeader } from "../../helpers/auth.js";
import { User } from "../../../src/models/user.models.js";

// NOTE: routes here (/auth/register/doctor, /auth/register/patient, /auth/login,
// /auth/refresh-token, /auth/logout) are ASSUMED — the real route file for
// user.controller.js was never shared in the conversation this suite was
// built from. Only /auth/logout is confirmed (used by the frontend). If your
// real paths differ, update tests/integration/general/auth.test.js's URLs —
// the controller logic being tested is exact either way.

beforeAll(async () => { await connectTestDb(); });
afterEach(async () => { await clearTestDb(); });
afterAll(async () => { await disconnectTestDb(); });

const validDoctorPayload = {
  fullname: "Ahmed Hassan",
  email: "dr.ahmed@example.com",
  password: "Doctor@123",
  phone: "03001234567",
  clinicName: "Care Point Clinic",
  clinicAddress: "Street 12, Blue Area, Islamabad",
  specialization: "Cardiology",
  licenseNumber: "LIC-00123",
  experience: 8,
  consultationFee: 1500,
};

const validPatientPayload = {
  fullname: "Ayesha Khan",
  email: "ayesha.khan@example.com",
  password: "Patient@123",
  phone: "03111234567",
  dateOfBirth: "1998-05-14",
  gender: "female",
  bloodGroup: "O+",
};

describe("POST /auth/register/doctor", () => {
  test("registers a doctor, creates a free 30-day subscription and a queue", async () => {
    const res = await request(app).post("/auth/register/doctor").send(validDoctorPayload);
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe("doctor");
    expect(res.body.data.doctor.doctorId).toBeDefined();
    expect(res.body.data.doctor.clinicStatus).toBe("closed");
  });

  test("normalizes the name to start with 'Dr.'", async () => {
    const res = await request(app).post("/auth/register/doctor").send({ ...validDoctorPayload, fullname: "Ahmed Hassan" });
    expect(res.body.data.user.fullname).toMatch(/^Dr\./);
  });

  test("rejects a duplicate email", async () => {
    await request(app).post("/auth/register/doctor").send(validDoctorPayload);
    const res = await request(app).post("/auth/register/doctor").send({ ...validDoctorPayload, licenseNumber: "LIC-00999" });
    expect(res.status).toBe(409);
  });

  test("rejects a duplicate license number", async () => {
    await request(app).post("/auth/register/doctor").send(validDoctorPayload);
    const res = await request(app).post("/auth/register/doctor").send({ ...validDoctorPayload, email: "other@example.com" });
    expect(res.status).toBe(409);
  });

  test("rejects a weak password", async () => {
    const res = await request(app).post("/auth/register/doctor").send({ ...validDoctorPayload, password: "weak" });
    expect(res.status).toBe(400);
  });

  test("rejects a phone number not starting with 03", async () => {
    const res = await request(app).post("/auth/register/doctor").send({ ...validDoctorPayload, phone: "12345678901" });
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/register/patient", () => {
  test("registers a patient successfully", async () => {
    const res = await request(app).post("/auth/register/patient").send(validPatientPayload);
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe("patient");
    expect(res.body.data.patient.patientId).toBeDefined();
  });

  test("rejects a future date of birth", async () => {
    const res = await request(app).post("/auth/register/patient").send({ ...validPatientPayload, dateOfBirth: "2999-01-01" });
    expect(res.status).toBe(400);
  });

  test("rejects an invalid blood group", async () => {
    const res = await request(app).post("/auth/register/patient").send({ ...validPatientPayload, bloodGroup: "Z+" });
    expect(res.status).toBe(400);
  });

  test("rejects a duplicate phone number", async () => {
    await request(app).post("/auth/register/patient").send(validPatientPayload);
    const res = await request(app).post("/auth/register/patient").send({ ...validPatientPayload, email: "other2@example.com" });
    expect(res.status).toBe(409);
  });
});

describe("POST /auth/login", () => {
  test("logs in a patient with correct credentials and returns their profileId", async () => {
    await request(app).post("/auth/register/patient").send(validPatientPayload);
    const res = await request(app).post("/auth/login").send({ email: validPatientPayload.email, password: validPatientPayload.password });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe("patient");
    expect(res.body.data.profileId).toMatch(/^PAT-/);
  });

  test("rejects wrong password", async () => {
    await request(app).post("/auth/register/patient").send(validPatientPayload);
    const res = await request(app).post("/auth/login").send({ email: validPatientPayload.email, password: "WrongPass1!" });
    expect(res.status).toBe(401);
  });

  test("rejects a deactivated account", async () => {
    await createPatientUser({ user: { email: "deact@test.com", isActive: false } });
    const res = await request(app).post("/auth/login").send({ email: "deact@test.com", password: "Password1!" });
    expect(res.status).toBe(403);
  });

  test("404s for a nonexistent email", async () => {
    const res = await request(app).post("/auth/login").send({ email: "nobody@test.com", password: "Password1!" });
    expect(res.status).toBe(404);
  });
});

describe("POST /auth/logout", () => {
  test("clears the stored refresh token", async () => {
    const { user } = await createPatientUser();
    const res = await request(app).post("/auth/logout").set(authHeader(user, "patient"));
    expect(res.status).toBe(200);
    const updated = await User.findById(user._id);
    expect(updated.refreshToken).toBe("");
  });

  test("requires auth", async () => {
    const res = await request(app).post("/auth/logout");
    expect(res.status).toBe(401);
  });
});
