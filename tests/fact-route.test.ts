import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { openAIFactGenerator } from "@/lib/openai";
import { GET } from "@/app/api/fact/route";
import type { FactResponse } from "@/lib/api-types";
import { createUser, insertFact } from "./helpers";

// Fake only the session lookup and OpenAI; the route, fact service, lease
// and database all run for real.
vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn(), requireUser: vi.fn() }));
vi.mock("@/lib/openai", () => ({ openAIFactGenerator: { generate: vi.fn() } }));
const mockSession = vi.mocked(getSessionUser);
const mockGenerate = vi.mocked(openAIFactGenerator.generate);

const request = (query = "") => new Request(`http://localhost/api/fact${query}`);

describe("GET /api/fact", () => {
  beforeEach(() => {
    mockSession.mockReset();
    mockGenerate.mockReset();
    mockGenerate.mockResolvedValue("A brand new fact.");
  });

  it("R-1 SEC-3: no session → 401 UNAUTHENTICATED, OpenAI not called", async () => {
    mockSession.mockResolvedValue(null);

    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Please sign in." },
    });
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("R-2 FACT-4: valid session → 200 with the documented shape and no-store", async () => {
    const me = await createUser();
    mockSession.mockResolvedValue(me);

    const res = await GET(request());
    const body = (await res.json()) as FactResponse;

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      fact: {
        content: "A brand new fact.",
        movieTitle: "Inception",
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      },
      source: "fresh",
    });
  });

  it("R-3 SEC-1/SEC-2: user A asking for ?userId=B still only gets A's fact", async () => {
    // Same movie, and Bob's fact is newer: an unscoped query would return Bob's.
    const alice = await createUser({ favoriteMovie: "Inception" });
    const bob = await createUser({ favoriteMovie: "Inception" });
    await insertFact({ userId: alice.id, movieTitle: "Inception", ageMs: 50_000, content: "Alice's fact" });
    await insertFact({ userId: bob.id, movieTitle: "Inception", ageMs: 1_000, content: "Bob's secret fact" });
    mockSession.mockResolvedValue(alice);

    const res = await GET(request(`?userId=${bob.id}`));
    const body = (await res.json()) as FactResponse;

    expect(res.status).toBe(200);
    expect(body.fact).toMatchObject({ content: "Alice's fact", movieTitle: "Inception" });
    expect(JSON.stringify(body)).not.toContain("Bob");
  });

  it("R-4: user without a favorite movie → 409 ONBOARDING_REQUIRED", async () => {
    mockSession.mockResolvedValue(await createUser({ favoriteMovie: null }));

    const res = await GET(request());

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("ONBOARDING_REQUIRED");
  });

  it("R-5 FAIL-3/FAIL-4/SEC-5: OpenAI fails, no earlier fact → 503 with a friendly message only", async () => {
    mockSession.mockResolvedValue(await createUser());
    mockGenerate.mockRejectedValue(new Error("401 Incorrect API key provided: sk-abc123"));

    const res = await GET(request());
    const text = await res.text();

    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "FACT_UNAVAILABLE",
        message: "We couldn't come up with a fact right now. Please try again in a moment.",
      },
    });
    expect(text).not.toContain("sk-abc123");
  });

  it("R-6 SEC-5: unexpected error (e.g. DB down) → 500 INTERNAL, no internals leaked", async () => {
    mockSession.mockResolvedValue(await createUser());
    const spy = vi
      .spyOn(prisma.user, "findUnique")
      .mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));

    const res = await GET(request());
    const text = await res.text();
    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({
      error: { code: "INTERNAL", message: "Something went wrong." },
    });
    expect(text).not.toContain("10.0.0.5");
  });
});
