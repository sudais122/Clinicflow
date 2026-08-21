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

describe("GET /admin/subscriptions", () => {
  test("lists subscriptions with liveStatus attached", async () => {
    const { doctor } = await createDoctorUser();
    await createSubscription(doctor._id, { plan: "free" });
    const res = await request(app)
      .get("/admin/subscriptions")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.subscriptions).toHaveLength(1);
    expect(res.body.data.subscriptions[0].liveStatus).toBe("active");
  });

  test("liveStatus flips to expired for a lapsed paid plan even if stored status is still active", async () => {
    const { doctor } = await createDoctorUser();
    await createSubscription(doctor._id, {
      plan: "paid",
      status: "active",
      endDate: new Date(Date.now() - 86400000),
    });
    const res = await request(app)
      .get("/admin/subscriptions")
      .set(authHeader(admin, "admin"));
    expect(res.body.data.subscriptions[0].liveStatus).toBe("expired");
  });

  test("filters by plan", async () => {
    const d1 = await createDoctorUser();
    const d2 = await createDoctorUser();
    await createSubscription(d1.doctor._id, { plan: "free" });
    await createSubscription(d2.doctor._id, { plan: "paid" });
    const res = await request(app)
      .get("/admin/subscriptions?plan=paid")
      .set(authHeader(admin, "admin"));
    expect(res.body.data.subscriptions).toHaveLength(1);
    expect(res.body.data.subscriptions[0].plan).toBe("paid");
  });

  test("rejects an invalid plan filter", async () => {
    const res = await request(app)
      .get("/admin/subscriptions?plan=premium")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /admin/subscriptions/:id/extend", () => {
  test("extends a future end date by N days from that date, not from today", async () => {
    const { doctor } = await createDoctorUser();
    const future = new Date(Date.now() + 10 * 86400000);
    const sub = await createSubscription(doctor._id, {
      plan: "paid",
      endDate: future,
    });

    const res = await request(app)
      .patch(`/admin/subscriptions/${sub.subscriptionId}/extend`)
      .set(authHeader(admin, "admin"))
      .send({ days: 30 });
    expect(res.status).toBe(200);
    const newEnd = new Date(res.body.data.endDate);
    const expected = new Date(future);
    expected.setDate(expected.getDate() + 30);
    expect(Math.abs(newEnd.getTime() - expected.getTime())).toBeLessThan(5000);
  });

  test("extending a lapsed subscription flips status back to active", async () => {
    const { doctor } = await createDoctorUser();
    const sub = await createSubscription(doctor._id, {
      plan: "paid",
      status: "expired",
      endDate: new Date(Date.now() - 86400000),
    });
    const res = await request(app)
      .patch(`/admin/subscriptions/${sub.subscriptionId}/extend`)
      .set(authHeader(admin, "admin"))
      .send({ days: 30 });
    expect(res.body.data.status).toBe("active");
  });

  test("rejects a non-positive days value", async () => {
    const { doctor } = await createDoctorUser();
    const sub = await createSubscription(doctor._id, { plan: "paid" });
    const res = await request(app)
      .patch(`/admin/subscriptions/${sub.subscriptionId}/extend`)
      .set(authHeader(admin, "admin"))
      .send({ days: 0 });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /admin/subscriptions/:id/plan", () => {
  test("switching to free resets price to 0", async () => {
    const { doctor } = await createDoctorUser();
    const sub = await createSubscription(doctor._id, {
      plan: "paid",
      price: 3000,
    });
    const res = await request(app)
      .patch(`/admin/subscriptions/${sub.subscriptionId}/plan`)
      .set(authHeader(admin, "admin"))
      .send({ plan: "free" });
    expect(res.status).toBe(200);
    expect(res.body.data.price).toBe(0);
  });

  test("switching to paid accepts a custom price", async () => {
    const { doctor } = await createDoctorUser();
    const sub = await createSubscription(doctor._id, { plan: "free" });
    const res = await request(app)
      .patch(`/admin/subscriptions/${sub.subscriptionId}/plan`)
      .set(authHeader(admin, "admin"))
      .send({ plan: "paid", price: 5000 });
    expect(res.body.data.price).toBe(5000);
  });

  test("rejects a plan value outside free/paid", async () => {
    const { doctor } = await createDoctorUser();
    const sub = await createSubscription(doctor._id, {});
    const res = await request(app)
      .patch(`/admin/subscriptions/${sub.subscriptionId}/plan`)
      .set(authHeader(admin, "admin"))
      .send({ plan: "premium" });
    expect(res.status).toBe(400);
  });
});
