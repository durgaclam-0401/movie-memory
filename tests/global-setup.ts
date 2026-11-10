import { execSync } from "node:child_process";

// Runs once per `npm test`: bring the test database's schema up to date.
// `migrate deploy` only applies pending migrations (never drops data), the
// same command CI and production use. Each test then starts from empty
// tables via the TRUNCATE in tests/setup.ts.
export default function setup() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("_test")) {
    throw new Error(`Refusing to run tests against a non-test database: ${url || "(unset)"}`);
  }
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
}
