import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getFactForUser, isFresh } from "@/lib/facts";
import { OnboardingRequiredError } from "@/lib/errors";
import { createUser, fakeGenerator, insertFact } from "./helpers";

describe("60-second cache window", () => {
  it("I-1 CACHE-3/FACT-2: no fact yet → generates once and stores it", async () => {
    const user = await createUser();
    const gen = fakeGenerator();

    const result = await getFactForUser(user.id, gen);

    expect(result.source).toBe("fresh");
    expect(gen.calls).toBe(1);
    const rows = await prisma.fact.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ movieTitle: "Inception", content: result.fact.content });
  });

  it("I-2 CACHE-2: fact 59 s old → returned from cache, no OpenAI call", async () => {
    const user = await createUser();
    const old = await insertFact({ userId: user.id, movieTitle: "Inception", ageMs: 59_000 });
    const gen = fakeGenerator();

    const result = await getFactForUser(user.id, gen);

    expect(result).toMatchObject({ source: "cache", fact: { id: old.id } });
    expect(gen.calls).toBe(0);
  });

  it("I-3 CACHE-3: fact exactly 60 s old → regenerated", async () => {
    const user = await createUser();
    const old = await insertFact({ userId: user.id, movieTitle: "Inception", ageMs: 60_000 });
    const gen = fakeGenerator();

    const result = await getFactForUser(user.id, gen);

    expect(result.source).toBe("fresh");
    expect(result.fact.id).not.toBe(old.id);
    expect(gen.calls).toBe(1);
    // The new fact is now the latest, so the next call is a cache hit.
    const again = await getFactForUser(user.id, gen);
    expect(again).toMatchObject({ source: "cache", fact: { id: result.fact.id } });
    expect(gen.calls).toBe(1);
  });

  it("I-3b CACHE-2/3: exact boundary — 59 999 ms is fresh, 60 000 ms is not", () => {
    // DB tests can't hit an exact millisecond, so the boundary is pinned here.
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const fact = { id: "f", content: "", movieTitle: "Inception", createdAt };
    const t = createdAt.getTime();

    expect(isFresh(fact, t)).toBe(true);
    expect(isFresh(fact, t + 59_999)).toBe(true);
    expect(isFresh(fact, t + 60_000)).toBe(false);
    expect(isFresh(fact, t + 60_001)).toBe(false);
  });

  it("I-4 CACHE-1: a fresh fact for a different movie doesn't count", async () => {
    const user = await createUser({ favoriteMovie: "Arrival" });
    await insertFact({ userId: user.id, movieTitle: "Inception", ageMs: 1_000 });
    const gen = fakeGenerator();

    const result = await getFactForUser(user.id, gen);

    expect(result.source).toBe("fresh");
    expect(result.fact.movieTitle).toBe("Arrival");
  });

  it("I-4b CACHE-1: another user's fresh fact for the same movie doesn't count", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await insertFact({ userId: bob.id, movieTitle: "Inception", ageMs: 1_000 });
    const gen = fakeGenerator();

    const result = await getFactForUser(alice.id, gen);

    expect(result.source).toBe("fresh");
    expect(gen.calls).toBe(1);
  });

  it("I-4c: user without a favorite movie → OnboardingRequiredError", async () => {
    const user = await createUser({ favoriteMovie: null });
    await expect(getFactForUser(user.id, fakeGenerator())).rejects.toBeInstanceOf(
      OnboardingRequiredError,
    );
  });
});
