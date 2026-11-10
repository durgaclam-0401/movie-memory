"use client";

import { useActionState } from "react";
import { saveFavoriteMovie } from "./actions";
import { MOVIE_TITLE_MAX } from "@/lib/validation";

// ONB-1 / ONB-3. maxLength/required are only hints; the server action validates.
export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(saveFavoriteMovie, null);

  return (
    <form action={formAction} className="mt-6 space-y-3" noValidate>
      <label htmlFor="movie" className="block font-medium">
        What&apos;s your favorite movie?
      </label>
      <input
        id="movie"
        name="movie"
        defaultValue={state?.value ?? ""}
        key={state?.value}
        maxLength={MOVIE_TITLE_MAX}
        aria-invalid={state ? true : undefined}
        aria-describedby={state ? "movie-error" : undefined}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-slate-900 focus:outline-none"
        placeholder="e.g. Spirited Away"
        autoFocus
      />
      {state && (
        <p id="movie-error" role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-slate-900 px-5 py-2.5 font-medium text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
