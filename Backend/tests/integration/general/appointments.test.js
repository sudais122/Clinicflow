import request from "supertest";
import { app } from "../../../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "../../setup/testDb.js";
import { createDoctorUser, createPatientUser, createQueue, createAppointment } from "../../helpers/factories.js";
import { authHeader } from "../../helpers/auth.js";

// NOTE: /appointments/* paths are confirmed from the frontend's ENDPOINTS
// object built earlier in this conversation (book, patient, doctor,
// :id/status, :id/cancel) — these should match your real routes exactly.

beforeAll(async () => { await connectTestDb(); });
afterEach(async () => { await clearTestDb(); });
afterAll(async () => { await disconnectTestDb(); });

describe("POST /appointments/book", () => {
  test("a patient books for themselves and gets a token", async () => {
    const { doctor } = await createDoctorUser();
    await createQueue(doctor._id, { clinicStatus: "open" });
    const { user } = await createPatientUser({ user: { fullname: "Self Patient", phone: "03211234567" } });

    const res = await request(app).post("/appointments/book").set(authHeader(user, "patient")).send({
      doctorId: doctor._id.toString(), appointmentDate: new Date().toISOString(), bookFor: "self",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.queue.yourToken).toBe(1);
    expect(res.body.data.appointment.patientName).toBe("Self Patient");
  });

  test("books for someone else with a required name and phone", async () => {
    const { doctor } = await createDoctorUser();
    await createQueue(doctor._id);
    const { user } = await createPatientUser();

    const missing = await request(app).post("/appointments/book").set(authHeader(user, "patient")).send({
      doctorId: doctor._id.toString(), bookFor: "other",
    });
    expect(missing.status).toBe(400);

    const res = await request(app).post("/appointments/book").set(authHeader(user, "patient")).send({
      doctorId: doctor._id.toString(), bookFor: "other", patientName: "Grandma Khan", patientPhone: "03001112222",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.appointment.patientName).toBe("Grandma Khan");
  });

  test("blocks a second active booking with the same doctor for the same patient", async () => {
    const { doctor } = await createDoctorUser();
    await createQueue(doctor._id);
    const { user } = await createPatientUser({ user: { fullname: "Repeat Patient", phone: "03219999999" } });

    await request(app).post("/appointments/book").set(authHeader(user, "patient")).send({ doctorId: doctor._id.toString(), bookFor: "self" });
    const res = await request(app).post("/appointments/book").set(authHeader(user, "patient")).send({ doctorId: doctor._id.toString(), bookFor: "self" });
    expect(res.status).toBe(409);
  });

  test("rejects an invalid doctor id", async () => {
    const { user } = await createPatientUser();
    const res = await request(app).post("/appointments/book").set(authHeader(user, "patient")).send({ doctorId: "not-an-id", bookFor: "self" });
    expect(res.status).toBe(400);
  });

  test("queue info is null when the clinic is closed", async () => {
    const { doctor } = await createDoctorUser();
    await createQueue(doctor._id, { clinicStatus: "closed" });
    const { user } = await createPatientUser();
    const res = await request(app).post("/appointments/book").set(authHeader(user, "patient")).send({ doctorId: doctor._id.toString(), bookFor: "self" });
    expect(res.body.data.queue.nowServing).toBeNull();
    expect(res.body.data.queue.clinicStatus).toBe("closed");
  });
});

describe("GET /appointments/patient and /appointments/doctor", () => {
  test("patient sees their own appointments with live queue info attached", async () => {
    const { doctor } = await createDoctorUser();
    await createQueue(doctor._id, { clinicStatus: "open", nowServing: 0 });
    const { user, patient } = await createPatientUser();
    await createAppointment(doctor._id, patient._id, user._id, { tokenNumber: 3, status: "waiting" });

    const res = await request(app).get("/appointments/patient").set(authHeader(user, "patient"));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].queue.patientsAhead).toBe(2);
  });

  test("doctor sees their own appointments sorted by token", async () => {
    const { user: dUser, doctor } = await createDoctorUser();
    const { user: pUser, patient } = await createPatientUser();
    await createAppointment(doctor._id, patient._id, pUser._id, { tokenNumber: 2 });
    await createAppointment(doctor._id, patient._id, pUser._id, { tokenNumber: 1 });

    const res = await request(app).get("/appointments/doctor").set(authHeader(dUser, "doctor"));
    expect(res.status).toBe(200);
    expect(res.body.data[0].tokenNumber).toBe(1);
    expect(res.body.data[1].tokenNumber).toBe(2);
  });
});

