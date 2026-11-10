# Movie Memory

> **Status:** implemented and tested (36 tests passing; typecheck, lint and build
> clean). Remaining before submission: run the manual checklist once with real
> Google and OpenAI credentials, then delete this note.

Sign in with Google, tell us your favorite movie, and get a fun fact about it
from OpenAI. Facts are cached for 60 seconds, only one OpenAI call per user
can run at a time, and if OpenAI fails you get your last fact instead of an
error.

**Variant chosen: A — Backend-Focused (caching + correctness).**

| Document | Read it for |
|---|---|
| [SPEC.md](SPEC.md) | Requirements with IDs, API contract, test plan |
| [docs/REPORT.md](docs/REPORT.md) | How every file, flow and decision works, in depth |
| This README | Setup, overview, tradeoffs |

> **Understanding this codebase:** [docs/REPORT.md](docs/REPORT.md) is the
> primary reference for this project, for both human contributors and AI
> coding assistants. It contains a file-by-file map, step-by-step request
> flows, the reasoning behind the data model, a detailed walkthrough of the
> caching and concurrency design, a decision log and an FAQ. Start there
> before reading or changing the code. The report is kept in sync with the
> code; where the two disagree, the code is authoritative.

---

## Quick start

Prerequisites: Node.js 20+, Docker Desktop, a Google OAuth client, an OpenAI API key.

```bash
git clone <repo-url> movie-memory && cd movie-memory
cp .env.example .env        # fill in the values below
docker compose up -d        # Postgres with movie_memory + movie_memory_test
npm install
npx prisma migrate dev      # create tables
npm run dev                 # http://localhost:3000
```

### Creating the Google OAuth client
1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*.
2. Authorized JavaScript origin: `http://localhost:3000`
3. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
4. Put the client ID and secret in `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. If the consent screen is in *Testing* mode, add your Google account as a test user.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://postgres:postgres@localhost:5432/movie_memory` |
| `AUTH_SECRET` | yes | Generate with `npx auth secret` |
| `AUTH_GOOGLE_ID` | yes | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | yes | Google OAuth client secret |
| `OPENAI_API_KEY` | yes | Without it the app runs, but fact generation fails gracefully |
| `OPENAI_MODEL` | no | Defaults to `gpt-4o-mini` |

None use the `NEXT_PUBLIC_` prefix, so none can end up in browser code.
Tests use `.env.test` (committed, dummy values only).

## Database migrations

```bash
npx prisma migrate dev       # development: apply + create migrations
npx prisma migrate deploy    # CI / production: apply existing migrations
npx prisma studio            # browse data
```

## Tests

```bash
npm run typecheck
npm run lint
npm test                     # needs `docker compose up -d`
```

Tests run against a real Postgres test database (a mock can't prove the
locking is atomic) and never call OpenAI; a fake generator is passed in
instead. Each test name starts with the requirement ID it checks.

The test run applies migrations to `movie_memory_test` with `prisma migrate
deploy` and empties the tables before each test. It refuses to run if
`DATABASE_URL` doesn't point at a `_test` database, so it can't touch dev data.
To use a different test database (for example in CI), set `TEST_DATABASE_URL`.

