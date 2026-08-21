import request from "supertest";
import { app } from "../../../src/app.js";
import {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
} from "../../setup/testDb.js";
import { createAdmin } from "../../helpers/factories.js";
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
  admin = await createAdmin({ email: "boss@test.com" });
});

describe("GET /admin/profile", () => {
  test("returns profile with no avatar-related field", async () => {
    const res = await request(app)
      .get("/admin/profile")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("boss@test.com");
    expect(res.body.data).not.toHaveProperty("avatar");
  });
});

describe("PATCH /admin/profile", () => {
  test("updates fullname and phone", async () => {
    const res = await request(app)
      .patch("/admin/profile")
      .set(authHeader(admin, "admin"))
      .send({ fullname: "New Name", phone: "03001234567" });
    expect(res.status).toBe(200);
    expect(res.body.data.fullname).toBe("New Name");
    expect(res.body.data.phone).toBe("03001234567");
  });

  test("rejects a phone number in the wrong format", async () => {
    const res = await request(app)
      .patch("/admin/profile")
      .set(authHeader(admin, "admin"))
      .send({ phone: "12345" });
    expect(res.status).toBe(400);
  });

  test("rejects a fullname shorter than 3 characters", async () => {
    const res = await request(app)
      .patch("/admin/profile")
      .set(authHeader(admin, "admin"))
      .send({ fullname: "Al" });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /admin/profile/password", () => {
  test("changes password when current password is correct", async () => {
    const res = await request(app)
      .patch("/admin/profile/password")
      .set(authHeader(admin, "admin"))
      .send({ currentPassword: "Password1!", newPassword: "NewPass123!" });
    expect(res.status).toBe(200);

    const relogin = await request(app)
      .post("/admin/login")
      .send({ email: "boss@test.com", password: "NewPass123!" });
    expect(relogin.status).toBe(200);
  });

  test("rejects when the current password is wrong", async () => {
    const res = await request(app)
      .patch("/admin/profile/password")
      .set(authHeader(admin, "admin"))
      .send({ currentPassword: "WrongOldPass1!", newPassword: "NewPass123!" });
    expect(res.status).toBe(401);
  });

  test("rejects a weak new password", async () => {
    const res = await request(app)
      .patch("/admin/profile/password")
      .set(authHeader(admin, "admin"))
      .send({ currentPassword: "Password1!", newPassword: "weak" });
    expect(res.status).toBe(400);
  });
});
