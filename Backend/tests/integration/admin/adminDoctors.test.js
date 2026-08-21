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
  createSubscription,
  createAppointment,
  createPatientUser,
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

describe("GET /admin/doctors", () => {
  test("lists doctors with pagination metadata", async () => {
    await createDoctorUser();
    await createDoctorUser();
    const res = await request(app)
      .get("/admin/doctors")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.doctors).toHaveLength(2);
    expect(res.body.data.pagination.total).toBe(2);
  });

  test("filters by status", async () => {
    await createDoctorUser({ doctor: { status: "pending" } });
    await createDoctorUser({ doctor: { status: "active" } });
    const res = await request(app)
      .get("/admin/doctors?status=active")
      .set(authHeader(admin, "admin"));
    expect(res.body.data.doctors).toHaveLength(1);
    expect(res.body.data.doctors[0].status).toBe("active");
  });

  test("rejects an invalid status filter", async () => {
    const res = await request(app)
      .get("/admin/doctors?status=bogus")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(400);
  });

  test("search matches by fullname", async () => {
    await createDoctorUser({ user: { fullname: "Dr. Ayesha Khan" } });
    await createDoctorUser({ user: { fullname: "Dr. Bilal Ahmed" } });
    const res = await request(app)
      .get("/admin/doctors?search=Ayesha")
      .set(authHeader(admin, "admin"));
    expect(res.body.data.doctors).toHaveLength(1);
  });
});

describe("GET /admin/doctors/:doctorId", () => {
  test("returns full doctor details, statistics, and subscription", async () => {
    const { doctor } = await createDoctorUser();
    await createSubscription(doctor._id, {
      plan: "paid",
      price: 3000,
      endDate: new Date(Date.now() + 30 * 86400000),
    });

    const res = await request(app)
      .get(`/admin/doctors/${doctor.doctorId}`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.doctor.doctorId).toBe(doctor.doctorId);
    expect(res.body.data.statistics.totalAppointments).toBe(0);
    expect(res.body.data.subscription.plan).toBe("paid");
    expect(res.body.data.subscription.status).toBe("active");
  });

  test("derives 'expired' for a paid subscription past its end date", async () => {
    const { doctor } = await createDoctorUser();
    await createSubscription(doctor._id, {
      plan: "paid",
      price: 3000,
      endDate: new Date(Date.now() - 86400000),
      status: "active",
    });
    const res = await request(app)
      .get(`/admin/doctors/${doctor.doctorId}`)
      .set(authHeader(admin, "admin"));
    expect(res.body.data.subscription.status).toBe("expired");
  });

  test("response never includes isSuspended or the word Suspended", async () => {
    const { doctor } = await createDoctorUser({
      doctor: { isSuspended: true, suspensionReason: "test" },
    });
    const res = await request(app)
      .get(`/admin/doctors/${doctor.doctorId}`)
      .set(authHeader(admin, "admin"));
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/isSuspended/i);
    expect(raw).not.toMatch(/Suspended/);
  });

  test("404s for a doctorId that doesn't exist", async () => {
    const res = await request(app)
      .get("/admin/doctors/DR-999999")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(404);
  });
});

describe("GET /admin/doctors/:doctorId/appointments", () => {
  test("never includes tokenNumber in the response", async () => {
    const { doctor } = await createDoctorUser();
    const { user: pUser, patient } = await createPatientUser();
    await createAppointment(doctor._id, patient._id, pUser._id);

    const res = await request(app)
      .get(`/admin/doctors/${doctor.doctorId}/appointments`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.totalAppointments).toBe(1);
    expect(JSON.stringify(res.body.data.appointments)).not.toMatch(
      /tokenNumber/,
    );
  });

  test("filters by date and updates the total", async () => {
    const { doctor } = await createDoctorUser();
    const { user: pUser, patient } = await createPatientUser();
    await createAppointment(doctor._id, patient._id, pUser._id, {
      appointmentDate: new Date("2026-01-01"),
    });
    await createAppointment(doctor._id, patient._id, pUser._id, {
      appointmentDate: new Date("2026-06-15"),
    });

    const res = await request(app)
      .get(`/admin/doctors/${doctor.doctorId}/appointments?date=2026-01-01`)
      .set(authHeader(admin, "admin"));
    expect(res.body.data.totalAppointments).toBe(1);
  });
});

describe("Doctor status actions", () => {
  test("approve moves pending -> active and syncs User.isActive", async () => {
    const { doctor, user } = await createDoctorUser({
      doctor: { status: "pending" },
    });
    const res = await request(app)
      .patch(`/admin/doctors/${doctor.doctorId}/approve`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("active");
    const updatedUser = await User.findById(user._id);
    expect(updatedUser.isActive).toBe(true);
  });

  test("approve on an already-active doctor fails", async () => {
    const { doctor } = await createDoctorUser({ doctor: { status: "active" } });
    const res = await request(app)
      .patch(`/admin/doctors/${doctor.doctorId}/approve`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(400);
  });

  test("deactivate moves active -> inactive and syncs User.isActive to false", async () => {
    const { doctor, user } = await createDoctorUser({
      doctor: { status: "active" },
    });
    const res = await request(app)
      .patch(`/admin/doctors/${doctor.doctorId}/deactivate`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("inactive");
    const updatedUser = await User.findById(user._id);
    expect(updatedUser.isActive).toBe(false);
  });

  test("activate moves inactive -> active", async () => {
    const { doctor } = await createDoctorUser({
      doctor: { status: "inactive" },
    });
    const res = await request(app)
      .patch(`/admin/doctors/${doctor.doctorId}/activate`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("active");
  });

  test("404s for actions on an unknown doctor", async () => {
    const res = await request(app)
      .patch("/admin/doctors/DR-999999/approve")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(404);
  });
});
