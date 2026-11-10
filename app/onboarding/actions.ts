"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseMovieTitle } from "@/lib/validation";

export type OnboardingState = { error: string; value: string } | null;

/**
 * ONB-2..5. Reads only the "movie" field; the user always comes from the
 * session, so a userId smuggled into the form is ignored (SEC-1).
 */
export async function saveFavoriteMovie(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await requireUser();
  if (user.favoriteMovie) redirect("/dashboard"); // ONB-5: first time only

  const raw = formData.get("movie");
  const parsed = parseMovieTitle(raw);
  if (!parsed.ok) return { error: parsed.error, value: typeof raw === "string" ? raw : "" };

  // `favoriteMovie: null` in the filter makes "first time only" hold even if
  // two submits race: the second update matches no row.
  await prisma.user.updateMany({
    where: { id: user.id, favoriteMovie: null },
    data: { favoriteMovie: parsed.value },
  });
  redirect("/dashboard");
}
