# ADR 0004: Keep `stellar_insights`, rename to `reputation`, document it

- Status: Proposed
- Related: #1553, #1585

## Context

`backend/contracts/stellar_insights/` is a workspace member and is linted by
the `smart-contract:clippy` script, but it is not in the README's canonical
contracts list and its name (`stellar_insights`) reads like a different
project. [#1553](../issues/1553-stellar-insights-contract.md) asks us to
either explain or remove it.

Reading the source ([`backend/contracts/stellar_insights/src/lib.rs`](../../backend/contracts/stellar_insights/src/lib.rs)),
this is the platform's **creator reputation and review-integrity contract**.
It records 1–5 star reviews of creators, lets anyone stake a 10 XLM
`CHALLENGE_DEPOSIT` to flag a fake review, lets the admin uphold (remove the
review, return the deposit) or reject (restore the review, forfeit the
deposit to the admin), tracks creator reputation with a time-decay (3-month
grace period, then exponential decay at a governance-set rate), and lets
the admin attest epoch data hashes. Its `InsightsError` enum is already
documented in `docs/contracts.md`. It has a working test suite.

So the contract has a real purpose, real tests, and existing partial
documentation. Removing it would throw away a working reputation layer the
platform's review surfaces depend on; keeping it under a confusing name
keeps the audit-trail problem #1553 was filed about.

## Decision

**Keep the contract, rename the crate from `stellar_insights` to
`reputation`, and document it in the README and `docs/contracts.md`.**

Concretely:

1. Rename the directory `backend/contracts/stellar_insights/` →
   `backend/contracts/reputation/`.
2. Rename the crate in its `Cargo.toml`: `name = "stellar_insights"` →
   `name = "stellar-reputation-contract"` (matching the
   `stellar-*-contract` convention used by other canonical contracts).
3. Update `backend/Cargo.toml`'s workspace member and the `-p stellar_insights`
   reference in `package.json`'s `smart-contract:clippy` script.
4. **Leave the on-chain `#[contract] pub struct StellarInsights;` and the
   generated `StellarInsightsClient` type names unchanged.** The crate
   package name and the on-chain contract type name are independent; renaming
   the package is a Cargo concern, while renaming the type would touch
   storage `DataKey` derivation for any deployed instance. Since the
   contract isn't deployed by CI, there's no live instance to break, but
   leaving the type name stable keeps the option of deploying a previously
   built WASM without a storage migration.
5. Add the contract to the README's canonical contracts list with a
   one-line purpose: "creator reviews, review challenges with staked
   deposits, and time-decaying reputation scores".
6. Add a "Reputation contract" section to `docs/contracts.md` with the
   entrypoint summary and an events table, alongside the existing
   bounty/freelancer sections.

## Consequences

- The workspace no longer contains a crate named after an external project.
  A future contributor sees `reputation` and knows what it is.
- The on-chain identity of any deployed instance is unaffected (contract ID
  is the identity, not the crate name; storage layout is untouched because
  the Rust types don't move).
- `docs/contracts.md` becomes the one place to find every canonical
  contract's entrypoints, errors, and events — closing the "undocumented
  contract" gap that #1553 and #1554 both point at.
- The crate is still not in the deploy pipeline. Deploy inclusion is a
  separate decision (#1585) and is not implied by this rename.

## Alternatives considered

- **Remove the contract.** Rejected. It has a clear purpose (the on-chain
  half of the platform's review and reputation surfaces), a working test
  suite, and is already partially documented in `docs/contracts.md`.
  Removing it would discard a working reputation layer and break the
  platform's review-integrity story without replacing it.

- **Keep the name, just document it.** Rejected. Documentation alone
  doesn't fix the audit-trail problem: the next contributor scanning
  `backend/contracts/` still sees `stellar_insights` and still has to
  read the doc to learn it's the reputation contract. A name that says
  what the contract is does that work without a doc lookup.

- **Rename the on-chain type too (`StellarInsights` → `Reputation`).**
  Rejected. The on-chain type name is part of the contract's identity for
  storage key derivation; renaming it is a storage-migration concern
  orthogonal to the crate-package-name question. Leaving it stable keeps
  the rename small and the deploy-pipeline-inclusion option (#1585)
  unencumbered.

- **Move the contract out of `backend/contracts/` entirely.** Rejected.
  It's a Soroban contract in the canonical workspace; moving it elsewhere
  would re-create the exact "where does this contract live?" confusion
  this ADR is meant to remove.
