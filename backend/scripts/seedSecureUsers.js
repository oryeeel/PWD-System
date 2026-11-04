const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
require("dotenv").config();

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  fullname: { type: String, required: true },
  role: { type: String, enum: ["Admin", "Staff"], required: true },
  status: { type: String, enum: ["Active", "Archived"], default: "Active" },
  passwordHash: { type: String, required: true }
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model("User", userSchema);

const accounts = [
  { username: "admin", fullname: "System Administrator", role: "Admin" },
  { username: "staff1", fullname: "MSWDO Staff 1", role: "Staff" },
  { username: "staff2", fullname: "MSWDO Staff 2", role: "Staff" }
];

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from backend/.env");
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    for (const account of accounts) {
      const existing = await User.findOne({ username: account.username });

      if (existing) {
        console.log(`Skipping ${account.username}: account already exists.`);
        continue;
      }

      const password = await rl.question(
        `Enter a new password for ${account.username}: `
      );

      if (password.length < 12 || password.length > 72) {
        throw new Error("Use a password between 12 and 72 characters.");
      }

      const passwordHash = await bcrypt.hash(password, 12);

      await User.create({
        ...account,
        status: "Active",
        passwordHash
      });

      console.log(`Created ${account.username} successfully.`);
    }

    console.log("Account setup completed.");
  } finally {
    rl.close();
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error("Setup failed:", error.message);
  process.exitCode = 1;
});
