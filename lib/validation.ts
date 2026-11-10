import { z } from "zod";

export const MOVIE_TITLE_MAX = 100; // also enforced by @db.VarChar(100) in the schema

export const MOVIE_TITLE_ERRORS = {
  empty: "Please enter a movie title.",
  tooLong: `Movie titles must be ${MOVIE_TITLE_MAX} characters or fewer.`,
} as const;

/** ONB-2: trim, then 1–100 characters. A missing field counts as empty. */
export const movieTitleSchema = z
  .string({ error: MOVIE_TITLE_ERRORS.empty })
  .trim()
  .min(1, MOVIE_TITLE_ERRORS.empty)
  .max(MOVIE_TITLE_MAX, MOVIE_TITLE_ERRORS.tooLong);

export type ParseResult = { ok: true; value: string } | { ok: false; error: string };

export function parseMovieTitle(input: unknown): ParseResult {
  const result = movieTitleSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues[0]?.message ?? MOVIE_TITLE_ERRORS.empty };
}
