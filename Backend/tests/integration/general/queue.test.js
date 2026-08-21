import request from "supertest";
import { app } from "../../../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "../../setup/testDb.js";
import { createDoctorUser, createPatientUser, createQueue, createAppointment } from "../../helpers/factories.js";
import { authHeader } from "../../helpers/auth.js";
import { Appointment } from "../../../src/models/appointment.models.js";

// NOTE: /queue/* paths are ASSUMED (start/next/delay/time/end/reset were
// confirmed by the frontend; the exact route file was never shared). Adjust
// the URLs below if your real mount differs — controller logic is exact.

beforeAll(async () => { await connectTestDb(); });
afterEach(async () => { await clearTestDb(); });
afterAll(async () => { await disconnectTestDb(); });

describe("PATCH /queue/start and /queue/end", () => {
  test("only a doctor can start their own clinic", async () => {
    const { user, doctor } = await createDoctorUser();
    await createQueue(doctor._id);
    const res = await request(app).patch("/queue/start").set(authHeader(user, "doctor"));
    expect(res.status).toBe(200);
    expect(res.body.data.clinicStatus).toBe("open");
  });

  test("a patient cannot start a clinic", async () => {
    const { user } = await createPatientUser();
    const res = await request(app).patch("/queue/start").set(authHeader(user, "patient"));
    expect(res.status).toBe(403);
  });

  test("end closes the clinic", async () => {
    const { user, doctor } = await createDoctorUser();
    await createQueue(doctor._id, { clinicStatus: "open" });
    const res = await request(app).patch("/queue/end").set(authHeader(user, "doctor"));
    expect(res.status).toBe(200);
    expect(res.body.data.clinicStatus).toBe("closed");
  });
});

describe("PATCH /queue/next", () => {
  test("refuses to advance a closed clinic", async () => {
    const { user, doctor } = await createDoctorUser();
    await createQueue(doctor._id, { clinicStatus: "closed" });
    const res = await request(app).patch("/queue/next").set(authHeader(user, "doctor"));
    expect(res.status).toBe(400);
  });

  test("refuses to advance when there's no one left to call", async () => {
    const { user, doctor } = await createDoctorUser();
    await createQueue(doctor._id, { clinicStatus: "open", nowServing: 0, lastToken: 0 });
    const res = await request(app).patch("/queue/next").set(authHeader(user, "doctor"));
    expect(res.status).toBe(400);
  });

  test("advances nowServing, completes the previous token, and marks the new one in-progress", async () => {
    const { user, doctor } = await createDoctorUser();
    const { user: pUser, patient } = await createPatientUser();
    await createQueue(doctor._id, { clinicStatus: "open", nowServing: 0, lastToken: 2 });
    const appt1 = await createAppointment(doctor._id, patient._id, pUser._id, { tokenNumber: 1, status: "waiting" });
    await createAppointment(doctor._id, patient._id, pUser._id, { tokenNumber: 2, status: "waiting" });

    const res = await request(app).patch("/queue/next").set(authHeader(user, "doctor"));
    expect(res.status).toBe(200);
    expect(res.body.data.currentToken).toBe(1);

    const updatedAppt1 = await Appointment.findById(appt1._id);
    expect(updatedAppt1.status).toBe("in-progress");
  });

  test("calling next again completes token 1 and starts token 2", async () => {
    const { user, doctor } = await createDoctorUser();
    const { user: pUser, patient } = await createPatientUser();
    await createQueue(doctor._id, { clinicStatus: "open", nowServing: 0, lastToken: 2 });
    const appt1 = await createAppointment(doctor._id, patient._id, pUser._id, { tokenNumber: 1, status: "waiting" });
    const appt2 = await createAppointment(doctor._id, patient._id, pUser._id, { tokenNumber: 2, status: "waiting" });

    await request(app).patch("/queue/next").set(authHeader(user, "doctor"));
    const res2 = await request(app).patch("/queue/next").set(authHeader(user, "doctor"));
    expect(res2.body.data.currentToken).toBe(2);

    expect((await Appointment.findById(appt1._id)).status).toBe("completed");
    expect((await Appointment.findById(appt2._id)).status).toBe("in-progress");
  });
});

describe("PATCH /queue/delay", () => {
  test("sets a valid delay", async () => {
    const { user, doctor } = await createDoctorUser();
    await createQueue(doctor._id);
    const res = await request(app).patch("/queue/delay").set(authHeader(user, "doctor")).send({ delay: 15 });
    expect(res.status).toBe(200);
    expect(res.body.data.delayInMinutes).toBe(15);
  });

  test("rejects a negative delay", async () => {
    const { user, doctor } = await createDoctorUser();
    await createQueue(doctor._id);
    const res = await request(app).patch("/queue/delay").set(authHeader(user, "doctor")).send({ delay: -5 });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /queue/reset", () => {
  test("zeroes counters and closes the clinic", async () => {
    const { user, doctor } = await createDoctorUser();
    await createQueue(doctor._id, { clinicStatus: "open", nowServing: 5, lastToken: 10, delayInMinutes: 20 });
    const res = await request(app).patch("/queue/reset").set(authHeader(user, "doctor"));
    expect(res.status).toBe(200);
    expect(res.body.data.nowServing).toBe(0);
    expect(res.body.data.lastToken).toBe(0);
    expect(res.body.data.delayInMinutes).toBe(0);
    expect(res.body.data.clinicStatus).toBe("closed");
  });
});
