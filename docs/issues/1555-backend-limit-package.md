# #1555: Clarify or remove `backend/limit` (standalone Node package inside the Rust backend)

Related ADR: [`docs/adr/0006-backend-limit-rate-limiter.md`](../adr/0006-backend-limit-rate-limiter.md)
Related issues: [#1511](https://github.com/yosemite01/stellar-creator-portfolio/issues/1511) (unauthenticated `/api/search/vector` lets anyone spend our OpenAI quota), [#1556](1556-unify-rate-limiting.md) (unify rate limiting across tRPC, GraphQL and REST)

## Context

`backend/limit/` is a **standalone Node.js / Express sub-project** living
inside the Rust `backend/` directory. It has its own `package.json`,
`tsconfig.json`, `index.ts`, routes, middleware, and a hand-rolled test
runner (not vitest/Jest). Its own README
([`backend/limit/README.md`](../../backend/limit/README.md)) is explicit
about this:

> **This is a standalone sub-project** (its own `package.json`/`tsconfig.json`,
> independent of the root Next.js app and the Rust `backend/`) — every
> command below (`npm install`, `npm test`, etc.) must be run from inside
> `backend/limit/`, not the repo root.

What it is: an "enterprise-grade API security middleware" framework —
sliding-window rate limiting, API-key auth, input validation/sanitization,
CORS, security headers, request throttling, adaptive rate limiting,
real-time metrics, anomaly detection, structured logging.

Files (15):

```
backend/limit/
├── app/api/middleware.ts        # createSecureApp entry point
├── index.ts
├── lib/
│   ├── api-monitoring.ts        # logging + monitoring
│   └── security.ts              # auth, validation, CORS, headers
├── middleware/
│   └── rate-limit.ts            # RateLimiter class
├── routes/
│   └── estimate.ts
├── tests/
│   ├── runner.ts                # hand-rolled test runner
│   ├── unit/rate-limit.test.ts
│   ├── integration/security.test.ts
│   └── e2e/api-abuse.test.ts
├── setup.sh
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## How it's wired (or isn't)

Tracing every reference to `backend/limit` outside its own directory:

| Reference | What it does |
| --- | --- |
| `tsconfig.json` (root) line 41 | **Excludes** `backend/limit/**` from the root TS project |
| `vitest.config.ts` line 16 | **Excludes** `backend/limit`'s ts-node tests from vitest |
| `.gitignore` lines 19–20 | Ignores `backend/limit/.env` and `.env.*` |
| `backend/README.md` line 28 | Tree listing: `# API rate-limiting middleware (see backend/limit/README.md)` |
| `docs/MAINTENANCE_NOTES.md` | Notes that `backend/limit` test scripts were fixed (Oct 2026) |
| `docs/issues/1556-unify-rate-limiting.md` | Calls it out as a separate rate-limiter impl |

There is **no** reference to `backend/limit` from:

- The root `package.json` pnpm workspace or `pnpm-lock.yaml` (it's not a
  workspace package; it's not installed by `pnpm install`).
- Any `app/api/` route handler, tRPC procedure, or GraphQL resolver.
- Any Dockerfile, Helm chart, or `deployments/` manifest.
- Any CI workflow (`.github/workflows/*`).
- The Rust `backend/` workspace (it's not a Cargo crate; it's a Node
  project inside the directory that also holds the Rust workspace).

So `backend/limit` is not deployed, not imported by the app, not built by
CI, not in the pnpm workspace, and not in any Docker/Helm deploy artifact.
Its tests run only if someone `cd backend/limit && npm install && npm test`
manually.

## Duplication with the app's rate limiters

The platform already has two rate-limiter implementations in the Node/Next.js
app, and [#1556](1556-unify-rate-limiting.md) is already tracking unifying
*those two*:

| File | Algorithm | Scope |
| --- | --- | --- |
| [`server/api/rate-limit.ts`](../../server/api/rate-limit.ts) | Token-bucket with per-identifier tiers (anonymous 30/min, authenticated 300/min) | tRPC (every procedure via `rateLimit()` middleware) and GraphQL context |
| [`lib/rate-limit.ts`](../../lib/rate-limit.ts) | Counter-per-hour (3 exports/hour per admin) | Export endpoints only |

`backend/limit` is a **third**, independent implementation — sliding-window,
in-memory, with its own API-key auth, CORS, security headers, and monitoring
stack that the app doesn't use. It duplicates not just the rate-limiting
but also auth (NextAuth.js is the app's auth), input validation (Zod is the
app's), and security headers (Next.js middleware + Vercel config).

#1556's analysis explicitly says the goal is "one rate limiting
implementation for the Node app". Leaving `backend/limit` in the repo keeps
a third implementation that #1556 doesn't even cover.

## Why it matters

- **Wrong location.** A Node/Express package inside the Rust `backend/`
  directory is confusing — a contributor opening `backend/` expects Rust
  crates (the workspace), not an unrelated Node project with its own
  `node_modules`.
- **Not deployed.** No code path, Docker image, Helm chart, or CI job
  references it. If it were ever intended as a sidecar or middleware layer,
  nothing wires it up.
- **Duplicates three app layers.** Rate limiting (two impls already in the
  app, with #1556 tracking unification), auth (NextAuth), validation
  (Zod), security headers (Next.js middleware). A third copy of each is
  a maintenance liability.
- **Out of the pnpm workspace.** It runs on `npm install`, not
  `pnpm install`, so it doesn't share the lockfile, doesn't get
  renovate/dependabot updates with the rest of the monorepo, and doesn't
  pick up the repo's pinned Node version story.
- **Cited as a reference by #1556 but isn't actually in the unification
  plan.** That's the worst state: a third implementation that the
  unification issue mentions in passing but doesn't consolidate, leaving
  a permanent outlier.

## Proposed implementation

The package isn't deployed, isn't imported, and duplicates three app
layers. The right answer is **remove it**, with the decision recorded in
ADR 0006.

### Step 1 — Record the decision

Merge [`docs/adr/0006-backend-limit-rate-limiter.md`](../adr/0006-backend-limit-rate-limiter.md)
(Status: Proposed → Accepted once the removal lands). It captures the
alternatives considered (keep as reference, keep and wire into CI, fold
into #1556's unified limiter) and why each was rejected.

### Step 2 — Remove the directory

```bash
git rm -r backend/limit
```

The package isn't in the pnpm workspace, so no `pnpm-lock.yaml` change is
needed. No `tsconfig.json` change beyond removing the `backend/limit/**`
exclusion (line 41 of root `tsconfig.json`) — though leaving the exclusion
is harmless and slightly defensive against accidental re-addition; remove
it for cleanliness.

### Step 3 — Update references

- `backend/README.md` line 28: remove the `limit/` tree entry and its
  "API rate-limiting middleware" caption.
- `docs/MAINTENANCE_NOTES.md`: leave the existing "backend/limit: test
  scripts fixed" note as a historical record (it accurately describes
  work done in October 2026), or prefix it with "Removed — see ADR 0006"
  for clarity. Either is fine; the note is a maintenance log, not a
  live reference.
- `docs/issues/1556-unify-rate-limiting.md` line 14: remove the sentence
  referencing `backend/limit` as a separate module, since it no longer
  exists. #1556's scope (unify the two app-side limiters) is unaffected.
- `.gitignore` lines 19–20: remove the `backend/limit/.env` entries.

### Step 4 — Verify no stale references

Grep for `backend/limit` after removal. Known intentional references to
keep: this issue doc, ADR 0006, and the historical
`docs/MAINTENANCE_NOTES.md` note (if kept). Any other reference is a stale
leftover.

## Acceptance criteria

- [ ] ADR 0006 merged in `docs/adr/`
- [ ] `backend/limit/` directory removed from `main`
- [ ] `backend/README.md` tree listing no longer mentions `limit/`
- [ ] `docs/issues/1556-unify-rate-limiting.md` no longer references
      `backend/limit`
- [ ] `.gitignore` and root `tsconfig.json` no longer carry
      `backend/limit` exclusions
- [ ] One rate limiting implementation path for the Node app (the
      `server/api/rate-limit.ts` + `lib/rate-limit.ts` pair that #1556
      unifies; `backend/limit` is no longer a third option)
- [ ] CI is green (lint, type-check, tests)
- [ ] No new TODOs without a linked issue

## Out of scope

- Unifying the two app-side rate limiters. That's #1556's scope; this
  issue only removes the third implementation that's not in the app.
- Any change to the Rust backend's own rate limiting (the Actix middleware
  in `backend/services/`). That's independent of `backend/limit`.
- Preserving `backend/limit` as a reference. Git history preserves it
  permanently; an ADR records why it was removed. A live, un-wired,
  duplicative directory in `main` is not a useful reference — it's a
  liability.
