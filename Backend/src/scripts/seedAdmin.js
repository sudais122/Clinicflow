import mongoose from "mongoose";
import dotenv from "dotenv";
import { Admin } from "../models/admin.models.js";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const existing = await Admin.findOne({ email: process.env.ADMIN_EMAIL?.toLowerCase() });
  if (existing) {
    console.log("Admin already exists:", existing.email);
    process.exit(0);
  }

  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first.");
    process.exit(1);
  }

  const admin = await Admin.create({
    fullname: process.env.ADMIN_FULLNAME || "Admin",
    email: process.env.ADMIN_EMAIL.toLowerCase(),
    password: process.env.ADMIN_PASSWORD,
  });

  console.log("Admin created:", admin.email);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});