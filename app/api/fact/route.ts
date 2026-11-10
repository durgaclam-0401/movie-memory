import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getFactForUser } from "@/lib/facts";
import { openAIFactGenerator } from "@/lib/openai";
import { apiError, toApiError } from "@/lib/errors";
import type { FactResponse } from "@/lib/api-types";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" }; // FACT-4

/**
 * GET /api/fact — a fact for the signed-in user's favorite movie.
 * Takes no input: the request (including any ?userId=) is deliberately
 * ignored, and the user comes only from the session (SEC-1).
 */
export async function GET(_request: Request) {
  const user = await getSessionUser();
  if (!user) {
    const { status, body } = apiError("UNAUTHENTICATED"); // SEC-3
    return NextResponse.json(body, { status, headers: NO_STORE });
  }

  try {
    const { fact, source } = await getFactForUser(user.id, openAIFactGenerator);
    const body: FactResponse = {
      fact: {
        content: fact.content,
        movieTitle: fact.movieTitle,
        createdAt: fact.createdAt.toISOString(),
      },
      source,
    };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err) {
    const { status, body } = toApiError(err);
    if (status === 500) console.error("[api/fact] unexpected error", { userId: user.id, err });
    return NextResponse.json(body, { status, headers: NO_STORE });
  }
}
