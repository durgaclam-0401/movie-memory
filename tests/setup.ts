import { afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

if (!process.env.DATABASE_URL?.includes("_test")) {
  throw new Error("Tests must run against the movie_memory_test database (.env.test)");
}

// Every test starts with empty tables.
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE "Fact", "FactGenerationLock", "Session", "Account", "VerificationToken", "User" CASCADE`,
  );
  // Generation failures are logged on purpose; keep test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(async () => {
  await prisma.$disconnect();
});
