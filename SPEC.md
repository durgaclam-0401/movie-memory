# Movie Memory — Requirements Specification

| | |
|---|---|
| Version | 1.1 (scope reduced to a 3–4 hour build) |
| Variant | **A — Backend-Focused (caching + correctness)** |
| Companion docs | [README.md](README.md) (setup + overview), [docs/REPORT.md](docs/REPORT.md) (how everything works) |

This document says **what** is built. Every requirement has an ID (e.g.
`LOCK-2`), every test names the IDs it verifies, and §9 maps requirements to
tests. A requirement is done only when its tests pass.

**MUST / MUST NOT / SHOULD** are used as in RFC 2119.

---

## 1. Scope

### 1.1 In scope (everything the brief requires, nothing more)
- Google sign-in and sign-out.
- One-time onboarding that captures a favorite movie.
- Dashboard: name, email, photo, favorite movie, logout, one fun fact.
- Variant A: 60-second cache, burst protection, OpenAI failure fallback.
- Backend tests for validation, cache logic, concurrency, failure handling and
  authorization.

### 1.2 Cut from scope (deliberately)

| Cut | Why it's safe to cut |
|---|---|
| Editing the favorite movie | Variant B feature. The data model still supports it. |
| "Refresh fact" button and countdown | Not required; reloading the page exercises the same cache logic. |
| Browser end-to-end tests (Playwright) and component tests | Variant A is evaluated on backend correctness. Auth flow is covered by a short manual checklist. |
| Fake OpenAI mode via environment variable | Only needed for E2E. Tests inject a fake generator directly. |
| Whitespace collapsing, control-character rules, output truncation | Trim + length limits meet the brief; `max_tokens` already bounds output. |
| Custom OAuth error page | Auth.js's built-in error page is adequate. |
| Rate limiting, logging infrastructure, CI | Listed under "With 2 more hours" in the README. |

---

## 2. Technology

| Concern | Choice |
|---|---|
| Language | TypeScript, `strict: true` |
| Framework | Next.js App Router, React Server Components, Server Actions |
| Styling | TailwindCSS |
| Database | PostgreSQL 16 in Docker Compose |
| ORM | Prisma (schema + migrations) |
| Auth | Auth.js (NextAuth v5), Google provider, Prisma adapter, database sessions |
| AI | OpenAI Node SDK; model from `OPENAI_MODEL`, default `gpt-4o-mini` |
| Validation | zod |
| Tests | Vitest against a real Postgres test database |

---

## 3. Functional requirements

### 3.1 Authentication (`AUTH`)

| ID | Requirement |
|---|---|
| AUTH-1 | `/` without a session MUST show a landing page with a **"Sign in with Google"** button. |
| AUTH-2 | Sign-in uses Auth.js with Google. First sign-in creates a `User` (name, email, image from Google); later sign-ins reuse it. After sign-in the user returns to `/`. |
| AUTH-3 | `/` with a session MUST redirect: no favorite movie → `/onboarding`; has one → `/dashboard`. |
| AUTH-4 | `/dashboard` and `/onboarding` without a session MUST redirect to `/`. |
| AUTH-5 | The dashboard MUST have a **Log out** button that deletes the session and returns to `/`. |
| AUTH-6 | Every page, route handler and server action that needs a user MUST get it through `lib/auth.ts`: `getSessionUser()` (returns the user or `null`) and `requireUser()` (returns the user or redirects to `/`). |

### 3.2 Onboarding (`ONB`)

| ID | Requirement |
|---|---|
| ONB-1 | `/onboarding` shows one text field ("What's your favorite movie?") and a submit button. |
| ONB-2 | Submission goes to a server action. Validation runs on the server: trim whitespace, then length **1–100** characters. |
| ONB-3 | Invalid input re-renders the form with the typed value and a message: empty → "Please enter a movie title."; too long → "Movie titles must be 100 characters or fewer." |
| ONB-4 | Valid input is saved to `User.favoriteMovie` for the **session user** (never a user ID from the form), then redirects to `/dashboard`. |
| ONB-5 | Onboarding is first-time only. An onboarded user visiting `/onboarding` is redirected to `/dashboard`, and the action MUST NOT overwrite an existing movie, even if two submits race (the update is conditional on `favoriteMovie IS NULL`). |

