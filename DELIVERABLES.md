# Movie Memory — Submission Deliverables

| | |
|---|---|
| **Repository** | https://github.com/durgaclam-0401/movie-memory |
| **Variant** | **A — Backend-Focused (caching + correctness)** |
| **Stack** | TypeScript · Next.js 15 (App Router) · React 19 · TailwindCSS · PostgreSQL 16 · Prisma 6 · Auth.js v5 (Google) · OpenAI |
| **Tests** | 36 automated tests (Vitest, real Postgres) · typecheck and lint clean |

This file collects every requested deliverable in one place. The same
information, plus more depth, lives in [README.md](README.md),
[SPEC.md](SPEC.md) (requirements and test plan) and
[docs/REPORT.md](docs/REPORT.md) (full architecture report).

---

## 1. GitHub repository

**https://github.com/durgaclam-0401/movie-memory**

The history is organised as one pull request per feature, merged in order
with merge commits so each individual commit stays visible:

| PR | Feature |
|---|---|
| #1 | Requirements specification |
| #2 | Prisma schema and local Postgres |
| #3 | Google sign-in with database sessions |
| #4 | Favorite-movie onboarding with server-side validation (+ test setup) |
| #5 | Dashboard with Google profile and name/photo fallbacks |
| #6 | OpenAI fact generation and `GET /api/fact` |
| #7 | 60-second fact cache (Variant A) |
| #8 | Last-fact fallback when OpenAI fails (Variant A) |
| #9 | One fact generation per user at a time (Variant A) |
| #10 | README, architecture report and contributor notes |

---

## 2. README contents

### 2.1 Setup instructions

**Prerequisites:** Node.js 20+, Docker Desktop, a Google OAuth client, an OpenAI API key.

```bash
git clone https://github.com/durgaclam-0401/movie-memory.git
cd movie-memory
cp .env.example .env        # then fill in the values (section 2.2)
docker compose up -d        # Postgres 16 with movie_memory + movie_memory_test
npm install                 # also runs `prisma generate`
npx prisma migrate dev      # create the tables
npm run dev                 # http://localhost:3000
```

**Creating the Google OAuth client**
1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*.
2. Authorized JavaScript origin: `http://localhost:3000`
3. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
4. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
   If the consent screen is in *Testing* mode, add your Google account as a test user.

**Running the checks**
```bash
npm run typecheck
npm run lint
npm test                    # requires `docker compose up -d`
```

### 2.2 Required environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string, e.g. `postgresql://postgres:postgres@localhost:5432/movie_memory` |
| `AUTH_SECRET` | Yes | Auth.js signing secret. Generate with `npx auth secret` |
| `AUTH_GOOGLE_ID` | Yes | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Yes | Google OAuth client secret |
| `OPENAI_API_KEY` | Yes | OpenAI API key. Without it the app runs, but fact generation fails gracefully |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini` |
| `TEST_DATABASE_URL` | No | Overrides the test database (e.g. in CI). Must contain `_test` |

No variable uses the `NEXT_PUBLIC_` prefix, so none can be bundled into
browser code. `.env` is git-ignored; `.env.example` lists every variable, and
`.env.test` (committed, dummy values only) is used by the test suite.

### 2.3 Database migration steps

The schema is built up by three migrations in `prisma/migrations/`:
`init_users_and_auth`, `add_facts` and `add_fact_generation_lock`.

```bash
npx prisma migrate dev       # development: apply migrations (and create new ones after schema changes)
npx prisma migrate deploy    # CI / production: apply existing migrations only, never drops data
npx prisma studio            # optional: browse the data
```

The test suite runs `prisma migrate deploy` against the test database
automatically, and refuses to run unless the database name contains `_test`.

---

### 2.4 Architecture overview

#### System shape

```
Browser
  │
  ▼
app/  (Next.js App Router: pages, server actions, GET /api/fact)    HTTP + rendering only
  │   every request: lib/auth.ts → user from the session (or redirect / 401)
  ▼
lib/facts.ts   cache window · per-user lease · failure fallback        ← Variant A core
  │                       │
  ▼                       ▼
Prisma → PostgreSQL     lib/openai.ts → OpenAI API
```

The rule throughout the codebase: **`app/` handles HTTP and rendering;
`lib/` holds the business rules.** The fact service never sees a request
object and depends on a small `FactGenerator` interface rather than on
OpenAI directly, so it can be tested in isolation with a fake generator.

#### User flow

```
/  (logged out) ── Sign in with Google ──▶ Google ──▶ /
/  (logged in)  ── no favorite movie ──▶ /onboarding ── save ──▶ /dashboard
                └─ has favorite movie ─▶ /dashboard
