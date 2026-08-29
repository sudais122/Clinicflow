/* ============================================================
   Drops ALL collections in the target database — every doctor,
   patient, appointment, payment, subscription, notification, etc.
   Irreversible. There is no undo, no soft-delete, no backup taken
   by this script.

   SAFETY: requires typing the database name to confirm, so it can
   never run silently by accident (e.g. from a bad copy-paste or a
   forgotten cron job). Reads the connection string the exact same
   way your app does (MONGODB_URI via dotenv), so it always points
   at whatever database your server is actually using — no separate
   hardcoded URI to accidentally point at the wrong place.

   Run: node scripts/wipeDatabase.js
   ============================================================ */

import "../loadEnv.js";
import mongoose from "mongoose";
import readline from "readline";

const MONGO_URI = process.env.MONGODB_URI; // ADJUST if your real env var name differs

if (!MONGO_URI) {
  console.error("MONGODB_URI is not set — check your .env file.");
  process.exit(1);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

async function run() {
  await mongoose.connect(MONGO_URI);
  const dbName = mongoose.connection.db.databaseName;

  const collections = await mongoose.connection.db.listCollections().toArray();
  const names = collections.map((c) => c.name);

  console.log(`Connected to database: "${dbName}"`);
  console.log(`This will PERMANENTLY delete ${names.length} collection(s):`);
  names.forEach((n) => console.log(`  - ${n}`));
  console.log("\nThis cannot be undone. There is no backup.");

  const answer = await ask(`\nType the database name ("${dbName}") to confirm, or anything else to cancel: `);

  if (answer.trim() !== dbName) {
    console.log("Confirmation did not match — aborted. Nothing was deleted.");
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log("\nConfirmed. Dropping collections...");
  for (const name of names) {
    await mongoose.connection.db.collection(name).drop();
    console.log(`  dropped: ${name}`);
  }

  console.log(`\nDone. "${dbName}" is now empty.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});