### 3.3 Dashboard (`DASH`)

| ID | Requirement |
|---|---|
| DASH-1 | `/dashboard` shows name, email, photo and favorite movie from the database, plus the logout button. |
| DASH-2 | Missing name → email prefix (before `@`); missing both → "Movie fan". |
| DASH-3 | Missing photo → circle with the user's initials. Never a broken image. |
| DASH-4 | A signed-in user without a favorite movie is redirected to `/onboarding`. |
| DASH-5 | The fact is loaded by a client component (`FactCard`) from `GET /api/fact`, so the profile never waits on OpenAI. States: **loading**, **fact**, **fact + "showing an earlier fact" note** (stale fallback), **error + "Try again" button**. |

### 3.4 Fact generation (`FACT`)

| ID | Requirement |
|---|---|
| FACT-1 | Facts are generated on the server with OpenAI. The API key never reaches the browser. |
| FACT-2 | Every generated fact is stored in `Fact` with `userId`, `movieTitle` (the title it was generated for), `content`, `createdAt`. |
| FACT-3 | Prompt: system message asks for one fun trivia fact (max 2 sentences, no preamble); the movie title goes only in the user message; `max_tokens: 150`. Output is trimmed; empty output counts as a failure. |
| FACT-4 | `GET /api/fact` responses carry `Cache-Control: no-store`. |

### 3.5 Cache window (`CACHE`) — Variant A

| ID | Requirement |
|---|---|
| CACHE-1 | Cache key is **(userId, movieTitle)**. A fact for a different movie never counts. |
| CACHE-2 | If the latest fact for the key is **less than 60 seconds** old, return it (`source: "cache"`) without calling OpenAI. |
| CACHE-3 | If it is **60 seconds or older**, or none exists, generate, store and return a new fact (`source: "fresh"`). |

### 3.6 Burst protection (`LOCK`) — Variant A

Approach: **"generation in progress" lease row in Postgres, with expiry and an owner token.**

| ID | Requirement |
|---|---|
| LOCK-1 | At most one OpenAI generation per user may run at a time, across tabs, requests and server instances. |
| LOCK-2 | The lease is acquired with one atomic SQL statement (`INSERT … ON CONFLICT DO UPDATE … WHERE expiresAt < now() RETURNING`). Getting a row back means you hold the lease. |
| LOCK-3 | The lease expires after **30 seconds**, so a crashed request can't block generation for longer. |
| LOCK-4 | Each lease has a random token. Release deletes only where user **and** token match, in a `finally` block. |
| LOCK-5 | After acquiring, the service re-checks the cache before calling OpenAI. |
| LOCK-6 | A request that can't get the lease polls every **500 ms for up to 12 s** for a new fact. Found → return it. If the lease disappears without a new fact (the holder failed), stop waiting early. Not found → return the latest older fact (`stale-fallback`); with none, `503 FACT_UNAVAILABLE` if the holder gave up, or `503 GENERATION_IN_PROGRESS` if it is still running. |

### 3.7 Failure handling (`FAIL`) — Variant A

| ID | Requirement |
|---|---|
| FAIL-1 | OpenAI is called with a **10 s timeout** and **no SDK retries**. |
| FAIL-2 | On any generation failure, return the latest fact for the key with `source: "stale-fallback"` (HTTP 200) if one exists. |
| FAIL-3 | Otherwise respond `503 FACT_UNAVAILABLE`: "We couldn't come up with a fact right now. Please try again in a moment." |
| FAIL-4 | Provider errors are logged on the server and never sent to the client. |
| FAIL-5 | A failed generation writes no `Fact` row. |

### 3.8 Security (`SEC`)

| ID | Requirement |
|---|---|
| SEC-1 | No endpoint or action accepts a user ID from the client. The acting user always comes from the session. |
| SEC-2 | Every query on user-owned data is filtered by the session user's ID. |
| SEC-3 | `GET /api/fact` without a session returns `401 UNAUTHENTICATED`. |
| SEC-4 | Modules holding secrets (`lib/prisma.ts`, `lib/auth.ts`, `lib/openai.ts`, `lib/facts.ts`) `import "server-only"`. No secret uses a `NEXT_PUBLIC_` variable. |
| SEC-5 | Error responses contain no stack traces, SQL or provider messages. |

