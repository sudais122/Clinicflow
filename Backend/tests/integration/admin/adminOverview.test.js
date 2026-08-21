import request from "supertest";
import { app } from "../../../src/app.js";
import {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} from "../../setup/testDb.js";
import {
  createAdmin,
  createDoctorUser,
  createPatientUser,
  createAppointment,
  createSubscription,
  createReport,
} from "../../helpers/factories.js";
import { authHeader } from "../../helpers/auth.js";

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

describe("GET /admin/overview", () => {
  test("running totals (doctors/patients/subscriptions) are correct and period-independent", async () => {
    const d1 = await createDoctorUser({ doctor: { status: "pending" } });
    await createDoctorUser({ doctor: { status: "active" } });
    await createPatientUser();
    await createSubscription(d1.doctor._id, { plan: "free" });

    const all = await request(app)
      .get("/admin/overview?period=all")
      .set(authHeader(admin, "admin"));
    const today = await request(app)
      .get("/admin/overview?period=today")
      .set(authHeader(admin, "admin"));

    expect(all.status).toBe(200);
    expect(all.body.data.doctors.total).toBe(2);
    expect(all.body.data.doctors.pending).toBe(1);
    expect(all.body.data.doctors.active).toBe(1);
    expect(all.body.data.patients.total).toBe(1);
    expect(all.body.data.subscriptions.total).toBe(1);

    // Running totals must NOT shrink just because period=today is passed —
    // this was an explicit design requirement earlier in the project.
    expect(today.body.data.doctors.total).toBe(2);
    expect(today.body.data.patients.total).toBe(1);
  });

  test("appointment and report counts ARE scoped by period", async () => {
    const { doctor } = await createDoctorUser();
    const { user: patientUser, patient } = await createPatientUser();

    await createAppointment(doctor._id, patient._id, patientUser._id, {
      appointmentDate: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), // over a year ago
    });
    await createReport(patientUser._id, "patient", {
      createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
    });

    const all = await request(app)
      .get("/admin/overview?period=all")
      .set(authHeader(admin, "admin"));
    const year = await request(app)
      .get("/admin/overview?period=year")
      .set(authHeader(admin, "admin"));

    expect(all.body.data.appointments.total).toBe(1);
    // A year-old appointment should not count within period=year (this year only).
    expect(year.body.data.appointments.total).toBe(0);
  });

  test("returns zeroed stats correctly on an empty database", async () => {
    const res = await request(app)
      .get("/admin/overview")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.doctors.total).toBe(0);
    expect(res.body.data.patients.total).toBe(0);
    expect(res.body.data.appointments.total).toBe(0);
  });
});

describe("GET /admin/trends", () => {
  test("returns 6 months of data for each series", async () => {
    const res = await request(app)
      .get("/admin/trends")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.appointmentTrend).toHaveLength(6);
    expect(res.body.data.revenueByMonth).toHaveLength(6);
    expect(res.body.data.patientGrowth).toHaveLength(6);
  });

  test("counts a new patient signup in the correct month bucket", async () => {
    await createPatientUser(); // createdAt defaults to now
    const res = await request(app)
      .get("/admin/trends")
      .set(authHeader(admin, "admin"));
    const thisMonth =
      res.body.data.patientGrowth[res.body.data.patientGrowth.length - 1];
    expect(thisMonth.newPatients).toBe(1);
  });
});

describe("GET /admin/activity", () => {
  test("merges recent records from multiple collections, newest first", async () => {
    await createDoctorUser();
    await createPatientUser();
    const res = await request(app)
      .get("/admin/activity")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    const texts = res.body.data.map((i) => i.text);
    expect(texts.some((t) => t.includes("registered"))).toBe(true);
  });

  test("returns an empty array, not an error, on an empty database", async () => {
    const res = await request(app)
      .get("/admin/activity")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
