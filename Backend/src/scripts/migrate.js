import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected. Running migration...");

  const db = mongoose.connection.db;

  const reports = db.collection("reports");
  const r1 = await reports.updateMany(
    { status: "open" },
    { $set: { status: "pending" } },
  );
  const r2 = await reports.updateMany(
    { status: "reviewed" },
    { $set: { status: "inreview" } },
  );
  console.log(
    `Reports: open->pending (${r1.modifiedCount}), reviewed->inreview (${r2.modifiedCount})`,
  );

  const doctors = db.collection("doctors");
  const d1 = await doctors.updateMany(
    { status: { $exists: false } },
    { $set: { status: "active", isSuspended: false } },
  );
  console.log(
    `Doctors: backfilled status=active for ${d1.modifiedCount} existing doctors`,
  );

  console.log("Migration complete.");
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
