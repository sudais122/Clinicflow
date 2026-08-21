import request from "supertest";
import { app } from "../../../src/app.js";
import {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} from "../../setup/testDb.js";
import { createAdmin } from "../../helpers/factories.js";

beforeAll(async () => {
  await connectTestDb();
});
afterEach(async () => {
  await clearTestDb();
});
afterAll(async () => {
  await disconnectTestDb();
});

describe("POST /admin/login", () => {
  test("logs in with correct credentials and sets cookies", async () => {
    await createAdmin({ email: "boss@test.com", password: "Password1!" });
    const res = await request(app)
      .post("/admin/login")
      .send({ email: "boss@test.com", password: "Password1!" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.admin.email).toBe("boss@test.com");
    expect(res.body.data.admin.role).toBe("admin");
    expect(res.body.data.accessToken).toBeDefined();
    expect(
      res.headers["set-cookie"].some((c) => c.startsWith("accessToken=")),
    ).toBe(true);
  });

  test("rejects wrong password without revealing which field was wrong", async () => {
    await createAdmin({ email: "boss@test.com", password: "Password1!" });
    const res = await request(app)
      .post("/admin/login")
      .send({ email: "boss@test.com", password: "WrongPass1!" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid admin credentials");
  });

  test("rejects unknown email with the same generic message", async () => {
    const res = await request(app)
      .post("/admin/login")
      .send({ email: "nobody@test.com", password: "Password1!" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid admin credentials");
  });

  test("rejects a deactivated admin account", async () => {
    await createAdmin({
      email: "boss@test.com",
      password: "Password1!",
      isActive: false,
    });
    const res = await request(app)
      .post("/admin/login")
      .send({ email: "boss@test.com", password: "Password1!" });
    expect(res.status).toBe(403);
  });

  test("requires both email and password", async () => {
    const res = await request(app)
      .post("/admin/login")
      .send({ email: "boss@test.com" });
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/me", () => {
  test("returns 401 with no token", async () => {
    const res = await request(app).get("/admin/me");
    expect(res.status).toBe(401);
  });

  test("returns the admin's own profile when authenticated", async () => {
    const admin = await createAdmin({ email: "boss@test.com" });
    const login = await request(app)
      .post("/admin/login")
      .send({ email: "boss@test.com", password: "Password1!" });
    const token = login.body.data.accessToken;

    const res = await request(app)
      .get("/admin/me")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("boss@test.com");
  });
});

describe("POST /admin/logout", () => {
  test("clears the refresh token and requires auth", async () => {
    const unauth = await request(app).post("/admin/logout");
    expect(unauth.status).toBe(401);

    await createAdmin({ email: "boss@test.com" });
    const login = await request(app)
      .post("/admin/login")
      .send({ email: "boss@test.com", password: "Password1!" });
    const token = login.body.data.accessToken;

    const res = await request(app)
      .post("/admin/logout")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
