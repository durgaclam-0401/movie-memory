import "server-only";
import { prisma } from "@/lib/prisma";
import type { FactSource } from "@/lib/api-types";
import { FactUnavailableError, OnboardingRequiredError } from "@/lib/errors";

// Fact generation. Base version: every request generates and stores a new fact.

export type FactGenerator = { generate(movieTitle: string): Promise<string> };

export type StoredFact = { id: string; content: string; movieTitle: string; createdAt: Date };
export type FactResult = { fact: StoredFact; source: FactSource };

const factSelect = { id: true, content: true, movieTitle: true, createdAt: true } as const;

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
    data: { userId, movieTitle: movie, content, createdAt: new Date() },
    select: factSelect,
  });
  return { fact, source: "fresh" };
}
