import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getFactForUser } from "@/lib/facts";
import { acquireLease, releaseLease } from "@/lib/lease";
import { FactUnavailableError, GenerationInProgressError } from "@/lib/errors";
import { createUser, fakeGenerator, fastWait, insertFact } from "./helpers";

describe("burst protection (lease)", () => {
  it("I-5 LOCK-1/5/6: 5 parallel requests → 1 OpenAI call, everyone gets the same fact", async () => {
    const user = await createUser();
    const gen = fakeGenerator({ delayMs: 300 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => getFactForUser(user.id, gen, fastWait)),
    );

    expect(gen.calls).toBe(1);
    expect(new Set(results.map((r) => r.fact.id)).size).toBe(1);
    expect(results.filter((r) => r.source === "fresh")).toHaveLength(1);
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(1);
  });

  it("I-5b LOCK-1: different users don't block each other", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const gen = fakeGenerator({ delayMs: 200 });

    const [a, b] = await Promise.all([
      getFactForUser(alice.id, gen, fastWait),
      getFactForUser(bob.id, gen, fastWait),
    ]);

    expect(a.source).toBe("fresh");
    expect(b.source).toBe("fresh");
    expect(gen.calls).toBe(2);
  });

  it("I-6 LOCK-2/LOCK-3: an expired lease (crashed request) is taken over", async () => {
    const user = await createUser();
    await prisma.factGenerationLock.create({
      data: { userId: user.id, token: "crashed", expiresAt: new Date(Date.now() - 1_000) },
    });
    const gen = fakeGenerator();

    const result = await getFactForUser(user.id, gen, fastWait);

    expect(result.source).toBe("fresh");
    expect(gen.calls).toBe(1);
  });

  it("I-6b LOCK-2: an unexpired lease can't be acquired twice", async () => {
    const user = await createUser();
    const first = await acquireLease(user.id, 30_000);
    const second = await acquireLease(user.id, 30_000);

    expect(first).toEqual(expect.any(String));
    expect(second).toBeNull();
  });

  it("I-7 LOCK-4: releasing with the wrong token leaves the lease in place", async () => {
    const user = await createUser();
    const token = await acquireLease(user.id, 30_000);

    await releaseLease(user.id, "someone-else");
    expect(await prisma.factGenerationLock.count()).toBe(1);

    await releaseLease(user.id, token!);
    expect(await prisma.factGenerationLock.count()).toBe(0);
  });

  it("I-8 LOCK-4: lease is released after success and after failure", async () => {
    const user = await createUser();
    await getFactForUser(user.id, fakeGenerator());
    expect(await prisma.factGenerationLock.count()).toBe(0);

    const other = await createUser();
    await expect(getFactForUser(other.id, fakeGenerator({ fail: true }))).rejects.toThrow();
    expect(await prisma.factGenerationLock.count()).toBe(0);
  });

  it("I-8b LOCK-6: waiter times out with no fact → GenerationInProgressError", async () => {
    const user = await createUser();
    await acquireLease(user.id, 30_000); // held by a "slow" request that never finishes
    const gen = fakeGenerator();

    await expect(
      getFactForUser(user.id, gen, { waitPollMs: 20, waitMaxMs: 200 }),
    ).rejects.toBeInstanceOf(GenerationInProgressError);
    expect(gen.calls).toBe(0);
  });

  it("I-8c LOCK-6: waiter times out but an older fact exists → stale-fallback", async () => {
    const user = await createUser();
    const old = await insertFact({ userId: user.id, movieTitle: "Inception", ageMs: 120_000 });
    await acquireLease(user.id, 30_000);

    const result = await getFactForUser(user.id, fakeGenerator(), {
      waitPollMs: 20,
      waitMaxMs: 200,
    });

    expect(result).toMatchObject({ source: "stale-fallback", fact: { id: old.id } });
  });

  it("I-8d LOCK-6: holder gives up without a fact → waiter stops early with FactUnavailable", async () => {
    const user = await createUser();
    const token = await acquireLease(user.id, 30_000);
    setTimeout(() => void releaseLease(user.id, token!), 100);

    const started = Date.now();
    await expect(
      getFactForUser(user.id, fakeGenerator(), { waitPollMs: 20, waitMaxMs: 5_000 }),
    ).rejects.toBeInstanceOf(FactUnavailableError);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
