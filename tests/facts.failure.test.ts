import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getFactForUser } from "@/lib/facts";
import { openAIFactGenerator } from "@/lib/openai";
import { FactUnavailableError } from "@/lib/errors";
import { createUser, fakeGenerator, insertFact } from "./helpers";

describe("OpenAI failure handling", () => {
  it("I-9 FAIL-2/FAIL-5: failure with an older fact → older fact, nothing written", async () => {
    const user = await createUser();
    const old = await insertFact({ userId: user.id, movieTitle: "Inception", ageMs: 300_000 });

    const result = await getFactForUser(user.id, fakeGenerator({ fail: true }));

    expect(result).toMatchObject({ source: "stale-fallback", fact: { id: old.id } });
    expect(await prisma.fact.count()).toBe(1);
  });

  it("I-10 FAIL-3/FAIL-5: failure with no earlier fact → FactUnavailableError, nothing written", async () => {
    const user = await createUser();

    await expect(getFactForUser(user.id, fakeGenerator({ fail: true }))).rejects.toBeInstanceOf(
      FactUnavailableError,
    );
    expect(await prisma.fact.count()).toBe(0);
  });

  it("I-10b FAIL-3: older fact for a *different* movie is not used as fallback", async () => {
    const user = await createUser({ favoriteMovie: "Arrival" });
    await insertFact({ userId: user.id, movieTitle: "Inception", ageMs: 300_000 });

    await expect(getFactForUser(user.id, fakeGenerator({ fail: true }))).rejects.toBeInstanceOf(
      FactUnavailableError,
    );
  });

  it("I-10c FAIL-1: missing OPENAI_API_KEY fails like any other error (no network call)", async () => {
    const user = await createUser();
    delete process.env.OPENAI_API_KEY;

    await expect(getFactForUser(user.id, openAIFactGenerator)).rejects.toBeInstanceOf(
      FactUnavailableError,
    );
  });
});