/dashboard, /onboarding (logged out) ──▶ /
Log out ──▶ session row deleted ──▶ /
```

- **`/`** shows the landing page, or routes signed-in users by onboarding state.
- **`/onboarding`** is a single-field form handled by a server action. Validation runs on the server (trim, 1–100 characters). It is first-time only, and the database update is conditional on `favoriteMovie IS NULL`, so racing submissions can't overwrite each other.
- **`/dashboard`** renders the profile immediately: name, email and photo, with fallbacks for a missing name or photo. A client component then loads the fact from `GET /api/fact`, so the page never waits on OpenAI. It shows loading, fact, "showing an earlier fact" and error-with-retry states.

#### Authentication

Auth.js with the Google provider, the Prisma adapter and **database
sessions**. The cookie holds only a random token, and signing out deletes the
session row, so logout genuinely revokes access. Every page, server action
and route obtains the user through two helpers in `lib/auth.ts`:
`getSessionUser()` and `requireUser()`. There is no `middleware.ts`, because
Next.js middleware runs on the Edge runtime, where Prisma can't read
database sessions.

#### Data model

| Table | Purpose and design rationale |
|---|---|
| `User` | Google profile fields (any may be null) plus `favoriteMovie VARCHAR(100)`. A null movie *is* the "needs onboarding" signal, so no separate flag can drift out of sync. One favorite per user, so a column rather than a table. |
| `Fact` | `(userId, movieTitle, content, createdAt timestamptz)`. Each fact records the title it was generated for, so the cache key *(user, movie)* is one lookup on the index `(userId, movieTitle, createdAt DESC)`, and a changed movie naturally stops matching old facts. |
| `FactGenerationLock` | `(userId PK, token, expiresAt timestamptz)`. At most one "generation in progress" lease per user. Kept separate so coordination state never mixes with fact data. |
| `Account`, `Session`, `VerificationToken` | Standard Auth.js adapter tables. |

#### Fact generation (Variant A)

```
request ──▶ latest fact for (user, movie) < 60 s old? ──yes──▶ return it   (source: "cache")
                 │ no
                 ▼
          acquire lease (one atomic SQL upsert, 30 s TTL)
            │ acquired                          │ held by another request
            ▼                                   ▼
    re-check the cache                   poll every 500 ms (max 12 s) for the winner's fact
    call OpenAI (10 s timeout, no retries)  found      → return it
      success → store, return "fresh"       holder gave up / timed out
      failure → older fact ("stale-fallback")           → older fact, or a friendly 503
                or a friendly 503
    finally: release the lease (only if our token still owns it)
