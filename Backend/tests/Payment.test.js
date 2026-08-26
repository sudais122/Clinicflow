/* ============================================================
   Payment API tests — Jest + Supertest.

   WHAT'S REAL vs MOCKED:
   - The real Express `app` (imported from ../src/app.js) and the
     real routes/controller run for every request — this is an
     integration test of the actual HTTP layer, not just the
     controller functions in isolation.
   - Payment / Doctor models, and uploadBufferToCloudinary, are
     mocked (jest.mock below) so no real database or Cloudinary
     account is needed to run these.
   - auth.middlewares.js / admin.middlewares.js are ALSO mocked —
     verifyJWT always attaches req.user, and you control its shape
     per-request with two custom headers:
       x-test-role: "doctor" | "admin"   (default "doctor")
       x-test-user-id: any string        (default "doctor123")
     This means these tests do NOT verify your real auth rejection
     behavior (expired/invalid JWTs, etc.) — that belongs in a
     separate test file written directly against
     auth.middlewares.js's real implementation.

   SETUP (run once):
     npm install --save-dev jest supertest @babel/core @babel/preset-env babel-jest
     Add babel.config.cjs and jest.config.cjs (provided alongside
     this file) to your Backend/ root.
     Add to package.json:  "scripts": { "test": "jest" }

   RUN:
     npm test
   ============================================================ */

import request from "supertest";
import { app } from "../src/app.js";
import { Payment } from "../src/models/payment.model.js";
import { Doctor } from "../src/models/doctor.model.js";
import { uploadBufferToCloudinary } from "../src/utils/cloudinary.js";

jest.mock("../src/models/payment.model.js", () => ({
  Payment: {
    findOne: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  },
  PAID_PLANS: ["Practice"],
  PAYMENT_METHODS: ["easypaisa", "bank_transfer"],
  PAYMENT_STATUSES: ["pending", "approved", "rejected"],
}));

jest.mock("../src/models/doctor.model.js", () => ({
  Doctor: { findByIdAndUpdate: jest.fn() },
}));

jest.mock("../src/utils/cloudinary.js", () => ({
  uploadBufferToCloudinary: jest.fn(),
}));

jest.mock("../src/middlewares/auth.middlewares.js", () => ({
  verifyJWT: (req, res, next) => {
    req.user = {
      _id: req.headers["x-test-user-id"] || "doctor123",
      role: req.headers["x-test-role"] || "doctor",
    };
    next();
  },
}));

jest.mock("../src/middlewares/admin.middlewares.js", () => ({
  isAdmin: (req, res, next) => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required" });
    }
    next();
  },
}));

beforeEach(() => {
  jest.resetAllMocks();
});

/* ---------------- POST /payments ---------------- */

describe("POST /payments", () => {
  test("201 — happy path creates a pending payment", async () => {
    Payment.findOne.mockResolvedValue(null); // no existing pending payment
    uploadBufferToCloudinary.mockResolvedValue({
      secure_url: "https://res.cloudinary.com/demo/fake.jpg",
      public_id: "clinicflow/payment-proofs/doctor123/fake",
    });
    Payment.create.mockResolvedValue({
      _id: "payment1",
      doctor: "doctor123",
      plan: "Practice",
      amount: 4500,
      status: "pending",
    });

    const res = await request(app)
      .post("/payments")
      .field("plan", "Practice")
      .field("paymentMethod", "easypaisa")
      .field("transactionReference", "TXN123")
      .attach("screenshot", Buffer.from("fake image bytes"), "screenshot.jpg");

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
    expect(uploadBufferToCloudinary).toHaveBeenCalledWith(
      expect.any(Buffer),
      "clinicflow/payment-proofs/doctor123",
    );
    expect(Payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "Practice", amount: 4500, status: "pending" }),
    );
  });

  test("400 — missing screenshot file", async () => {
    const res = await request(app)
      .post("/payments")
      .field("plan", "Practice")
      .field("paymentMethod", "easypaisa");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/screenshot is required/i);
  });

  test("400 — invalid plan", async () => {
    const res = await request(app)
      .post("/payments")
      .field("plan", "Gold")
      .field("paymentMethod", "easypaisa")
      .attach("screenshot", Buffer.from("fake"), "screenshot.jpg");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Plan must be one of/i);
  });

  test("400 — invalid payment method", async () => {
    const res = await request(app)
      .post("/payments")
      .field("plan", "Practice")
      .field("paymentMethod", "cash")
      .attach("screenshot", Buffer.from("fake"), "screenshot.jpg");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Payment method must be one of/i);
  });

  test("400 — wrong file type rejected by Multer's fileFilter", async () => {
    const res = await request(app)
      .post("/payments")
      .field("plan", "Practice")
      .field("paymentMethod", "easypaisa")
      .attach("screenshot", Buffer.from("not an image"), "notes.txt");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/JPG, PNG, or WEBP/i);
  });

  test("409 — duplicate pending submission is blocked", async () => {
    Payment.findOne.mockResolvedValue({ _id: "existingPending", status: "pending" });

    const res = await request(app)
      .post("/payments")
      .field("plan", "Practice")
      .field("paymentMethod", "easypaisa")
      .attach("screenshot", Buffer.from("fake"), "screenshot.jpg");

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already have a payment/i);
  });
});

