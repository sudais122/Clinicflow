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

describe("GET /admin/reports/problems", () => {
  test("lists reports and never exposes a priority field", async () => {
    const { user } = await createPatientUser();
    await createReport(user._id, "patient");
    const res = await request(app)
      .get("/admin/reports/problems")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.reports).toHaveLength(1);
    expect(JSON.stringify(res.body.data.reports)).not.toMatch(/priority/i);
  });

  test("filters by status", async () => {
    const { user } = await createPatientUser();
    await createReport(user._id, "patient", { status: "pending" });
    await createReport(user._id, "patient", { status: "resolved" });
    const res = await request(app)
      .get("/admin/reports/problems?status=resolved")
      .set(authHeader(admin, "admin"));
    expect(res.body.data.reports).toHaveLength(1);
  });

  test("rejects an unrecognized status filter", async () => {
    const res = await request(app)
      .get("/admin/reports/problems?status=urgent")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(400);
  });
});

describe("Report status transitions", () => {
  test("pending -> inreview via /review", async () => {
    const { user } = await createPatientUser();
    const report = await createReport(user._id, "patient", {
      status: "pending",
    });
    const res = await request(app)
      .patch(`/admin/reports/problems/${report._id}/review`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("inreview");
  });

  test("cannot move an already-resolved report to review", async () => {
    const { user } = await createPatientUser();
    const report = await createReport(user._id, "patient", {
      status: "resolved",
    });
    const res = await request(app)
      .patch(`/admin/reports/problems/${report._id}/review`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(400);
  });

  test("resolve requires a resolution and sets status to resolved", async () => {
    const { user } = await createPatientUser();
    const report = await createReport(user._id, "patient", {
      status: "inreview",
    });

    const missing = await request(app)
      .patch(`/admin/reports/problems/${report._id}/resolve`)
      .set(authHeader(admin, "admin"))
      .send({});
    expect(missing.status).toBe(400);

    const res = await request(app)
      .patch(`/admin/reports/problems/${report._id}/resolve`)
      .set(authHeader(admin, "admin"))
      .send({ resolution: "Fixed and verified." });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("resolved");
  });

  test("404s for an unknown report id", async () => {
    const fakeId = "64b000000000000000000000";
    const res = await request(app)
      .patch(`/admin/reports/problems/${fakeId}/review`)
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(404);
  });
});