```

1. **60-second cache.** A fact strictly younger than 60 000 ms is returned without calling OpenAI. Exactly 60 s counts as expired. `createdAt` is written and compared with the same clock.
2. **Burst protection.** Acquiring the lease is a single statement: `INSERT … ON CONFLICT ("userId") DO UPDATE … WHERE "expiresAt" < now() RETURNING token`. Postgres serialises conflicts on the primary key, so exactly one concurrent request wins, across tabs and server instances. The lease expires after 30 s, so a crashed request can't block generation for long. Release deletes only when the random owner token matches. The winner re-checks the cache after acquiring the lease, which closes the race with a request that just finished.
3. **Failure handling.** OpenAI runs with a 10 s timeout and no SDK retries. On any failure (timeout, network error, error status, empty output, missing key), the user receives their most recent fact for that movie, marked as a fallback, or a friendly `503` if none exists. Failures never write a row. Provider errors are logged on the server only.

#### API contract: `GET /api/fact`

Takes no parameters. The user always comes from the session, and any query
string such as `?userId=` is ignored. Responses are `Cache-Control: no-store`.

| Status | Body |
|---|---|
| 200 | `{ fact: { content, movieTitle, createdAt }, source: "cache" \| "fresh" \| "stale-fallback" }` |
| 401 | `UNAUTHENTICATED`: no session |
| 409 | `ONBOARDING_REQUIRED`: no favorite movie yet |
| 503 | `FACT_UNAVAILABLE` or `GENERATION_IN_PROGRESS`: retryable |
| 500 | `INTERNAL`: generic message, no internal details |

#### Security

- **No endpoint or action accepts a user ID.** Identity comes only from the session, and every query on user data is filtered by it.
- **Secrets stay on the server.** Modules holding them (`prisma`, `auth`, `openai`, `facts`) import `server-only`, so importing them into client code fails the build.
- **Input is validated on the server** with zod and also bounded by the column type. React escapes all rendered text.
- **The movie title is sent to OpenAI only in the user message,** with instructions in the system prompt.
- **Error responses use fixed messages,** never stack traces, SQL or provider text.

#### Testing approach

- **Real database.** Tests run against a real Postgres test database, because a mock can't prove the lease is atomic.
- **No OpenAI calls.** A fake generator is injected that counts calls and can be slow or fail. Only the session lookup is mocked in route and action tests.
- **No sleeping.** Time is controlled by inserting facts with explicit ages, and the exact 60 s boundary is pinned with a fixed clock.
- **Key proofs:**
  - five parallel requests make **one** OpenAI call
  - user A requesting `?userId=<B>` never receives B's fact
  - failures fall back correctly and write nothing
- **Mutation-checked.** Deliberately breaking the 60 s comparison, the lease condition or the per-user filter each makes the suite fail.

---

### 2.5 Variant chosen and why

**Variant A — Backend-Focused (caching + correctness).**

- **It's provable.** The cache window, the concurrency guarantee and authorization are server logic, so fast, deterministic tests against a real database can prove them.
- **It's the most interesting problem in the brief.** Two tabs refreshing at once is exactly how duplicate OpenAI calls (and costs) happen. Preventing that correctly across multiple server instances needs real concurrency reasoning, not just UI work.
- **It fits the time budget.** Variant B adds optimistic updates, rollback and client cache invalidation: more UI states to get subtly wrong in a 3-hour build, for less depth.

### 2.6 Key tradeoffs

| Decision | Benefit | Cost |
|---|---|---|
| Database sessions instead of JWT | Real logout; user data always current | One DB read per request; auth can't run in Edge middleware |
| Lease row instead of an in-memory lock | Correct across instances and serverless; recovers from crashes via TTL | One extra table and two SQL statements |
| Lease instead of a DB lock held during the OpenAI call | No pooled connection held for up to 10 s per request | Waiting requests poll instead of being notified |
| Lease instead of a unique-per-60-second-bucket constraint | Matches "less than 60 seconds old" exactly | None: the bucket approach is simpler but wrong at bucket edges |
| No OpenAI retries, stale fallback instead | Bounded 10 s worst case; the user still sees a fact | A single transient error isn't retried |
| Fact loaded client-side via `/api/fact` | Profile renders instantly; a real endpoint to test authorization against | One extra round trip; needs loading and error states |
| Generating on `GET` | Matches the brief's `GET /api/fact`; repeat calls within the window return the same result | Not strictly side-effect free |
| Real Postgres in tests | Concurrency tests genuinely prove atomicity | Tests require Docker |
| Manual checklist instead of browser E2E tests | Time spent where Variant A is evaluated | Google sign-in isn't automated |
| No movie editing | Scope stays on Variant A | Users can't change their movie (the data model already supports it) |

### 2.7 What I would improve with 2 more hours

1. **Edit favorite movie** inline on the dashboard. Facts are already keyed by movie title, so the cache invalidates itself.
2. **Playwright end-to-end tests** for sign-in, onboarding and logout, using a seeded session cookie to bypass Google.
3. **Per-user rate limit** on new fact generation to cap OpenAI spend.
4. **CI pipeline** (GitHub Actions with a Postgres service) running typecheck, lint and tests on every pull request.
5. **Notify waiting requests** with Postgres `LISTEN/NOTIFY` instead of polling.
6. **Avoid repeated facts** by including the user's last few facts in the prompt.

---

## 3. AI usage

- Used **Claude Code** (Anthropic) as an AI pair programmer throughout. The AI generated most of the code, tests and documentation; I directed the work, made or approved the key decisions, and reviewed the results.
- **Requirements first.** Turned the assignment brief into a requirements spec ([SPEC.md](SPEC.md)) with requirement IDs and a test plan, then had the AI cut it down to a 3–4 hour scope.
- **Design decisions.** Compared burst-protection approaches (in-memory lock, advisory lock, time-bucket constraint, lease row) and chose the database lease row for correctness across server instances.
- **Implementation.** Generated the Next.js, Auth.js, Prisma and OpenAI code and the Vitest suite. Every step was typechecked, linted and tested.
- **Verifying the tests.** Ran a mutation check: deliberately breaking the cache boundary, the lease and the per-user query filter confirmed the tests catch each bug. This exposed two weak tests, which were fixed.
- **Manual check.** Tested the flows in a browser: landing, redirects, onboarding validation, dashboard fallbacks, error state and logout.
- **Repository history.** After the app was built and verified, the AI reorganised the work into one pull request per feature, so the history reads in a logical order. Commits carry a `Co-Authored-By: Claude` trailer.
- **Documentation.** Generated the README and the architecture report ([docs/REPORT.md](docs/REPORT.md)), which I use to understand and explain every part of the codebase.
