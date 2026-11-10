import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

// "Generation in progress" lease, one row per user (REPORT §5.2).
// Expiry is written and compared with Postgres's now() only, so the app
// server's clock never matters here.

/**
 * LOCK-2: atomically take the lease if it is free or expired.
 * Returns the owner token if acquired, null if someone else holds it.
 */
export async function acquireLease(userId: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const rows = await prisma.$queryRaw<{ token: string }[]>`
    INSERT INTO "FactGenerationLock" ("userId", "token", "expiresAt")
    VALUES (${userId}, ${token}, now() + ${ttlMs}::double precision * interval '1 millisecond')
    ON CONFLICT ("userId") DO UPDATE
      SET "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt"
      WHERE "FactGenerationLock"."expiresAt" < now()
    RETURNING "token"`;
  return rows[0]?.token ?? null;
}

/** LOCK-4: delete only our own lease, so a late request can't free someone else's. */
export async function releaseLease(userId: string, token: string): Promise<void> {
  await prisma.factGenerationLock.deleteMany({ where: { userId, token } });
}

/** True while some request holds an unexpired lease for this user. */
export async function isLeaseActive(userId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<unknown[]>`
    SELECT 1 FROM "FactGenerationLock" WHERE "userId" = ${userId} AND "expiresAt" > now()`;
  return rows.length > 0;
}
