"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiError, FactResponse } from "@/lib/api-types";

type State =
  | { status: "loading" }
  | { status: "ready"; data: FactResponse }
  | { status: "error"; message: string };

const FALLBACK_ERROR = "We couldn't load a fact right now. Please try again.";

async function fetchFact(): Promise<State> {
  try {
    const res = await fetch("/api/fact", { cache: "no-store" });
    if (res.ok) return { status: "ready", data: (await res.json()) as FactResponse };
    const body = (await res.json().catch(() => null)) as ApiError | null;
    return { status: "error", message: body?.error.message ?? FALLBACK_ERROR };
  } catch {
    return { status: "error", message: FALLBACK_ERROR };
  }
}

// DASH-5: loads after the page renders so the profile never waits on OpenAI.
export function FactCard() {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    setState(await fetchFact());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchFact().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mt-5 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200" aria-live="polite">
      <p className="text-sm font-semibold text-amber-900">Fun fact</p>

      {state.status === "loading" && (
        <div className="mt-2 space-y-2" aria-label="Loading fact">
          <div className="h-4 w-full animate-pulse rounded bg-amber-200/70" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-amber-200/70" />
        </div>
      )}

      {state.status === "ready" && (
        <>
          <p className="mt-2 text-slate-800">{state.data.fact.content}</p>
          {state.data.source === "stale-fallback" && (
            <p className="mt-2 text-xs text-amber-800">
              We couldn&apos;t fetch a new fact, so here&apos;s an earlier one.
            </p>
          )}
        </>
      )}

      {state.status === "error" && (
        <div className="mt-2">
          <p className="text-slate-800">{state.message}</p>
          <button
            type="button"
            onClick={load}
            className="mt-3 rounded-lg bg-amber-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