---

## 4. Data model

```prisma
model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?
  favoriteMovie String?   @db.VarChar(100)   // null = not onboarded yet
  createdAt     DateTime  @default(now())
  accounts      Account[]
  sessions      Session[]
  facts         Fact[]
  factLock      FactGenerationLock?
}

model Fact {
  id         String   @id @default(cuid())
  userId     String
  movieTitle String   @db.VarChar(100)
  content    String
  createdAt  DateTime @default(now()) @db.Timestamptz(3)
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, movieTitle, createdAt(sort: Desc)])
}

model FactGenerationLock {
  userId    String   @id
  token     String
  expiresAt DateTime @db.Timestamptz(3)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// + standard Auth.js models: Account, Session, VerificationToken
```

The reasoning for each choice is in [docs/REPORT.md §4](docs/REPORT.md).

---

## 5. API contract

### `GET /api/fact`
No parameters. Returns a fact for the session user's favorite movie.

```ts
// 200
type FactResponse = {
  fact: { content: string; movieTitle: string; createdAt: string }; // ISO date
  source: "cache" | "fresh" | "stale-fallback";
};

// every error
type ApiError = { error: { code: ErrorCode; message: string } };
```

| Status | `code` | When |
|---|---|---|
| 200 | — | A fact is returned |
| 401 | `UNAUTHENTICATED` | No session |
| 409 | `ONBOARDING_REQUIRED` | No favorite movie |
| 503 | `GENERATION_IN_PROGRESS` | Another request is generating and nothing to show yet |
| 503 | `FACT_UNAVAILABLE` | OpenAI failed and no earlier fact exists |
| 500 | `INTERNAL` | Anything unexpected |

### Server actions
- `saveFavoriteMovie(prevState, formData)` → returns `{ error, value }` on invalid input; otherwise redirects to `/dashboard`.
- `signOutAction()` → deletes session, redirects to `/`.

---

## 6. Fact service algorithm

Constants (in `lib/facts.ts`): `CACHE_WINDOW_MS = 60_000`,
`LEASE_TTL_MS = 30_000`, `WAIT_POLL_MS = 500`, `WAIT_MAX_MS = 12_000`.
`OPENAI_TIMEOUT_MS = 10_000` lives in `lib/openai.ts`.

```
getFactForUser(userId, generator):
  movie = user.favoriteMovie            → none: throw OnboardingRequired
  latest = newest Fact where userId, movieTitle = movie
  if latest is < 60s old → return latest, "cache"

  token = acquireLease(userId)
  if no token:                          // someone else is generating
     fact = poll for a fact newer than `latest`
     if fact   → return fact, "cache"
     if latest → return latest, "stale-fallback"
     throw GenerationInProgress

  try:
     latest = newest Fact again          // LOCK-5
     if latest is < 60s old → return latest, "cache"
     try content = generator.generate(movie)
     catch → log; if latest → return latest, "stale-fallback"; else throw FactUnavailable
     return insert Fact(...), "fresh"
  finally:
     releaseLease(userId, token)
```

`generator` is `{ generate(movieTitle): Promise<string> }`. Production passes
the OpenAI implementation; tests pass a fake. This is the only seam needed
for testing.

---

