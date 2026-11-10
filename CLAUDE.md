# Movie Memory — notes for Claude

## Answering questions about this repo
1. Start with `docs/REPORT.md`: file map (§2), flows (§3), data model (§4), Variant A internals (§5), security (§6), errors (§7), constants (§8), tests (§9), decision log (§10), FAQ (§12).
2. Use `SPEC.md` for exact requirements (IDs like `LOCK-2`) and the test list.
3. Confirm against the code before answering anything specific. If the report and the code disagree, the code wins: say so and fix the report.

## Working rules
- Spec-driven: behavior changes start in `SPEC.md` (requirement + test IDs), then code, then tests.
- Every test name starts with the requirement ID it verifies.
- Any change to behavior, a file's role, a constant or the schema updates `docs/REPORT.md` (and `README.md` if user-facing) in the same change.
- Scope is fixed to SPEC §1.1. Don't add features from SPEC §1.2 unless asked.
- User identity only ever comes from `lib/auth.ts` (`getSessionUser` / `requireUser`). Never accept a user ID from a request.

## Commands
- `docker compose up -d` — Postgres (dev + test DBs)
- `npm run dev` · `npm test` · `npm run typecheck` · `npm run lint`
- `npx prisma migrate dev` — after schema changes
