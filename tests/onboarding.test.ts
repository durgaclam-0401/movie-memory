import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { saveFavoriteMovie } from "@/app/onboarding/actions";
import { MOVIE_TITLE_ERRORS } from "@/lib/validation";
import { createUser } from "./helpers";

// Only the session lookup is faked; requireUser keeps its real behavior.
vi.mock("@/lib/auth", async () => {
  const { redirect } = await import("next/navigation");
  const getSessionUser = vi.fn();
  return {
    getSessionUser,
    requireUser: async () => (await getSessionUser()) ?? redirect("/"),
  };
});
const mockSession = vi.mocked(getSessionUser);

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const redirectTo = (path: string) =>
  expect.objectContaining({ digest: expect.stringContaining(`;${path};`) });

describe("saveFavoriteMovie", () => {
  beforeEach(() => mockSession.mockReset());

  it("I-11 ONB-4/SEC-1: saves the trimmed title for the session user only; form userId ignored", async () => {
    const me = await createUser({ favoriteMovie: null });
    const victim = await createUser({ favoriteMovie: null });
    mockSession.mockResolvedValue(me);

    await expect(
      saveFavoriteMovie(null, form({ movie: "  Arrival ", userId: victim.id })),
    ).rejects.toEqual(redirectTo("/dashboard"));

    const rows = await prisma.user.findMany({ select: { id: true, favoriteMovie: true } });
    expect(rows).toContainEqual({ id: me.id, favoriteMovie: "Arrival" });
    expect(rows).toContainEqual({ id: victim.id, favoriteMovie: null });
  });

  it("I-12 ONB-3: invalid input → error + typed value, nothing saved", async () => {
    const me = await createUser({ favoriteMovie: null });
    mockSession.mockResolvedValue(me);
    const tooLong = "x".repeat(101);

    const state = await saveFavoriteMovie(null, form({ movie: tooLong }));

    expect(state).toEqual({ error: MOVIE_TITLE_ERRORS.tooLong, value: tooLong });
    const saved = await prisma.user.findUnique({ where: { id: me.id } });
    expect(saved?.favoriteMovie).toBeNull();
  });

  it("I-13 ONB-5: already onboarded → existing movie not overwritten", async () => {
    const me = await createUser({ favoriteMovie: "Inception" });
    mockSession.mockResolvedValue(me);

    await expect(saveFavoriteMovie(null, form({ movie: "Arrival" }))).rejects.toEqual(
      redirectTo("/dashboard"),
    );

    const saved = await prisma.user.findUnique({ where: { id: me.id } });
    expect(saved?.favoriteMovie).toBe("Inception");
  });

  it("I-13b AUTH-6: no session → redirect to / and nothing saved", async () => {
    mockSession.mockResolvedValue(null);

    await expect(saveFavoriteMovie(null, form({ movie: "Arrival" }))).rejects.toEqual(
      redirectTo("/"),
    );
  });
});