## 7. Configuration

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `AUTH_SECRET` | yes | Auth.js secret (`npx auth secret`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | yes | Google OAuth client |
| `OPENAI_API_KEY` | yes | OpenAI key (missing ⇒ generation fails gracefully) |
| `OPENAI_MODEL` | no | Default `gpt-4o-mini` |

Tests read `.env.test`, which points at a separate `movie_memory_test` database.

---

## 8. Test plan

**Tool:** Vitest. **Database:** real Postgres (`movie_memory_test`). Schema is
brought up to date once per run with `prisma migrate deploy` (non-destructive);
tables are truncated before each test. Both steps refuse to run unless
`DATABASE_URL` contains `_test`. A real database is required because a mock
can't prove the lease is atomic.

**Mutation-checked:** the suite was confirmed to fail when (a) the cache
comparison is changed from `<` to `<=`, (b) the lease is made always
acquirable, and (c) the `userId` filter is removed from the fact lookup.

**Time:** tests set fact age by inserting `createdAt` explicitly (e.g. 59 s
ago); nothing sleeps except the concurrency test's fake generator.

**OpenAI:** never called in tests. A fake generator is passed in that counts
calls and can succeed, fail or be slow.

**Session:** route and action tests mock `getSessionUser()` in `lib/auth.ts`
to return a chosen test user (or `null`). Everything after that runs for real.

| File | ID | Case | Verifies |
|---|---|---|---|
| `tests/validation.test.ts` | U-1 | `"  Inception  "` saved as `"Inception"` | ONB-2 |
| | U-2 | `""` and `"   "` rejected with the empty message | ONB-2, ONB-3 |
| | U-3 | 100 characters accepted, 101 rejected with the length message | ONB-2, ONB-3 |
| | U-3b | Length is checked after trimming | ONB-2 |
| `tests/display.test.ts` | U-4 | name → name; no name → email prefix; neither → "Movie fan" | DASH-2 |
| | U-5 | initials: "Ada Lovelace" → "AL", "cher" → "C" | DASH-3 |
| `tests/facts.cache.test.ts` | I-1 | No facts → generated once, stored, `fresh` | CACHE-3, FACT-2 |
| | I-2 | Fact 59 s old → returned, generator not called, `cache` | CACHE-2 |
| | I-3 | Fact 60 s old → regenerated; next call is a cache hit | CACHE-3 |
| | I-3b | `isFresh` at fixed times: 59 999 ms fresh, 60 000 ms not | CACHE-2, CACHE-3 |
| | I-4 | Fresh fact exists for a different movie → generates for current movie | CACHE-1 |
| | I-4b | Another user's fresh fact for the same movie is not reused | CACHE-1, SEC-2 |
| | I-4c | No favorite movie → `OnboardingRequiredError` | §5 |
| `tests/facts.lock.test.ts` | I-5 | 5 parallel requests, slow generator → generator called **once**, all 5 get the same fact, 1 row stored | LOCK-1, LOCK-5, LOCK-6 |
| | I-5b | Two users generate in parallel without blocking each other | LOCK-1 |
| | I-6 | Expired lease in the table → acquired and generation proceeds | LOCK-2, LOCK-3 |
| | I-6b | An unexpired lease can't be acquired twice | LOCK-2 |
| | I-7 | Release with the wrong token leaves the lease in place | LOCK-4 |
| | I-8 | Lease row is gone after both a success and a failure | LOCK-4 |
| | I-8b | Waiter times out, no fact → `GenerationInProgressError`, no OpenAI call | LOCK-6 |
| | I-8c | Waiter times out, older fact exists → `stale-fallback` | LOCK-6 |
| | I-8d | Holder releases without a fact → waiter stops early with `FactUnavailableError` | LOCK-6 |
| `tests/facts.failure.test.ts` | I-9 | Generator throws, older fact exists → older fact, `stale-fallback`, no new row | FAIL-2, FAIL-5 |
| | I-10 | Generator throws, no fact → `FactUnavailable`, no row | FAIL-3, FAIL-5 |
| | I-10b | Older fact for a *different* movie is not used as fallback | FAIL-3, CACHE-1 |
| | I-10c | Missing `OPENAI_API_KEY` → treated as a failure (no network call) | FAIL-1 |
| `tests/onboarding.test.ts` | I-11 | Valid input saved for session user; a `userId` field in the form is ignored | ONB-4, SEC-1 |
| | I-12 | Invalid input → error + typed value returned, nothing saved | ONB-3 |
| | I-13 | Already onboarded → existing movie not overwritten | ONB-5 |
| | I-13b | No session → redirect to `/` | AUTH-6 |
| `tests/fact-route.test.ts` | R-1 | No session → 401 `UNAUTHENTICATED`, generator not called | SEC-3 |
| | R-2 | Valid session → 200, body matches `FactResponse`, `Cache-Control: no-store` | FACT-4 |
| | R-3 | A and B pick the same movie, B's fact is newer; request as A with `?userId=<B's id>` → A's fact only | SEC-1, SEC-2 |
| | R-4 | User without movie → 409 `ONBOARDING_REQUIRED` | §5 |
| | R-5 | No fact available → 503 with the friendly message; provider error text not leaked | FAIL-3, FAIL-4, SEC-5 |
| | R-6 | Unexpected error (DB failure) → 500 `INTERNAL`, no internals leaked | SEC-5 |

**Manual checklist** (run once with real Google and OpenAI; steps in README):

| ID | Case | Verifies |
|---|---|---|
| M-1 | Logged out: `/` shows sign-in; `/dashboard` redirects to `/` | AUTH-1, AUTH-4 |
| M-2 | New Google account → onboarding → dashboard shows profile and movie | AUTH-2, AUTH-3, ONB-1, DASH-1 |
| M-3 | Log out, sign in again → straight to dashboard | AUTH-3, AUTH-5 |
| M-4 | Reload within 60 s → same fact; after 60 s → new fact | CACHE-2, CACHE-3 |
| M-5 | No API key or secret visible in browser network responses or JS | FACT-1, SEC-4 |

---

## 9. Traceability

| Requirement | Verified by |
|---|---|
| AUTH-1, AUTH-4 | M-1 |
| AUTH-2 | M-2 |
| AUTH-3 | M-2, M-3 |
| AUTH-5 | M-3 |
| AUTH-6 | R-1, I-13b, code review |
| ONB-1 | M-2 |
| ONB-2 | U-1..U-3b |
| ONB-3 | U-2, U-3, I-12 |
| ONB-4 | I-11 |
| ONB-5 | I-13 |
| DASH-1 | M-2 |
| DASH-2, DASH-3 | U-4, U-5 |
| DASH-4, DASH-5 | M-2, code review |
| FACT-1 | M-5 |
| FACT-2 | I-1 |
| FACT-3 | code review (`lib/openai.ts`) |
| FACT-4 | R-2 |
| CACHE-1..3 | I-1..I-4c, M-4 |
| LOCK-1..6 | I-5..I-8d |
| FAIL-1 | I-10c, code review (`lib/openai.ts`) |
| FAIL-2..5 | I-9..I-10b, R-5 |
| SEC-1, SEC-2 | I-4b, I-11, R-3 |
| SEC-3 | R-1 |
| SEC-4 | M-5 (bundle scanned for secrets), code review |
| SEC-5 | R-5, R-6 |

---

## 10. Build order and time budget (~3.5 h)

| # | Step | Time |
|---|---|---|
| 1 | Scaffold Next.js + Tailwind, Docker Postgres, Prisma schema, first migration | 30 min |
| 2 | Auth.js + Google, `requireUser()`, landing page, routing from `/`, logout | 40 min |
| 3 | Onboarding page, validation, server action | 20 min |
| 4 | Dashboard, profile fallbacks, `FactCard`, `GET /api/fact`, OpenAI generator | 30 min |
| 5 | Variant A: cache window, lease, waiting, failure fallback | 40 min |
| 6 | Test setup + all tests in §8 | 40 min |
| 7 | Manual checklist, README and REPORT checked against code | 20 min |

## 11. Definition of done
1. All requirements implemented; all tests in §8 pass.
2. `npm run typecheck`, `npm run lint` and `npm test` pass.
3. Manual checklist M-1..M-5 done once.
4. README and docs/REPORT.md match the code.

## 12. Decisions made on the author's behalf
| # | Decision |
|---|---|
| D-1 | A fact exactly 60 s old is expired (brief: "less than 60 seconds" is cached). |
| D-2 | Movie titles are free text; we don't check the movie exists. |
| D-3 | A request that waited for another request's fact gets `source: "cache"`. |
| D-4 | Generating on `GET` is acceptable: the brief names `GET /api/fact`, and within the window repeated calls return the same result. |
| D-5 | The fact service writes `createdAt` from the app's clock and compares age with the same clock, so the cache window never mixes two clocks. The lease uses Postgres's `now()` for both writing and comparing, for the same reason. See REPORT §5. |
