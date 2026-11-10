import "server-only";
import { prisma } from "@/lib/prisma";
import { acquireLease, isLeaseActive, releaseLease } from "@/lib/lease";
import type { FactSource } from "@/lib/api-types";
import {
  FactUnavailableError,
  GenerationInProgressError,
  OnboardingRequiredError,
} from "@/lib/errors";

// Variant A core: 60 s cache window, one generation per user, failure fallback.
// Walkthrough with timelines: docs/REPORT.md §5.

export const CACHE_WINDOW_MS = 60_000;
export const LEASE_TTL_MS = 30_000; // must exceed OPENAI_TIMEOUT_MS
export const WAIT_POLL_MS = 500;
export const WAIT_MAX_MS = 12_000; // must exceed OPENAI_TIMEOUT_MS

export type FactGenerator = { generate(movieTitle: string): Promise<string> };

export type StoredFact = { id: string; content: string; movieTitle: string; createdAt: Date };
export type FactResult = { fact: StoredFact; source: FactSource };

/** Tests shorten the wait; production uses the defaults. */
export type FactOptions = { waitPollMs?: number; waitMaxMs?: number };

const factSelect = { id: true, content: true, movieTitle: true, createdAt: true } as const;

/** CACHE-2/3: fresh means strictly less than 60 s old (exactly 60 s is expired). */
export function isFresh(fact: StoredFact, now: number = Date.now()): boolean {
  return now - fact.createdAt.getTime() < CACHE_WINDOW_MS;
}

function findLatestFact(userId: string, movieTitle: string): Promise<StoredFact | null> {
  // CACHE-1: key is (userId, movieTitle); served by the composite index.
  return prisma.fact.findFirst({
    where: { userId, movieTitle },
    orderBy: { createdAt: "desc" },
    select: factSelect,
  });
}

/**
 * Returns a fact for the user's current favorite movie.
 * `userId` must come from the session (SEC-1); it scopes every query below.
 */
export async function getFactForUser(
  userId: string,
  generator: FactGenerator,
  options: FactOptions = {},
): Promise<FactResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { favoriteMovie: true },
  });
  const movie = user?.favoriteMovie;
  if (!movie) throw new OnboardingRequiredError();

  const latest = await findLatestFact(userId, movie);
  if (latest && isFresh(latest)) return { fact: latest, source: "cache" };

  const token = await acquireLease(userId, LEASE_TTL_MS);
  if (!token) return waitForOtherRequest(userId, movie, latest, options);

  try {
    // LOCK-5: another request may have finished between our first read and the lease.
    const current = await findLatestFact(userId, movie);
    if (current && isFresh(current)) return { fact: current, source: "cache" };

    let content: string;
    try {
      content = await generator.generate(movie);
    } catch (err) {
      // FAIL-4: log server-side only; the client gets a fixed message.
      console.error("[facts] generation failed", {
        userId,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      if (current) return { fact: current, source: "stale-fallback" }; // FAIL-2
      throw new FactUnavailableError(); // FAIL-3 (nothing written: FAIL-5)
    }

    const fact = await prisma.fact.create({
      // createdAt from the app clock, the same clock isFresh() uses (REPORT §5.1).
      data: { userId, movieTitle: movie, content, createdAt: new Date() },
      select: factSelect,
    });
    return { fact, source: "fresh" };
  } finally {
    // LOCK-4. If release itself fails, the lease still expires after LEASE_TTL_MS.
    await releaseLease(userId, token).catch((err) =>
      console.error("[facts] lease release failed", { userId, err }),
    );
  }
}

/**
 * LOCK-6: someone else holds the lease. Poll for their fact instead of
 * calling OpenAI again. Stop early if they released without producing one.
 */
async function waitForOtherRequest(
  userId: string,
  movie: string,
  latest: StoredFact | null,
  { waitPollMs = WAIT_POLL_MS, waitMaxMs = WAIT_MAX_MS }: FactOptions,
): Promise<FactResult> {
  const deadline = Date.now() + waitMaxMs;
  let holderGaveUp = false;

  while (Date.now() < deadline) {
    await sleep(waitPollMs);
    const fact = await findLatestFact(userId, movie);
    if (fact && isFresh(fact)) return { fact, source: "cache" };
    if (!(await isLeaseActive(userId))) {
      holderGaveUp = true; // released (generation failed) or expired (crashed)
      break;
    }
  }

  if (latest) return { fact: latest, source: "stale-fallback" };
  throw holderGaveUp ? new FactUnavailableError() : new GenerationInProgressError();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
