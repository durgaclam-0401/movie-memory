import { describe, expect, it } from "vitest";
import { MOVIE_TITLE_ERRORS, parseMovieTitle } from "@/lib/validation";

describe("movie title validation", () => {
  it("U-1 ONB-2: trims surrounding whitespace", () => {
    expect(parseMovieTitle("  Inception  ")).toEqual({ ok: true, value: "Inception" });
  });

  it("U-2 ONB-2/ONB-3: rejects empty, whitespace-only and missing input", () => {
    for (const input of ["", "    ", null, undefined]) {
      expect(parseMovieTitle(input)).toEqual({ ok: false, error: MOVIE_TITLE_ERRORS.empty });
    }
  });

  it("U-3 ONB-2/ONB-3: accepts 100 characters, rejects 101", () => {
    expect(parseMovieTitle("a".repeat(100))).toEqual({ ok: true, value: "a".repeat(100) });
    expect(parseMovieTitle("a".repeat(101))).toEqual({
      ok: false,
      error: MOVIE_TITLE_ERRORS.tooLong,
    });
  });

  it("U-3b ONB-2: length is checked after trimming", () => {
    expect(parseMovieTitle(`  ${"a".repeat(100)}  `)).toEqual({
      ok: true,
      value: "a".repeat(100),
    });
  });
});
