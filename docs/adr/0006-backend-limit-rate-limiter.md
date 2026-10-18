# ADR 0006: Remove `backend/limit` (standalone Node rate-limiter inside the Rust backend)

- Status: Proposed
- Related: #1555, #1556 (unify rate limiting across tRPC, GraphQL and REST), #1511 (unauthenticated `/api/search/vector`)

## Context

`backend/limit/` is a 15-file standalone Node.js / Express sub-project
inside the Rust `backend/` directory. Its own README
([`backend/limit/README.md`](../../backend/limit/README.md)) states it is
independent of "the root Next.js app and the Rust `backend/`" and that
"every command below (`npm install`, `npm test`, etc.) must be run from
inside `backend/limit/`". It implements sliding-window rate limiting,
API-key auth, input validation/sanitization, CORS, security headers,
request throttling, adaptive rate limiting, monitoring, and anomaly
detection — a complete "enterprise API security middleware" framework.

Tracing every reference to `backend/limit` outside its own directory:

| Reference | Treatment |
| --- | --- |
| Root `tsconfig.json` | **Excludes** `backend/limit/**` from the root TS project |
| `vitest.config.ts` | **Excludes** `backend/limit`'s ts-node tests from vitest |
| `.gitignore` | Ignores `backend/limit/.env` and `.env.*` |
| `backend/README.md` | Tree listing only (`# API rate-limiting middleware`) |
| `docs/MAINTENANCE_NOTES.md` | Historical note (Oct 2026 test-script fix) |
| `docs/issues/1556-unify-rate-limiting.md` | Calls it out as a separate impl |

It is **not** referenced by: the root `package.json` pnpm workspace, any
`app/api/` route, any tRPC procedure, any GraphQL resolver, any Dockerfile,
any Helm chart, any `deployments/` manifest, any CI workflow, or the Rust
`backend/Cargo.toml` workspace. It is not deployed, not imported, not
built by CI, and not in the pnpm workspace.

The platform already has two rate-limiter implementations in the Node
app — `server/api/rate-limit.ts` (token-bucket, tRPC + GraphQL) and
`lib/rate-limit.ts` (counter-per-hour, export endpoints) — and #1556 is
tracking unifying *those two* into a single Redis-backed limiter.
`backend/limit` is a **third**, independent implementation that #1556
mentions in passing but doesn't consolidate. It also duplicates the app's
auth (NextAuth), validation (Zod), and security-header (Next.js
middleware) layers.

## Decision

**Remove `backend/limit/` from `main`. Record the decision in this ADR.
Preserve the source in git history.**

Concretely:

1. `git rm -r backend/limit`. The package isn't in the pnpm workspace, so
   no `pnpm-lock.yaml` change is needed.
2. Remove the `backend/limit/**` exclusion from root `tsconfig.json` and
   the `backend/limit/.env*` entries from `.gitignore` (or leave them as
   defensive guards against accidental re-addition — removing is cleaner).
3. Remove `backend/README.md`'s tree-listing entry for `limit/`.
4. Remove the `backend/limit` reference sentence in
   `docs/issues/1556-unify-rate-limiting.md`. #1556's scope (unify the two
   app-side limiters) is unaffected.
5. Leave `docs/MAINTENANCE_NOTES.md`'s historical note as-is, or prefix
   it with "Removed — see ADR 0006". Either is fine; it's a maintenance
   log, not a live reference.

## Consequences

- One rate-limiting implementation path remains for the Node app: the
  `server/api/rate-limit.ts` + `lib/rate-limit.ts` pair that #1556
  unifies. `backend/limit` is no longer a third, un-wired option.
- `backend/` contains only Rust crates (the workspace) plus
  non-Node support dirs (`migrations/`, `grafana/`). A contributor opening
  `backend/` no longer finds a Node project with its own `node_modules`
  sitting next to the Cargo workspace.
- The framework's features (API-key auth, CORS, security headers, anomaly
  detection) are not lost to anyone who wanted them: the source is in git
  history, and the ADR records why it was removed. Anyone reviving it
  would re-add it deliberately, with a wiring plan (CI, deploy, app
  integration) rather than as a stray sub-project.
- #1556's unification scope becomes simpler: it consolidates two
  app-side limiters, not three, and no longer needs to mention an
  out-of-tree implementation that nothing imports.

## Alternatives considered

- **Keep as-is, just document.** Rejected. The package is already
  self-documenting (`backend/limit/README.md` is thorough) and the
  problem #1555 names isn't a lack of documentation — it's that an
  un-deployed, un-imported, duplicative Node package lives inside the
  Rust backend directory and duplicates three app layers. Documentation
  doesn't fix the location, the duplication, or the un-deployed status.

- **Keep and wire into CI.** Rejected. Wiring an unused Node package into
  CI would spend CI time on tests for a framework nothing imports, and
  would imply the package is a live component when it isn't. The right
  time to wire it in is when something actually uses it; nothing does.

- **Fold into #1556's unified limiter.** Rejected. #1556's plan is to
  unify the two app-side limiters behind a single Redis-backed
  `@upstash/ratelimit` (or `rate-limiter-flexible`) call. `backend/limit`
  is a separate Express framework with its own auth, validation, CORS,
  and monitoring stacks; folding it in would mean either porting its
  features into the app (where they'd duplicate NextAuth/Zod/Next.js
  middleware) or running it as a sidecar (which nothing deploys today).
  Either path is more work than removing a package nothing uses, and
  neither is in #1556's scope.

- **Keep as a reference for "enterprise API security" patterns.**
  Rejected. A live, un-wired, duplicative directory in `main` is not a
  useful reference — it's a maintenance liability that drifts as the
  app's own auth/validation/rate-limit layers evolve. Git history is a
  better reference: pinned to a commit, clearly labelled as removed by
  this ADR, and not pretending to be runnable against the current
  codebase.

- **Move it to a top-level `packages/` directory as a workspace package.**
  Rejected. That would address the "wrong location" problem but not the
  duplication or the un-deployed status. It would also pull a third
  rate-limiter into the pnpm workspace, complicating #1556's
  unification. If a future use case surfaces (e.g. a genuine sidecar
  middleware need), it can be revived with a wiring plan; today nothing
  uses it.
