import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getFactForUser } from "@/lib/facts";
import { openAIFactGenerator } from "@/lib/openai";
import { FactUnavailableError } from "@/lib/errors";
import { createUser, fakeGenerator } from "./helpers";

describe("OpenAI failure handling", () => {
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