The tests were mutation-checked: deliberately breaking the 60 s boundary,
the lease, or the per-user query filter each makes the suite fail
([REPORT §9.2a](docs/REPORT.md#92a-proof-the-tests-catch-real-bugs-mutation-check)).

| File | Covers |
|---|---|
| `tests/validation.test.ts` | Movie title trimming and length rules |
| `tests/display.test.ts` | Fallbacks for missing name and photo |
| `tests/facts.cache.test.ts` | 59 s → cached, exactly 60 s → regenerated, other movie ignored |
| `tests/facts.lock.test.ts` | 5 parallel requests → 1 OpenAI call; expired leases reclaimed; leases always released |
| `tests/facts.failure.test.ts` | OpenAI failure → older fact or friendly 503; nothing written |
| `tests/onboarding.test.ts` | Saves only for the signed-in user; no overwrite after onboarding |
| `tests/fact-route.test.ts` | 401 when logged out; **user A can't get user B's facts**; 409/503/500 don't leak internals |

### Manual checklist (Google sign-in can't be automated reliably)
1. Logged out: `/` shows "Sign in with Google"; `/dashboard` redirects to `/`.
2. Sign in with a new Google account → onboarding → dashboard shows your name, email, photo and movie.
3. Log out, sign in again → straight to the dashboard.
4. Reload within 60 s → same fact. Wait 60 s and reload → new fact.
5. In browser devtools, no API key or secret appears in network responses or JS.

---

## Architecture overview

```
Browser ──▶ app/ (pages, server actions, /api/fact)   HTTP + rendering only
               │  every request: lib/auth.ts → user from session (or redirect / 401)
               ▼
            lib/facts.ts        cache window, lease, fallback   ← Variant A
               │         │
               ▼         ▼
          Prisma/Postgres   lib/openai.ts → OpenAI API
```

**Pages.**
- `/` shows the landing page, or redirects signed-in users: no favorite movie → `/onboarding`, otherwise → `/dashboard`.
- `/onboarding` is a one-field form handled by a server action.
- `/dashboard` renders the profile immediately. A small client component then fetches the fact from `GET /api/fact`, so the page never waits on OpenAI.

**Authentication.** Auth.js with Google and the Prisma adapter, using
database sessions so logout really revokes the session. Checks happen in
pages, actions and the API route through two helpers, `getSessionUser()` and
`requireUser()`. There's no `middleware.ts`, because middleware runs on the
Edge runtime where Prisma can't read sessions.

**Data model.**
- `User.favoriteMovie`: a nullable column. Null means "not onboarded yet", so there's no separate flag to get out of sync.
- `Fact (userId, movieTitle, content, createdAt)`: each fact remembers which movie it was for. The cache key is user + movie, so a different movie never reuses an old fact. An index on `(userId, movieTitle, createdAt DESC)` makes "latest fact" a single lookup.
- `FactGenerationLock (userId PK, token, expiresAt)`: at most one "generation in progress" lease per user.

**Fact generation.**
1. If the latest fact for this user and movie is under 60 seconds old, return it.
2. Otherwise try to take the lease with one atomic SQL statement (`INSERT … ON CONFLICT DO UPDATE … WHERE expired`). Only one concurrent request gets it, across any number of tabs or server instances.
3. The winner re-checks the cache, calls OpenAI (10 s timeout, no retries), stores the fact, and releases the lease. Release checks a random token, so it can never delete someone else's lease.
4. Requests that didn't get the lease poll briefly for the winner's fact, and stop early if the winner gives up.
5. If OpenAI fails, the user gets their most recent older fact, or a friendly error if there isn't one.
6. A lease left behind by a crash expires after 30 seconds.

**Security.**
- The acting user always comes from the session; no endpoint accepts a user ID.
- Every query is filtered by that user.
- Secret-holding modules are marked `server-only`.
- Error responses use fixed messages, never internal details.

Full detail, timelines and the reasoning behind each choice:
[docs/REPORT.md](docs/REPORT.md).

---

## Why Variant A
- **Easy to prove correct.** The cache window, concurrency and authorization are all server logic, so fast tests against a real database can prove them.
- **The interesting problem.** Two tabs refreshing at once is how duplicate OpenAI calls (and costs) happen, and solving it correctly across server instances is the most interesting engineering in the brief.
- **Fits the time budget.** It has fewer UI states to get subtly wrong than Variant B's optimistic updates and client cache invalidation.

## Key tradeoffs

| Decision | Gain | Cost |
|---|---|---|
| Database sessions instead of JWT | Real logout; current user data | One DB read per request; no Edge middleware |
| Lease row instead of an in-memory lock | Works across instances; recovers from crashes | One extra table, two SQL statements |
| Lease instead of a DB lock held during the OpenAI call | No connection held for up to 10 s | Waiters poll instead of being notified |
| Lease instead of a "unique per 60 s bucket" constraint | Matches "less than 60 s old" exactly | — (buckets are wrong at the edges) |
| No OpenAI retries, stale fallback instead | Worst case 10 s; user still sees a fact | A single transient error isn't retried |
| Fact fetched by the client from `/api/fact` | Profile shows instantly; endpoint to test auth against | Extra round trip; loading/error states |
| Real Postgres in tests | Concurrency tests actually prove something | Tests need Docker |
| Manual checklist instead of browser tests | Time spent where Variant A is judged | Google sign-in isn't automated |

## With 2 more hours
1. **Edit favorite movie** on the dashboard. The data model already supports it, because facts are keyed by movie.
2. **Playwright tests** for the auth and onboarding flows, using a seeded session cookie to skip Google.
3. **Per-user rate limit** on new facts to cap OpenAI spend.
4. **CI** (GitHub Actions + Postgres service) running typecheck, lint and tests.
5. **Notify waiting requests** with Postgres `LISTEN/NOTIFY` instead of polling.
6. **Avoid repeated facts** by including the last few facts in the prompt.

## AI usage
- Used Claude to turn the brief into a requirements spec with IDs and a test plan, and to compare burst-protection approaches before choosing the lease row.
- Used AI help to scaffold boilerplate (Auth.js config, Prisma schema, Tailwind markup) and to draft tests from the spec.
- Reviewed and ran all generated code; checked the cache boundary, lease SQL and authorization tests by hand against the spec.
