import bcrypt from "bcryptjs";
import postgres from "postgres";
import { nanoid } from "nanoid";

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DIRECT_URL or DATABASE_URL before seeding users.");

const requiredVariables = ["ADMIN_EMAIL", "ADMIN_PASSWORD", "SALES_EMAIL", "SALES_PASSWORD", "RECRUITER_EMAIL", "RECRUITER_PASSWORD"];
for (const variable of requiredVariables) {
  if (!process.env[variable]) throw new Error(`Missing ${variable} in .env.local`);
}

const seedUsers = [
  { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, name: "Raasta-AI Admin", role: "admin", modes: ["recruiter", "sales"] },
  { email: process.env.SALES_EMAIL, password: process.env.SALES_PASSWORD, name: "Sales Operator", role: "sales_operator", modes: ["sales"] },
  { email: process.env.RECRUITER_EMAIL, password: process.env.RECRUITER_PASSWORD, name: "Recruiter", role: "recruiter", modes: ["recruiter"] },
];

const sql = postgres(databaseUrl, { ssl: "require", max: 1 });
try {
  for (const user of seedUsers) {
    const passwordHash = await bcrypt.hash(user.password, 12);
    await sql`
      INSERT INTO users (id, email, name, password, role, modes, created_at, updated_at)
      VALUES (${nanoid()}, ${user.email.toLowerCase()}, ${user.name}, ${passwordHash}, ${user.role}, ${sql.json(user.modes)}, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name, password = EXCLUDED.password, role = EXCLUDED.role,
        modes = EXCLUDED.modes, updated_at = NOW()
    `;
    console.log(`Seeded ${user.email} (${user.role})`);
  }
} finally {
  await sql.end();
}
