import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getFactForUser } from "@/lib/facts";
import { openAIFactGenerator } from "@/lib/openai";
import { FactUnavailableError, OnboardingRequiredError } from "@/lib/errors";
import { createUser, fakeGenerator } from "./helpers";

describe("fact generation", () => {
  it("I-1 FACT-2: generates once and stores the fact for the user and movie", async () => {
    const user = await createUser();
    const gen = fakeGenerator();

    const result = await getFactForUser(user.id, gen);

    expect(result.source).toBe("fresh");
    expect(gen.calls).toBe(1);
    const rows = await prisma.fact.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ movieTitle: "Inception", content: result.fact.content });
  });

  it("I-4c: user without a favorite movie → OnboardingRequiredError", async () => {
    const user = await createUser({ favoriteMovie: null });
    await expect(getFactForUser(user.id, fakeGenerator())).rejects.toBeInstanceOf(
      OnboardingRequiredError,
    );
  });

  it("I-10 FAIL-3/FAIL-5: generator throws → FactUnavailableError, nothing written", async () => {
    const user = await createUser();

    await expect(getFactForUser(user.id, fakeGenerator({ fail: true }))).rejects.toBeInstanceOf(
      FactUnavailableError,
    );
    expect(await prisma.fact.count()).toBe(0);
  });

  it("I-10c FAIL-1: missing OPENAI_API_KEY fails like any other error (no network call)", async () => {
    const user = await createUser();
    delete process.env.OPENAI_API_KEY;

    await expect(getFactForUser(user.id, openAIFactGenerator)).rejects.toBeInstanceOf(
      FactUnavailableError,
    );
  });
});
