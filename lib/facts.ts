import "server-only";
import { prisma } from "@/lib/prisma";
import type { FactSource } from "@/lib/api-types";
import { FactUnavailableError, OnboardingRequiredError } from "@/lib/errors";

// Variant A core: 60 s cache window.
// Walkthrough with timelines: docs/REPORT.md §5.

export const CACHE_WINDOW_MS = 60_000;

export type FactGenerator = { generate(movieTitle: string): Promise<string> };

export type StoredFact = { id: string; content: string; movieTitle: string; createdAt: Date };
export type FactResult = { fact: StoredFact; source: FactSource };

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
): Promise<FactResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { favoriteMovie: true },
  });
  const movie = user?.favoriteMovie;
  if (!movie) throw new OnboardingRequiredError();

  const latest = await findLatestFact(userId, movie);
  if (latest && isFresh(latest)) return { fact: latest, source: "cache" };

  let content: string;
  try {
    content = await generator.generate(movie);
  } catch (err) {
    // FAIL-4: log server-side only; the client gets a fixed message.
    console.error("[facts] generation failed", {
      userId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    throw new FactUnavailableError();
  }

  const fact = await prisma.fact.create({
    // createdAt from the app clock, the same clock isFresh() uses (REPORT §5.1).
    data: { userId, movieTitle: movie, content, createdAt: new Date() },
    select: factSelect,
  });
  return { fact, source: "fresh" };
}
