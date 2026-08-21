import request from "supertest";
import { app } from "../../../src/app.js";
import {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} from "../../setup/testDb.js";
import {
  createAdmin,
  createPatientUser,
  createDoctorUser,
  createAppointment,
} from "../../helpers/factories.js";
import { authHeader } from "../../helpers/auth.js";
import { User } from "../../../src/models/user.models.js";

let admin;
beforeAll(async () => {
  await connectTestDb();
});
afterEach(async () => {
  await clearTestDb();
});
afterAll(async () => {
  await disconnectTestDb();
});
beforeEach(async () => {
  admin = await createAdmin();
});

describe("GET /admin/patients", () => {
  test("lists patients with pagination", async () => {
    await createPatientUser();
    await createPatientUser();
    const res = await request(app)
      .get("/admin/patients")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.patients).toHaveLength(2);
  });

  test("filters by active/inactive status", async () => {
    await createPatientUser({ user: { isActive: true } });
    await createPatientUser({ user: { isActive: false } });
    const res = await request(app)
      .get("/admin/patients?status=inactive")
      .set(authHeader(admin, "admin"));
    expect(res.body.data.patients).toHaveLength(1);
  });
});

describe("GET /admin/patients/:patientId", () => {
  test("returns details and appointment statistics", async () => {
    const { patient } = await createPatientUser();
    const res = await request(app)
      .get(`/admin/patients/${patient.patientId}`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.patient.patientId).toBe(patient.patientId);
    expect(res.body.data.statistics.totalAppointments).toBe(0);
  });

  test("404s for unknown patientId", async () => {
    const res = await request(app)
      .get("/admin/patients/PAT-999999")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(404);
  });
});

describe("GET /admin/patients/:patientId/appointments", () => {
  test("never includes tokenNumber", async () => {
    const { doctor } = await createDoctorUser();
    const { user: pUser, patient } = await createPatientUser();
    await createAppointment(doctor._id, patient._id, pUser._id);
    const res = await request(app)
      .get(`/admin/patients/${patient.patientId}/appointments`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data.appointments)).not.toMatch(
      /tokenNumber/,
    );
  });
});

describe("Patient activate/disable", () => {
  test("disable sets isActive false", async () => {
    const { patient, user } = await createPatientUser({
      user: { isActive: true },
    });
    const res = await request(app)
      .patch(`/admin/patients/${patient.patientId}/disable`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    const updated = await User.findById(user._id);
    expect(updated.isActive).toBe(false);
  });

  test("disable on an already-inactive patient fails", async () => {
    const { patient } = await createPatientUser({ user: { isActive: false } });
    const res = await request(app)
      .patch(`/admin/patients/${patient.patientId}/disable`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(400);
  });

  test("activate sets isActive true", async () => {
    const { patient, user } = await createPatientUser({
      user: { isActive: false },
    });
    const res = await request(app)
      .patch(`/admin/patients/${patient.patientId}/activate`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    const updated = await User.findById(user._id);
    expect(updated.isActive).toBe(true);
  });
});