/* ---------------- GET /payments/me ---------------- */

describe("GET /payments/me", () => {
  test("200 — returns this doctor's own payments", async () => {
    const fakePayments = [{ _id: "p2" }, { _id: "p1" }];
    Payment.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(fakePayments) });

    const res = await request(app).get("/payments/me").set("x-test-user-id", "doctor123");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(fakePayments);
    expect(Payment.find).toHaveBeenCalledWith({ doctor: "doctor123" });
  });
});

/* ---------------- GET /admin/payments ---------------- */

describe("GET /admin/payments", () => {
  test("403 — non-admin is blocked", async () => {
    const res = await request(app).get("/admin/payments").set("x-test-role", "doctor");
    expect(res.status).toBe(403);
  });

  test("200 — admin can list all payments", async () => {
    const fakePayments = [{ _id: "p1", status: "pending" }];
    Payment.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        sort: jest.fn().mockResolvedValue(fakePayments),
      }),
    });

    const res = await request(app).get("/admin/payments").set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(fakePayments);
  });

  test("?status=pending filters the query correctly", async () => {
    const sortMock = jest.fn().mockResolvedValue([]);
    Payment.find.mockReturnValue({ populate: jest.fn().mockReturnValue({ sort: sortMock }) });

    await request(app).get("/admin/payments?status=pending").set("x-test-role", "admin");

    expect(Payment.find).toHaveBeenCalledWith({ status: "pending" });
  });
});

/* ---------------- GET /admin/payments/pending ---------------- */

describe("GET /admin/payments/pending", () => {
  test("200 — shortcut applies status=pending automatically", async () => {
    const sortMock = jest.fn().mockResolvedValue([]);
    Payment.find.mockReturnValue({ populate: jest.fn().mockReturnValue({ sort: sortMock }) });

    const res = await request(app).get("/admin/payments/pending").set("x-test-role", "admin");

    expect(res.status).toBe(200);
    expect(Payment.find).toHaveBeenCalledWith({ status: "pending" });
  });
});

/* ---------------- PATCH /admin/payments/:id/approve ---------------- */

describe("PATCH /admin/payments/:id/approve", () => {
  test("403 — non-admin is blocked", async () => {
    const res = await request(app)
      .patch("/admin/payments/payment1/approve")
      .set("x-test-role", "doctor");
    expect(res.status).toBe(403);
  });

  test("404 — payment not found", async () => {
    Payment.findById.mockResolvedValue(null);

    const res = await request(app)
      .patch("/admin/payments/doesNotExist/approve")
      .set("x-test-role", "admin");

    expect(res.status).toBe(404);
  });

  test("409 — already-reviewed payment can't be approved again", async () => {
    Payment.findById.mockResolvedValue({ _id: "p1", status: "approved", save: jest.fn() });

    const res = await request(app)
      .patch("/admin/payments/p1/approve")
      .set("x-test-role", "admin");

    expect(res.status).toBe(409);
  });

  test("200 — approves payment and activates the doctor's subscription", async () => {
    const mockPayment = {
      _id: "p1",
      doctor: "doctor123",
      plan: "Practice",
      status: "pending",
      save: jest.fn().mockResolvedValue(true),
    };
    Payment.findById.mockResolvedValue(mockPayment);
    Doctor.findByIdAndUpdate.mockResolvedValue({
      _id: "doctor123",
      subscription: { plan: "Practice", status: "Active" },
    });

    const res = await request(app)
      .patch("/admin/payments/p1/approve")
      .set("x-test-role", "admin")
      .set("x-test-user-id", "admin1");

    expect(res.status).toBe(200);
    expect(mockPayment.status).toBe("approved");
    expect(mockPayment.reviewedBy).toBe("admin1");
    expect(mockPayment.save).toHaveBeenCalled();
    expect(Doctor.findByIdAndUpdate).toHaveBeenCalledWith(
      "doctor123",
      expect.objectContaining({
        subscription: expect.objectContaining({ plan: "Practice", status: "Active" }),
      }),
      { new: true },
    );
  });
});

/* ---------------- PATCH /admin/payments/:id/reject ---------------- */

describe("PATCH /admin/payments/:id/reject", () => {
  test("403 — non-admin is blocked", async () => {
    const res = await request(app)
      .patch("/admin/payments/p1/reject")
      .set("x-test-role", "doctor");
    expect(res.status).toBe(403);
  });

  test("409 — already-reviewed payment can't be rejected again", async () => {
    Payment.findById.mockResolvedValue({ _id: "p1", status: "rejected", save: jest.fn() });

    const res = await request(app)
      .patch("/admin/payments/p1/reject")
      .set("x-test-role", "admin")
      .send({ reason: "duplicate" });

    expect(res.status).toBe(409);
  });

  test("200 — rejects a pending payment with a reason", async () => {
    const mockPayment = { _id: "p1", status: "pending", save: jest.fn().mockResolvedValue(true) };
    Payment.findById.mockResolvedValue(mockPayment);

    const res = await request(app)
      .patch("/admin/payments/p1/reject")
      .set("x-test-role", "admin")
      .send({ reason: "Screenshot doesn't match the amount" });

    expect(res.status).toBe(200);
    expect(mockPayment.status).toBe("rejected");
    expect(mockPayment.rejectionReason).toBe("Screenshot doesn't match the amount");
  });
});