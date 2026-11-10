# Movie Memory — How It Works

This is the project's knowledge base. It explains every file, every flow and
every decision, so any question about the repo can be answered from here.

- **What** is built (requirements, IDs, test cases): [SPEC.md](../SPEC.md)
- **How to run it**: [README.md](../README.md)
- **How and why it works**: this file

> **Status (2026-11-09):** checked against the implemented code. 36 automated
> tests pass; typecheck, lint and production build are clean. The UI flow
> (onboarding → dashboard → logout) was exercised in a browser with a seeded
> session. **Not yet verified:** a real Google sign-in and a real OpenAI call
> (no credentials were available in the build session) — see README manual checklist.

## Contents
1. [The app in one paragraph](#1-the-app-in-one-paragraph)
2. [File map](#2-file-map)
3. [Request flows, step by step](#3-request-flows-step-by-step)
4. [Data model](#4-data-model)
5. [Variant A: cache, lease and fallback](#5-variant-a-cache-lease-and-fallback)
6. [Authentication and security](#6-authentication-and-security)
7. [Errors: where they start and how they reach the user](#7-errors-where-they-start-and-how-they-reach-the-user)
8. [Constants and configuration](#8-constants-and-configuration)
9. [Testing](#9-testing)
10. [Decision log](#10-decision-log)
11. [Known limitations](#11-known-limitations)
12. [FAQ](#12-faq)
13. [Keeping this report accurate](#13-keeping-this-report-accurate)

---

## 1. The app in one paragraph

A user signs in with Google. If they've never told us a favorite movie, they
see a one-field onboarding form; otherwise they go to the dashboard. The
dashboard shows their Google profile, their movie, and a fun fact about it.
The fact comes from `GET /api/fact`, which returns a fact under 60 seconds old
if there is one, otherwise asks OpenAI for a new one. A database "lease" makes
sure only one OpenAI call per user runs at a time, and if OpenAI fails the
user gets the most recent older fact instead of an error.

---

## 2. File map

| Path | What it does |
|---|---|
| `app/layout.tsx` | Root HTML layout, loads Tailwind (`app/globals.css`). |
| `app/page.tsx` | Landing page. Logged out: "Sign in with Google" button (a form calling Auth.js `signIn("google")`). Logged in: redirects to `/onboarding` or `/dashboard`. |
| `app/onboarding/page.tsx` | Server component. `requireUser()`; if the user already has a movie, redirect to `/dashboard`; otherwise render `<OnboardingForm>`. |
| `app/onboarding/OnboardingForm.tsx` | Client component. Uses `useActionState` with `saveFavoriteMovie` so server errors and the typed value come back into the form. |
| `app/onboarding/actions.ts` | `saveFavoriteMovie` server action: validate → save for session user → redirect. |
| `app/dashboard/page.tsx` | Server component. `requireUser()`; no movie → `/onboarding`. Renders profile (with fallbacks), movie, logout form and `<FactCard>`. |
| `app/dashboard/FactCard.tsx` | Client component. Fetches `/api/fact` on mount; renders loading / fact / stale note / error + "Try again". |
| `app/dashboard/actions.ts` | `signOutAction` server action → Auth.js `signOut({ redirectTo: "/" })`. |
| `app/api/auth/[...nextauth]/route.ts` | Exposes Auth.js's GET/POST handlers (OAuth callback, sign-in, sign-out). |
| `app/api/fact/route.ts` | Thin HTTP layer: `getSessionUser()` → 401 or `getFactForUser()` → map result/errors to JSON. |
| `lib/auth.ts` | Auth.js config (Google provider, Prisma adapter, database sessions) plus `getSessionUser()` and `requireUser()`. |
| `lib/prisma.ts` | One shared `PrismaClient` (cached on `globalThis` in dev so hot reload doesn't open new pools). |
| `lib/validation.ts` | `movieTitleSchema` (zod): trim, 1–100 chars, with the user-facing messages. |
| `lib/display.ts` | `displayName(user)` and `initials(name)` for missing Google name/photo. |
| `lib/openai.ts` | `openAIFactGenerator`: the only file importing the OpenAI SDK. Holds the prompt, timeout and `max_tokens`. |
| `lib/facts.ts` | **Variant A core.** `getFactForUser(userId, generator)`: cache window, lease, waiting, fallback. Also the `FactGenerator` type and the timing constants. |
| `lib/lease.ts` | `acquireLease(userId)` and `releaseLease(userId, token)`: the two raw SQL statements. |
| `lib/lease.ts` → `isLeaseActive` | Used by waiting requests to notice the holder gave up (§5.3). |
| `lib/errors.ts` | Domain errors (`OnboardingRequiredError`, `GenerationInProgressError`, `FactUnavailableError`), `apiError(code)` and `toApiError(err)` mapping them to status + code + fixed message. |
| `lib/api-types.ts` | `FactResponse`, `ApiError`, `ErrorCode`: the API contract, shared by the route and `FactCard`. Has no server imports, so it's safe in client code. |
| `prisma/schema.prisma` | Data model (see §4). |
| `prisma/migrations/` | Generated SQL migrations. Never edit by hand; change the schema and run `prisma migrate dev`. |
| `docker-compose.yml` | Postgres 16 on port 5432. |
| `docker/init.sql` | Creates the second database, `movie_memory_test`. |
| `.env.example` | Every environment variable with placeholders. |
| `.env.test` | Test settings (test DB URL, dummy secrets). Contains no real secrets. |
| `vitest.config.mts` | Loads `.env.test` (or `TEST_DATABASE_URL` if set), aliases `@/` and stubs `server-only`, runs test files one at a time (they share one DB). |
| `tests/global-setup.ts` | Once per run: refuses unless `DATABASE_URL` contains `_test`, then `prisma migrate deploy`. |
| `tests/setup.ts` | Before each test: truncates all tables; silences expected `console.error` logs. |
| `tests/server-only-stub.ts` | Empty module standing in for `server-only` under Vitest. |
| `tests/helpers.ts` | `createUser()`, `insertFact({ ageMs })`, `fakeGenerator({ fail, delayMs })`, `fastWait`. |
| `.claude/launch.json` | Dev-server config for Claude's browser preview (`npm run dev`, port 3000). |
| `tests/*.test.ts` | One file per area; see §9. |

**Rule of thumb:** HTTP and rendering live in `app/`; rules live in `lib/`.
If you're looking for *why* something happens, start in `lib/facts.ts`.

---

## 3. Request flows, step by step

### 3.1 Sign-in
1. Logged-out user opens `/`. `app/page.tsx` calls `auth()` → no session → renders the landing page.
2. "Sign in with Google" submits a form to a server action calling `signIn("google", { redirectTo: "/" })`.
3. Google shows its consent screen, then redirects to `/api/auth/callback/google`.
4. Auth.js (via the Prisma adapter) finds or creates the `User` and `Account` rows, creates a `Session` row, and sets the `authjs.session-token` cookie (HttpOnly).
5. Browser lands on `/` again; this time there's a session (step 3.2).

### 3.2 Routing from `/`
`app/page.tsx` → `getSessionUser()`:
- `null` → landing page
- `favoriteMovie === null` → `redirect("/onboarding")`
- otherwise → `redirect("/dashboard")`

"First-time user" is defined by the data, not by a flag, so it can never be
out of sync.

### 3.3 Onboarding submit
1. `OnboardingForm` posts to `saveFavoriteMovie`.
2. Action calls `requireUser()` (no session → redirect `/`).
3. If the user already has a movie → redirect `/dashboard` without writing (ONB-5).
4. `movieTitleSchema.safeParse(formData.get("movie"))`. Failure → return `{ error, value }`; the form re-renders with the message and the typed text.
5. `prisma.user.updateMany({ where: { id: user.id, favoriteMovie: null }, data: { favoriteMovie } })`. The ID comes from the session; any `userId` in the form is ignored. The `favoriteMovie: null` condition means two racing submits can't overwrite each other — the second matches no row.
6. `redirect("/dashboard")`.

### 3.4 Dashboard load
1. `requireUser()`; no movie → `/onboarding`.
2. Renders name (`displayName`), email, photo or initials, movie and logout form immediately.
3. `<FactCard>` mounts in the browser and calls `fetch("/api/fact")`.

### 3.5 `GET /api/fact`
1. `getSessionUser()` → `null` → **401**.
2. `getFactForUser(user.id, openAIFactGenerator)` (§5).
3. Success → **200** `{ fact, source }` with `Cache-Control: no-store`.
4. Domain error → `toApiError()` → 409 / 503. Anything else → logged, **500** `INTERNAL`.

### 3.6 Logout
Logout form → `signOutAction` → Auth.js deletes the `Session` row and clears
the cookie → redirect `/`.

---

## 4. Data model

```
User 1──* Fact                 latest fact per (userId, movieTitle) is the cache
User 1──0..1 FactGenerationLock  "a generation is in progress for this user"
User 1──* Account, Session     managed by Auth.js
```

### `User`
| Column | Notes |
|---|---|
| `id` | cuid, primary key. The only identity used in our queries. |
| `name`, `email`, `image` | From Google; any may be null. The dashboard handles each (§6.4). |
| `emailVerified` | Required by the Auth.js adapter; unused by us. |
| `favoriteMovie` | `VARCHAR(100)`, null until onboarding. Null **is** the "needs onboarding" signal. |

**Why a column and not a `Movie` table?** One favorite per user, no movie
metadata. A table would add a join and a second write for no benefit. If
movie history or metadata were ever needed, it would become a table then.

### `Fact`
| Column | Notes |
|---|---|
| `userId` | Owner. Every query filters by it. Cascade-deletes with the user. |
| `movieTitle` | The title this fact was generated for (a snapshot). |
| `content` | The fact text. |
| `createdAt` | `timestamptz`. Set by the fact service from the app clock (see §5.1). |

**Why store `movieTitle` on each fact?** The cache key is "user + movie". With
the title on the row, "latest fact for this user's current movie" is one
indexed lookup, and if the movie ever changed, old facts would simply stop
matching — no invalidation code.

**Index `(userId, movieTitle, createdAt DESC)`** matches that lookup exactly,
so it reads one index entry no matter how many facts exist.

### `FactGenerationLock`
| Column | Notes |
|---|---|
| `userId` | Primary key → at most one lease per user. This is what makes acquiring atomic. |
| `token` | Random UUID identifying the holder. |
| `expiresAt` | `timestamptz`. Lease is free once this is in the past. |

**Why `timestamptz` for the time columns?** `expiresAt` is written and
compared with Postgres `now()`. Prisma's default `DateTime` is `timestamp`
*without* time zone, which Postgres interprets in the session time zone. The
build machine's Postgres ran in CST, so a plain `timestamp` would have mixed
UTC values written by Prisma with local values from `now()` and shifted every
expiry by hours. `timestamptz` stores an absolute instant, so this can't happen.

**Why a separate table?** Coordination state ("someone is generating") is
short-lived and has different rules from fact data. Mixing it into `Fact`
(e.g. a placeholder row with `content = null`) would make every fact query
handle half-finished rows.

### Auth.js tables
`Account` links a Google identity to a `User`; `Session` holds active
sessions (database strategy); `VerificationToken` is required by the adapter
but unused (no email sign-in).

---

## 5. Variant A: cache, lease and fallback

All of this is in `lib/facts.ts` and `lib/lease.ts`.

### 5.1 The 60-second window
- Latest fact age `< 60 000 ms` → return it, `source: "cache"`.
- Age `≥ 60 000 ms` or no fact → generate.
- Exactly 60 s counts as expired, because the brief says "less than 60
  seconds old" is cached.

**Clocks.** The service writes `createdAt: new Date()` itself and compares
against `Date.now()`, so the window only ever uses the app server's clock.
If `createdAt` came from Postgres while the comparison used Node, any drift
between the two machines would shift the window. The lease (§5.2) does the
opposite — it writes and compares with Postgres's `now()` — for the same
reason: each mechanism uses exactly one clock.

### 5.2 The lease (burst protection)

**Acquire** (`acquireLease`):
```sql
INSERT INTO "FactGenerationLock" ("userId", "token", "expiresAt")
VALUES ($1, $2, now() + $3::double precision * interval '1 millisecond')  -- $3 = LEASE_TTL_MS
ON CONFLICT ("userId") DO UPDATE
  SET "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt"
  WHERE "FactGenerationLock"."expiresAt" < now()
RETURNING "token";
```
- No row for this user → insert succeeds → token returned → **you hold the lease**.
- Row exists and expired → the `WHERE` passes → overwritten → token returned → **you hold it**.
- Row exists and not expired → `WHERE` fails → nothing updated → **no row returned** → someone else holds it.

Postgres locks the conflicting primary-key row during `ON CONFLICT`, so two
simultaneous requests can't both get a row back. This is the whole guarantee,
and it holds across any number of server processes because the database is
the single arbiter.

**Release** (`releaseLease`):
```sql
DELETE FROM "FactGenerationLock" WHERE "userId" = $1 AND "token" = $2;
```
The token check matters in this scenario: request A's OpenAI call hangs past
30 s, its lease expires, request B takes a new lease, then A finally finishes.
Without the token, A would delete **B's** lease and let a third request start
a duplicate generation.

**Re-check after acquiring.** Between "I read the latest fact" and "I got the
lease", another request may have finished generating and released. So the
service reads the latest fact again before calling OpenAI.

### 5.3 What waiting requests do
A request that didn't get the lease polls every 500 ms for up to 12 s. Each
round it checks two things:
1. Is there now a fresh (< 60 s) fact? → return it (`source: "cache"`; this request didn't generate it).
2. Is the lease still held (`isLeaseActive`, using Postgres `now()`)? If not, the holder finished without a fact (OpenAI failed) or crashed long ago → stop waiting immediately instead of burning the full 12 s.

After waiting:
- older fact exists → return it (`stale-fallback`)
- no fact, holder gave up → `503 FACT_UNAVAILABLE`
- no fact, still generating after 12 s → `503 GENERATION_IN_PROGRESS`

In both 503 cases the card shows the message and "Try again".

12 s is just above the 10 s OpenAI timeout, so a waiter normally outlives the
generation it's waiting for.

### 5.4 Failure handling
`lib/openai.ts` calls OpenAI with `timeout: 10_000` and `maxRetries: 0`.
Any failure — timeout, network error, 4xx/5xx, missing API key, empty
output — throws. `getFactForUser` catches it, logs it with `console.error`,
then:
- older fact exists → return it, `source: "stale-fallback"` (HTTP 200)
- none → `FactUnavailableError` → 503 with a friendly message

No `Fact` row is written on failure, and the lease is released in `finally`.

**Why no retries?** The SDK's default would retry twice, so one bad call
could keep the user waiting 30 s. The stale fallback already gives them
something useful, so one bounded attempt is the better tradeoff.

### 5.5 Timelines

**Two tabs open at the same moment (latest fact is 2 minutes old):**
```
t=0     Tab 1: latest 2m old → acquire → gets lease → re-check → call OpenAI
t=0     Tab 2: latest 2m old → acquire → no row (Tab 1 holds it) → start polling
t=1.5s  Tab 1: fact inserted, lease released, returns "fresh"
t=2.0s  Tab 2: poll finds Tab 1's fact → returns it as "cache"
Result: 1 OpenAI call, both tabs show the same fact.
```

**Server crashes mid-generation:**
```
t=0     Request A takes lease, process dies before release
t=5s    Request B: lease not expired → waits 12 s → returns older fact (stale) or 503
t=31s   Request C: lease expired → takes it → generates normally
Result: worst case ~30 s without new facts for that one user; nothing stuck forever.
```

**OpenAI is down:**
```
Request: latest is 5m old → lease → OpenAI times out at 10 s → return 5m-old fact as "stale-fallback"
The card shows the fact plus "We couldn't fetch a new fact, so here's an earlier one."
```

### 5.6 Approaches considered and rejected
| Approach | Why not |
|---|---|
| In-memory lock (a `Map` in Node) | Only protects one process. Two serverless instances or two dev workers would both generate. |
| Transaction / `pg_advisory_xact_lock` held around the OpenAI call | Holds a pooled DB connection for up to 10 s per request; a burst could exhaust the pool and stall the whole app. |
| Unique constraint per 60 s bucket (`floor(epoch / 60)`) | Buckets don't match "< 60 s old": a fact at 12:00:59 and a request at 12:01:01 regenerate after 2 s. Also needs a placeholder row before calling OpenAI. |
| Lease row (chosen) | Atomic, works across processes, holds no connection during the API call, self-heals after crashes. Costs one table and two SQL statements. |

---

## 6. Authentication and security

### 6.1 Sessions
Auth.js with the Prisma adapter and `session: { strategy: "database" }`. The
cookie only holds a random session token; the user is looked up in the
`Session` table on each request. Sign-out deletes the row, so the session is
truly revoked (a JWT would stay valid until it expired).

### 6.2 Why no `middleware.ts`
Next.js middleware runs on the Edge runtime, where Prisma's normal client
can't run, so it can't read database sessions. Instead every protected page,
action and route calls `lib/auth.ts`:
- `getSessionUser()` → `auth()` → loads the full `User` row by session user ID, or `null`.
- `requireUser()` → `getSessionUser()` or `redirect("/")`.

Pages and actions use `requireUser()`; the API route uses `getSessionUser()`
so it can return 401 JSON instead of a redirect.

### 6.3 Authorization (users can't touch each other's data)
- No endpoint or action reads a user ID from the request. `GET /api/fact` takes no parameters; the onboarding action ignores everything except the `movie` field.
- `getFactForUser(userId, …)` receives the ID from the session and puts it in every `where`.
- So there is no way to *ask* for another user's data. Test R-3 proves it by sending `?userId=<other user>` and checking only the caller's fact comes back.

### 6.4 Missing Google name or photo
- `displayName(user)`: `name` → email before `@` → `"Movie fan"`.
- No `image` → a circle with `initials(displayName)`.
- Google photos are rendered with a plain `<img>` (with `referrerPolicy="no-referrer"`, which Google's image host needs), avoiding `next/image` domain configuration.

### 6.5 Secrets
- `lib/prisma.ts`, `lib/auth.ts`, `lib/openai.ts`, `lib/facts.ts` start with `import "server-only"`. Importing any of them from a client component fails the build.
- No environment variable uses the `NEXT_PUBLIC_` prefix, so none can be inlined into browser code.
- OpenAI error messages (which can include request details) are logged server-side only.

### 6.6 Input and output
- Movie title: trimmed, 1–100 characters, validated on the server with zod. The column is also `VARCHAR(100)`, so the database enforces the limit too.
- All text is rendered through React, which escapes it. `dangerouslySetInnerHTML` is never used.
- The movie title is sent to OpenAI only in the user message; instructions are in the system message. The length limit also limits cost and prompt-injection room. The worst outcome of a malicious title is an odd fact shown to the person who typed it.

### 6.7 CSRF
Server actions are protected by Next.js's built-in Origin header check.
Auth.js uses `state` and PKCE for the OAuth flow. `GET /api/fact` doesn't
change anything another site could exploit (it only returns data to the
signed-in user's own browser, and cross-origin reads are blocked by CORS).

---

## 7. Errors: where they start and how they reach the user

| Situation | Thrown / returned in | HTTP | `code` | What the user sees |
|---|---|---|---|---|
| No session on `/api/fact` | `app/api/fact/route.ts` | 401 | `UNAUTHENTICATED` | (Only reachable by calling the API directly; pages redirect first.) |
| No session on a page/action | `requireUser()` | redirect `/` | — | Landing page |
| No favorite movie | `OnboardingRequiredError` in `lib/facts.ts` | 409 | `ONBOARDING_REQUIRED` | (Pages redirect to onboarding first.) |
| Invalid movie title | `saveFavoriteMovie` returns `{ error }` | — | — | Message under the field, text kept |
| OpenAI fails, older fact exists | handled in `lib/facts.ts` | 200 | — | Fact + "showing an earlier fact" note |
| OpenAI fails, no fact (this request, or the lease holder it was waiting on) | `FactUnavailableError` | 503 | `FACT_UNAVAILABLE` | Friendly error + "Try again" |
| Another request generating, nothing to show | `GenerationInProgressError` | 503 | `GENERATION_IN_PROGRESS` | Friendly error + "Try again" |
| Anything else | route's catch-all | 500 | `INTERNAL` | "Something went wrong." |

`lib/errors.ts → toApiError(error)` is the one place mapping errors to
status codes and messages. Messages are fixed strings, never `error.message`.

---

## 8. Constants and configuration

| What | Value | Where to change |
|---|---|---|
| Cache window | 60 s | `CACHE_WINDOW_MS` in `lib/facts.ts` |
| Lease lifetime | 30 s | `LEASE_TTL_MS` in `lib/facts.ts` (passed into the lease SQL) |
| Waiter poll interval / max wait | 500 ms / 12 s | `WAIT_POLL_MS`, `WAIT_MAX_MS` in `lib/facts.ts` |
| OpenAI timeout / retries | 10 s / 0 | `lib/openai.ts` |
| OpenAI model | `gpt-4o-mini` | `OPENAI_MODEL` env var |
| Prompt and `max_tokens` | 150 | `lib/openai.ts` |
| Movie title length | 1–100 | `lib/validation.ts` **and** `@db.VarChar(100)` in the schema (change both, then migrate) |

Keep `LEASE_TTL_MS` > OpenAI timeout, and `WAIT_MAX_MS` > OpenAI timeout,
or the guarantees in §5 weaken.

Environment variables are listed in [README → Environment variables](../README.md#environment-variables).

---

## 9. Testing

### 9.1 How the test setup works
- `npm test` runs Vitest with `.env.test`, which points at `movie_memory_test`.
- `tests/global-setup.ts` runs `prisma migrate deploy` once (applies pending migrations, never drops data). `tests/setup.ts` truncates all tables before each test, so tests never see each other's data. Both refuse to run unless the URL contains `_test`.
- Why not `migrate reset`? It drops the whole database, which is more destructive than needed, and Prisma blocks it when run by an AI agent. `deploy` + `TRUNCATE` gives the same clean slate and is what CI would use.
- Test files run one at a time (`fileParallelism: false`) because they share one database.
- **OpenAI is never called.** Tests pass `fakeGenerator()` into `getFactForUser`. It counts calls and can be told to succeed, throw, or wait N ms.
- **Sessions:** route and action tests use `vi.mock("@/lib/auth")` so `getSessionUser()` returns a chosen test user or `null`. Everything after that — queries, lease, mapping — runs for real.
- **Time:** `insertFact({ ageMs: 59_000 })` sets `createdAt` in the past. No test waits for real time to pass.

### 9.2 What each file proves
| File | Proves |
|---|---|
| `tests/validation.test.ts` | Trimming, empty and length rules, exact messages. |
| `tests/display.test.ts` | Name and initials fallbacks. |
| `tests/facts.cache.test.ts` | 59 s → cached, 60 s → regenerated, no fact → generated, other movie's fact ignored. |
| `tests/facts.lock.test.ts` | 5 parallel requests → 1 OpenAI call and 1 row; expired lease is reclaimed; wrong token can't release; lease always released. |
| `tests/facts.failure.test.ts` | Fallback to older fact; 503 when none; nothing written on failure. |
| `tests/onboarding.test.ts` | Saves only for the session user; invalid input saves nothing; no overwrite after onboarding. |
| `tests/fact-route.test.ts` | 401, response shape, `no-store`, user A can't get user B's fact, 409 and 503 mapping without leaking internals. |

Not automated (manual checklist in README): the real Google consent screen,
and visual checks of the pages.

### 9.2a Proof the tests catch real bugs (mutation check)
Each of these deliberate bugs was introduced, the suite run, and the code restored:

| Bug introduced | Caught by |
|---|---|
| Cache compare `<` → `<=` (60 s counted as fresh) | I-3b |
| Lease `WHERE expiresAt < now()` → `WHERE true` (lease always takeable) | I-5, I-6b, I-8b, I-8c, I-8d |
| `userId` removed from the latest-fact query | I-4b, I-8, R-3 |

Two gaps were found and fixed this way: the original "exactly 60 s" DB test
couldn't hit the exact millisecond (fixed with I-3b, which pins the clock),
and R-3 originally used two different movies, so it couldn't detect a missing
user filter (fixed by giving both users the same movie).

### 9.3 Adding a test
1. Find the requirement ID in [SPEC.md](../SPEC.md) (add one if it's new behavior).
2. Put the test in the file for that area; start its name with the ID, e.g. `it("CACHE-2: returns a 59s-old fact without generating", …)`.
3. Add the test ID to SPEC §8 and §9.

---

## 10. Decision log

| # | Decision | Alternatives | Why |
|---|---|---|---|
| 1 | Variant A | Variant B | Backend logic is easier to prove correct with tests; the concurrency problem is the most interesting part of the brief; fewer UI states to get wrong. |
| 2 | Auth.js, database sessions | JWT sessions | Real logout (row deleted), current user data on each request. Cost: one DB read per request and no Edge middleware. |
| 3 | Auth checks in pages/routes, not middleware | `middleware.ts` | Middleware can't use Prisma (Edge runtime). One helper keeps checks consistent. |
| 4 | Movie as a column on `User` | `Movie` table | One value per user; no join needed. |
| 5 | Facts keyed by `(userId, movieTitle)` | Key by user only | Correct cache invalidation if the movie changes, for free. |
| 6 | Lease row for burst protection | In-memory, advisory lock, time bucket | See §5.6. |
| 7 | Waiters poll the DB | `LISTEN/NOTIFY`, SSE | Simplest thing that works; a few cheap indexed reads during a burst. |
| 8 | No OpenAI retries + stale fallback | SDK default (2 retries) | Bounded 10 s latency; the user still gets a fact. |
| 9 | Fact loaded by a client component via `/api/fact` | Server component with Suspense | Profile appears instantly; gives a real endpoint to test authorization against. |
| 10 | Real Postgres in tests | Mocked Prisma | A mock can't prove `ON CONFLICT` atomicity. |
| 11 | No E2E or component tests | Playwright, RTL | Time budget; Variant A is judged on backend correctness. Auth flow covered by a manual checklist. |
| 12 | Plain `<img>` for Google photos | `next/image` | Avoids remote-image config for one avatar. |
| 13 | Next.js 15, Prisma 6 (pinned majors) | Next 16, Prisma 7 | Auth.js v5 (beta) and Prisma 6 are a well-trodden pair; Prisma 7 requires driver adapters and a new config file. |
| 14 | Webpack dev server (`next dev`), not Turbopack | `next dev --turbopack` | Turbopack's generated file names exceeded Windows' 260-character path limit in a deeply nested folder. Webpack works everywhere. |
| 15 | `timestamptz` for `Fact.createdAt` and lease `expiresAt` | Prisma default `timestamp` | Absolute instants; immune to the DB session time zone (§4). |
| 16 | Tests: `migrate deploy` + `TRUNCATE` | `migrate reset` | Non-destructive, CI-style, and allowed when run by an agent (§9.1). |
| 17 | Waiters stop early if the lease disappears | Always wait 12 s | A failed generation shouldn't make other tabs hang for 12 s. |
| 18 | `postinstall: prisma generate` in package.json | Rely on `prisma migrate dev` to generate | A fresh clone + `npm install` otherwise crashes with "@prisma/client did not initialize yet" (seen after moving the project). |

---

## 11. Known limitations
- **Polling waiters** add a few DB reads during bursts and may give up just before a very slow generation finishes.
- **Crashed request** blocks new facts for that user for up to 30 s (lease TTL).
- **Expired lease rows are not deleted**, just overwritten on next use. Bounded at one row per user.
- **No rate limit.** A user can trigger one OpenAI call per minute indefinitely.
- **Facts may repeat**; the prompt doesn't include previous facts.
- **Movie can't be changed** after onboarding (out of scope; the data model supports it).
- **Generating on `GET`** isn't strictly side-effect free, though repeated calls in the window return the same result.
- **No automated browser tests**; Google sign-in is checked manually.
- **Real Google sign-in and real OpenAI calls have not been exercised yet** (no credentials in the build session). Everything around them is tested; run README checklist items 2–5 once with real credentials.

---

## 12. FAQ

**Where is the cache logic?** `lib/facts.ts`, `getFactForUser`. §5.1.

**What happens if I open five tabs at once?** One request gets the lease and
calls OpenAI; the other four wait and return the same fact. §5.5. Test I-5.

**What if the server crashes while generating?** The lease expires after 30 s
and the next request takes over. §5.5.

**What if OpenAI is down?** The user sees their most recent older fact with a
note, or a friendly error if they've never had one. §5.4.

**How do I change the cache window?** `CACHE_WINDOW_MS` in `lib/facts.ts`,
then update the tests that use 59 s / 60 s ages. §8.

**How is user A stopped from reading user B's facts?** The user ID only ever
comes from the session and is in every query. §6.3. Test R-3.

**Why isn't there a `middleware.ts`?** Prisma can't run on the Edge runtime.
§6.2.

**How does a first-time user get to onboarding?** `favoriteMovie` is null, and
`/` redirects on that. §3.2.

**Why do tests need Docker?** They use a real Postgres to prove the lease is
atomic. §9.1.

**How would I add "edit movie"?** Add a server action that validates with
`movieTitleSchema` and updates `favoriteMovie` for the session user (without
the first-time check). Facts need no change: the new title is a new cache key.

**Why `maxRetries: 0`?** §5.4.

---

## 13. Keeping this report accurate
- Any change to behavior, a file's role, a constant, or the schema updates the matching section here **in the same change**.
- Update the status note at the top when verification state changes (e.g. after the first real Google/OpenAI run).
- If this report and the code disagree, the code is right and this report is a bug.
