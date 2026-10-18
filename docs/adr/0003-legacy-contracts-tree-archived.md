# ADR 0003: Archive the legacy top-level `contracts/` tree

- Status: Accepted
- Related: #1552, #1571 (`Upgrade legacy contracts/ from soroban-sdk 21.7.7 or archive them`)

## Context

The repository grew two Soroban contract trees over time:

- **Canonical** — `backend/contracts/`, pinned to `soroban-sdk = "23.5.3"`,
  built and deployed to Testnet on every push to `main` by
  [`deploy-contracts.yml`](../../.github/workflows/deploy-contracts.yml).
  Six contracts (`bounty`, `escrow`, `freelancer`, `governance`, `oracle`,
  `identity`) are in the deploy pipeline; five more (`core`, `insurance`,
  `referral`, `stellar_insights`, `test-utils`) are workspace members not yet
  wired to the deploy pipeline.
- **Legacy** — top-level `contracts/` (`amm`, `analytics`, `core`, `escrow`,
  `vault`), pinned to `soroban-sdk = "21.7.7"`. Never built by any CI job,
  never in `backend/Cargo.toml`'s workspace. Deployed once, manually, to
  Testnet; the resulting addresses are recorded in the README.

Having two escrow contracts in the repo — `contracts/escrow` (legacy, live on
testnet) and `backend/contracts/escrow` (canonical, deployed by CI) — is a
recipe for an integrator wiring against the wrong one. The legacy tree was
also pinned to an SDK two majors behind the workspace's single pinned
version, so building it required a separate toolchain no one in the repo
maintained.

The decision recorded here was made and executed before this ADR was
written; the top-level `contracts/` directory no longer exists in `main`
(its source is preserved in git history at commit `734cff58`). This ADR
exists to record *why* that decision was taken, so a future contributor
reviving a legacy contract understands the reasoning and so the audit trail
of contract-related decisions stays in `docs/adr/`.

## Decision

**Archive the legacy top-level `contracts/` tree: remove it from `main`
rather than upgrade or dual-build it.**

Concretely:

1. Remove the top-level `contracts/` directory from `main`. Its source is
   preserved in git history at `734cff58`; reviving a contract means porting
   it into `backend/contracts/` against SDK 23, not restoring the old
   directory.
2. Keep the workspace (`backend/Cargo.toml`), the clippy script
   (`package.json` `smart-contract:clippy`), and the deploy pipeline
   (`deploy-contracts.yml`) pointing exclusively at `backend/contracts/*`.
   Never reintroduce a top-level `contracts/` crate.
3. Keep the legacy Testnet addresses in the README, but clearly labelled as
   historical — the contracts are still live on Testnet even though their
   source no longer lives in `main`. Nothing in the platform integrates
   against them.
4. Document the single-pinned-SDK policy in the README's "Tech Stack" table
   (`soroban-sdk = "23.5.3"`, one SDK version across the repo) so a second
   SDK pin would be obvious in review.

## Consequences

- One escrow contract in `main` (`backend/contracts/escrow`), eliminating
  the "which escrow do I wire against?" ambiguity.
- One Soroban SDK version across the workspace. A second SDK pin would now
  be a visible drift in `backend/Cargo.toml`.
- Reviving `amm`, `vault`, or `analytics` (which have no canonical
  equivalent) is a deliberate act: port the source from `734cff58` into
  `backend/contracts/`, update it to SDK 23, and add it to CI. It is not a
  `git revert` of the archive.
- The legacy Testnet addresses remain queryable on
  [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet) for
  anyone who interacted with them; nothing breaks for those callers, but
  no one in this repo will deploy fixes to them.

## Alternatives considered

- **Upgrade the legacy tree in place to SDK 23.** Rejected. The legacy
  tree was never in the workspace or CI, so "upgrade" would also mean
  wiring it into `backend/Cargo.toml`, the clippy script, and the deploy
  pipeline — and then maintaining two escrow contracts, two AMM/vault/analytics
  contracts with no canonical equivalent, and a second source of testnet
  addresses. The duplication this ADR exists to remove would persist.

- **Dual-build: keep the legacy tree as a separate, opt-in workspace.**
  Rejected. A tree that no CI job builds, no deploy pipeline deploys, and
  no platform code calls is, in practice, dead code that nonetheless costs
  reviewer attention and clippy time. The `stellar_insights` confusion
  tracked in [#1553](../issues/1553-stellar-insights-contract.md) is a
  preview of the same failure mode at a smaller scale.

- **Keep as reference, ungated.** Rejected. "Reference" code that isn't
  built drifts silently — types rename, SDK semantics shift, and the
  reference becomes a lie. Git history is a better reference: pinned to a
  commit, clearly labelled as historical, and not pretending to be
  runnable.

- **Tag a release and delete, no ADR.** Rejected. The decision is
  non-obvious (why remove working source rather than upgrade it?) and
  reversible only via git archaeology. Recording it in `docs/adr/` makes
  the reasoning auditable the next time someone asks "where did the
  AMM go?"
