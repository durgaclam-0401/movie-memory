// Shared contract for GET /api/fact (SPEC §5). Safe to import from client code.

export type FactSource = "fresh";

export type FactResponse = {
  fact: { content: string; movieTitle: string; createdAt: string };
  source: FactSource;
};

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "ONBOARDING_REQUIRED"
  | "FACT_UNAVAILABLE"
  | "INTERNAL";

export type ApiError = { error: { code: ErrorCode; message: string } };
