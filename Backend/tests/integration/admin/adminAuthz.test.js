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
} from "../../helpers/factories.js";
import { authHeader } from "../../helpers/auth.js";

beforeAll(async () => {
  await connectTestDb();
});
afterEach(async () => {
  await clearTestDb();
});
afterAll(async () => {
  await disconnectTestDb();
});

// Cross-cutting: every /admin/* route must reject non-admins and bad tokens.
// Uses /admin/overview as the representative endpoint.
describe("Admin route authorization", () => {
  test("blocks requests with no token at all", async () => {
    const res = await request(app).get("/admin/overview");
    expect(res.status).toBe(401);
  });

  test("blocks requests with a garbage token", async () => {
    const res = await request(app)
      .get("/admin/overview")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  test("blocks a logged-in doctor from admin routes", async () => {
    const { user } = await createDoctorUser();
    const res = await request(app)
      .get("/admin/overview")
      .set(authHeader(user, "doctor"));
    // verifyJWT looks the account up in User (not Admin) for role "doctor",
    // succeeds, then isAdmin middleware rejects the non-admin role with 403.
    expect(res.status).toBe(403);
  });

  test("blocks a logged-in patient from admin routes", async () => {
    const { user } = await createPatientUser();
    const res = await request(app)
      .get("/admin/overview")
      .set(authHeader(user, "patient"));
    expect(res.status).toBe(403);
  });

  test("allows a real admin through", async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .get("/admin/overview")
      .set(authHeader(admin, "admin"));
    expect(res.status).toBe(200);
  });

  test("rejects a token claiming role=admin for an id that isn't a real Admin document (forged role claim)", async () => {
    const { user } = await createDoctorUser(); // a real User, not an Admin
    const res = await request(app)
      .get("/admin/overview")
      .set(authHeader(user, "admin"));
    // verifyJWT looks this _id up in the Admin collection (because role
    // claims admin) and finds nothing there, even though it's a valid
    // User elsewhere — must be rejected, not silently authorized.
    expect(res.status).toBe(401);
  });
});
