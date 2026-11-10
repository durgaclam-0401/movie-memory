import type { ApiError, ErrorCode } from "@/lib/api-types";

// Domain errors thrown by lib/facts.ts. Route handlers turn them into HTTP
// responses with toApiError(), the single place that maps errors to status
// codes and user-facing messages (REPORT §7).

export class OnboardingRequiredError extends Error {
  constructor() {
    super("User has no favorite movie");
    this.name = "OnboardingRequiredError";
  }
}

export class GenerationInProgressError extends Error {
  constructor() {
    super("Another request is generating a fact for this user");
    this.name = "GenerationInProgressError";
  }
}

export class FactUnavailableError extends Error {
  constructor() {
    super("Fact generation failed and no earlier fact exists");
    this.name = "FactUnavailableError";
  }
}

const RESPONSES: Record<ErrorCode, { status: number; message: string }> = {
  UNAUTHENTICATED: { status: 401, message: "Please sign in." },
  ONBOARDING_REQUIRED: { status: 409, message: "Tell us your favorite movie first." },
  GENERATION_IN_PROGRESS: {
    status: 503,
    message: "We're still coming up with your fact. Please try again in a moment.",
  },
  FACT_UNAVAILABLE: {
    status: 503,
    message: "We couldn't come up with a fact right now. Please try again in a moment.",
  },
  INTERNAL: { status: 500, message: "Something went wrong." },
};

export function apiError(code: ErrorCode): { status: number; body: ApiError } {
  const { status, message } = RESPONSES[code];
  return { status, body: { error: { code, message } } };
}

/** Maps any thrown value to a safe response. Never exposes error.message (SEC-5). */
export function toApiError(err: unknown): { status: number; body: ApiError } {
  if (err instanceof OnboardingRequiredError) return apiError("ONBOARDING_REQUIRED");
  if (err instanceof GenerationInProgressError) return apiError("GENERATION_IN_PROGRESS");
  if (err instanceof FactUnavailableError) return apiError("FACT_UNAVAILABLE");
  return apiError("INTERNAL");
}