describe("PATCH /appointments/:id/status", () => {
  test("doctor can move waiting -> in-progress", async () => {
    const { user: dUser, doctor } = await createDoctorUser();
    const { user: pUser, patient } = await createPatientUser();
    const appt = await createAppointment(doctor._id, patient._id, pUser._id, { status: "waiting" });

    const res = await request(app).patch(`/appointments/${appt._id}/status`).set(authHeader(dUser, "doctor")).send({ status: "in-progress" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("in-progress");
  });

  test("rejects an illegal transition (waiting -> completed, skipping in-progress)", async () => {
    const { user: dUser, doctor } = await createDoctorUser();
    const { user: pUser, patient } = await createPatientUser();
    const appt = await createAppointment(doctor._id, patient._id, pUser._id, { status: "waiting" });

    const res = await request(app).patch(`/appointments/${appt._id}/status`).set(authHeader(dUser, "doctor")).send({ status: "completed" });
    expect(res.status).toBe(400);
  });

  test("a different doctor cannot update someone else's appointment", async () => {
    const { doctor: doctorA } = await createDoctorUser();
    const { user: dUserB } = await createDoctorUser();
    const { user: pUser, patient } = await createPatientUser();
    const appt = await createAppointment(doctorA._id, patient._id, pUser._id, { status: "waiting" });

    const res = await request(app).patch(`/appointments/${appt._id}/status`).set(authHeader(dUserB, "doctor")).send({ status: "in-progress" });
    expect(res.status).toBe(403);
  });

  test("a patient cannot call this endpoint at all", async () => {
    const { doctor } = await createDoctorUser();
    const { user: pUser, patient } = await createPatientUser();
    const appt = await createAppointment(doctor._id, patient._id, pUser._id);
    const res = await request(app).patch(`/appointments/${appt._id}/status`).set(authHeader(pUser, "patient")).send({ status: "in-progress" });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /appointments/:id/cancel", () => {
  test("the booking patient can cancel their own waiting appointment", async () => {
    const { doctor } = await createDoctorUser();
    const { user, patient } = await createPatientUser();
    const appt = await createAppointment(doctor._id, patient._id, user._id, { status: "waiting" });

    const res = await request(app).patch(`/appointments/${appt._id}/cancel`).set(authHeader(user, "patient"));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
  });

  test("cannot cancel an already-completed appointment", async () => {
    const { doctor } = await createDoctorUser();
    const { user, patient } = await createPatientUser();
    const appt = await createAppointment(doctor._id, patient._id, user._id, { status: "completed" });

    const res = await request(app).patch(`/appointments/${appt._id}/cancel`).set(authHeader(user, "patient"));
    expect(res.status).toBe(400);
  });

  test("a different patient cannot cancel someone else's appointment", async () => {
    const { doctor } = await createDoctorUser();
    const { user: ownerUser, patient: ownerPatient } = await createPatientUser();
    const { user: strangerUser } = await createPatientUser();
    const appt = await createAppointment(doctor._id, ownerPatient._id, ownerUser._id, { status: "waiting" });

    const res = await request(app).patch(`/appointments/${appt._id}/cancel`).set(authHeader(strangerUser, "patient"));
    expect(res.status).toBe(403);
  });
});
