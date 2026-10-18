# ADR 0005: Keep the `insurance` contract, wire it into CI, document it

- Status: Proposed
- Related: #1554, #1585

## Context

`backend/contracts/insurance/` is a workspace member
([`backend/Cargo.toml`](../../backend/Cargo.toml) lists `contracts/insurance`)
but sits in a half-wired state:

- **In** `backend/Cargo.toml`'s workspace (so `cargo build --workspace`
  and the workspace-level `cargo clippy` cover it).
- **Out** of `package.json`'s `smart-contract:clippy` script (so the
  contract-specific clippy gate run by `cli-checks.yml` silently skips it).
- **Out** of `deploy-contracts.yml`'s build/deploy step (never deployed
  by CI).
- **In** `backend/README.md`'s tree listing (as `# Insurance contract`),
  but with no purpose.
- **Out** of the top-level README's canonical contracts list and
  **out** of `docs/contracts.md` (no error-code or event table).

[#1554](../issues/1554-insurance-contract.md) calls this out as the
"undocumented contract that may hold funds" failure mode: a contract
designed to custody a token pool is in the workspace, compiles, and has
tests, but isn't linted by the contract-specific gate, isn't deployed,
and isn't in the error/event catalogue the indexer would map against.

The contract itself, reading
[`backend/contracts/insurance/src/lib.rs`](../../backend/contracts/insurance/src/lib.rs),
is a governance-gated insurance pool: a 0.1 % levy (10 bps) on every
platform fee collected by the escrow contract, paid into a per-token pool,
with claims submitted by users, approved by governance after a 3-day
voting window, and paid out by an admin. Its rustdoc gives the design
diagram, storage layout, and invariants; it has a working test suite.

## Decision

**Keep the contract, wire it into the contract-specific clippy gate, and
document it in the README and `docs/contracts.md`.**

Concretely:

1. Add `-p stellar-insurance-contract` to the `smart-contract:clippy`
   script in `package.json`. This is the gap that lets the
   contract-specific clippy job silently skip the crate today.
2. Add `insurance` to the README's canonical contracts list with a
   one-line purpose: "0.1 % levy on platform fees into a governance-gated
   pool that pays verified claims".
3. Add an `InsuranceError` error-codes table and an insurance events table
   to `docs/contracts.md`, so the indexer can map `("ins", *)` event
   topics and the backend can map failure codes. The codes are
   append-only (per the `docs/contracts.md` "Error codes" note: never
   renumber an existing variant, only append).
4. Surface the escrow-side dependency: the rustdoc's design diagram has
   `escrow::release_funds()` calling `insurance::contribute_to_pool()`.
   Confirm that call exists in `backend/contracts/escrow/src/lib.rs`; if
   it doesn't, file a follow-up issue rather than leaving the insurance
   pool to silently read zero when deployed.

## Consequences

- `pnpm run smart-contract:clippy` (and the `cli-checks.yml` job that calls
  it) covers every workspace contract crate, closing the gap #1554 names.
- `docs/contracts.md` becomes a complete catalogue of canonical contract
  errors and events; the indexer and backend can map against one file.
- The contract is still not deployed. Deploy inclusion is a separate
  decision (#1585) and is not implied by this ADR — wiring into clippy is
  about review coverage, not deployment.
- The escrow-side contribution call becomes a visible dependency: either
  it's confirmed present (and the insurance pool will accrue when both
  contracts are deployed) or it's a tracked follow-up (and the insurance
  pool would read zero until that follow-up lands).

## Alternatives considered

- **Remove the contract.** Rejected. It has a clear purpose (a
  governance-gated safety-net pool), comprehensive rustdoc, a working
  test suite, and is designed to integrate with the escrow contract's fee
  collection. Removing it would discard a working safety-net layer the
  platform's fee model is meant to fund, without replacing it. The
  problem #1554 identifies is that it's undocumented and not linted, not
  that it's unwanted.

- **Keep as-is, just document.** Rejected. Documentation without wiring
  the crate into the contract-specific clippy gate leaves the next
  contributor in the same state as today: a contract that compiles under
  the workspace-level clippy but is silently skipped by the
  contract-specific gate that `cli-checks.yml` actually runs. The clippy
  gap is the part #1554 explicitly calls out ("CI covers every contract
  crate" is in its acceptance criteria).

- **Deploy the contract now.** Rejected for this ADR. Deployment is a
  separate decision (#1585) that should weigh the escrow-side integration
  state and the contract's production readiness. Wiring into clippy and
  documenting it are necessary regardless of the deploy decision, so they
  go first.

- **Rename the crate.** Rejected. Unlike `stellar_insights` (ADR 0004),
  the `insurance` crate's name already says what it is; the problem is
  documentation and CI coverage, not the name.
