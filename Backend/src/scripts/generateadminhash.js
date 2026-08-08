import bcrypt from "bcrypt";

const plain = process.argv[2];

if (!plain) {
  console.error('Usage: node generateAdminHash.js "YourAdminPassword"');
  process.exit(1);
}

const hash = await bcrypt.hash(plain, 10);
console.log("\nAdd this to your .env:\n");
console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);