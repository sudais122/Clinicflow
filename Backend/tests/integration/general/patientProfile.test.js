import request from "supertest";
import { app } from "../../../src/app.js";
import { connectTestDb, clearTestDb, disconnectTestDb } from "../../setup/testDb.js";
import { createPatientUser } from "../../helpers/factories.js";
import { authHeader } from "../../helpers/auth.js";

beforeAll(async () => { await connectTestDb(); });
afterEach(async () => { await clearTestDb(); });
afterAll(async () => { await disconnectTestDb(); });

describe("GET /patient/me", () => {
  test("returns the User doc plus the nested patient profile", async () => {
    const { user } = await createPatientUser({ user: { fullname: "Ayesha" } });
    const res = await request(app).get("/patient/me").set(authHeader(user, "patient"));
    expect(res.status).toBe(200);
    expect(res.body.data.fullname).toBe("Ayesha");
    expect(res.body.data.profile.patientId).toBeDefined();
  });

  test("requires auth", async () => {
    const res = await request(app).get("/patient/me");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /patient/profile", () => {
  test("updates fullname and phone together", async () => {
    const { user } = await createPatientUser();
    const res = await request(app).patch("/patient/profile").set(authHeader(user, "patient")).send({ fullname: "Updated Name", phone: "+923001234567" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.fullname).toBe("Updated Name");
  });

  test("rejects an empty payload", async () => {
    const { user } = await createPatientUser();
    const res = await request(app).patch("/patient/profile").set(authHeader(user, "patient")).send({});
    expect(res.status).toBe(400);
  });

  test("rejects an invalid blood group", async () => {
    const { user } = await createPatientUser();
    const res = await request(app).patch("/patient/profile").set(authHeader(user, "patient")).send({ bloodGroup: "Z+" });
    expect(res.status).toBe(400);
  });

  test("rejects a future date of birth", async () => {
    const { user } = await createPatientUser();
    const res = await request(app).patch("/patient/profile").set(authHeader(user, "patient")).send({ dateOfBirth: "2999-01-01" });
    expect(res.status).toBe(400);
  });
});
