# #1554: Document the `insurance` contract or remove it

Related ADR: [`docs/adr/0005-insurance-contract-status.md`](../adr/0005-insurance-contract-status.md)
Related issues: [#1585](https://github.com/yosemite01/stellar-creator-portfolio/issues/1585) (add contract tests to CI for every canonical contract crate)

## Context

`backend/contracts/insurance/` is a workspace member
([`backend/Cargo.toml`](../../backend/Cargo.toml) lists
`contracts/insurance`) but is **not** in the clippy script and **not** in
the `deploy-contracts.yml` build/deploy pipeline. It is mentioned in
[`backend/README.md`](../../backend/README.md)'s tree listing as
`# Insurance contract`, but with no purpose documentation. It is not in
the top-level README's canonical contracts list and not in
[`docs/contracts.md`](../contracts.md) — neither its error codes nor its
events are recorded there.

The contract itself, though, is well-documented in its own rustdoc —
[`backend/contracts/insurance/src/lib.rs`](../../backend/contracts/insurance/src/lib.rs)
opens with a module-level comment giving the design diagram, storage
layout, and invariants. So the situation is: a reviewed, documented
contract that simply isn't wired into the repo's contract catalogue.

## What the contract does

Per the rustdoc and source, this is the platform's **insurance pool**.
It accumulates a 0.1 % levy (10 bps) of every platform fee collected by the
escrow contract into a per-token pool, and pays out verified claims approved
by governance.

```text
escrow::release_funds()
  └─ calls insurance::contribute_to_pool(fee * 0.001, token)

user              → insurance::submit_claim(amount, evidence)
governance vote   → insurance::approve_claim(claim_id)    (3-day window)
governance/admin  → insurance::execute_payout(claim_id)
```

Surface area:

| Entrypoint | Purpose | Auth |
| --- | --- | --- |
| `initialize(admin)` | One-shot setup; stores governance multisig as admin | admin `require_auth` |
| `contribute_to_pool(from, amount, token)` | Deposit tokens into the pool (called by escrow on fee collection) | `from` `require_auth`; pulls token |
| `get_pool_balance(token)` | Read pool balance for a token | read-only |
| `submit_claim(claimant, amount, token, evidence)` | Create a `Pending` claim; returns new claim ID | claimant `require_auth` |
| `approve_claim(admin, claim_id)` | Governance approves a claim after the 3-day voting window has elapsed | admin `require_auth` |
| `reject_claim(admin, claim_id)` | Governance rejects a pending claim | admin `require_auth` |
| `execute_payout(admin, claim_id)` | Pay an approved claim from the pool; mark `Executed` | admin `require_auth`; pushes token |
| `get_claim(claim_id)` | Read a claim record | read-only |

Storage keys: `DataKey::{PoolBalance(Address), Claim(u64), ClaimCounter,
Admin}`, all `env.storage().persistent()`.

Constants:

| Constant | Value | Meaning |
| --- | --- | --- |
| `INSURANCE_BPS` | 10 | 0.1 % levy (10 basis points) on platform fees |
| `CLAIM_VOTING_PERIOD_SECS` | 3 × 24 × 60 × 60 | 3-day governance voting window |

Error codes (`InsuranceError`, currently **not** in `docs/contracts.md`):

| Code | Variant | Meaning |
| --- | --- | --- |
| 1 | `NotInitialized` | Call before `initialize` |
| 2 | `AlreadyInitialized` | `initialize` called twice |
| 3 | `Unauthorized` | Caller is not the stored admin |
| 4 | `ClaimNotFound` | No claim with that id |
| 5 | `ClaimNotApproved` | `execute_payout` on a non-`Approved` claim |
| 6 | `ClaimAlreadyExecuted` | `execute_payout` on an `Executed` claim |
| 7 | `InsufficientPoolBalance` | Payout would exceed the pool balance |
| 8 | `InvalidAmount` | Amount ≤ 0 |
| 9 | `VotingPeriodNotEnded` | `approve_claim` before `voting_deadline` |
| 10 | `ClaimAlreadyApproved` | Claim is not in `Pending` status |

Events (currently **not** in `docs/contracts.md`):

| Transition | Topics | Data |
| --- | --- | --- |
| Pool contribution | `("ins", "contrib")` | `(from, token, amount)` |
| Claim submitted | `("ins", "claim")` | `(id, claimant, token, amount)` |
| Claim approved | `("ins", "approved")` | `claim_id` |
| Claim rejected | `("ins", "rejected")` | `claim_id` |
| Payout executed | `("ins", "payout")` | `(claim_id, claimant, token, amount)` |

It has a real test suite (`#[cfg(test)] mod tests` covers initialization,
double-initialize panic, unknown-token balance, claim counter increment,
initial `Pending` status, approve-before-deadline panic, approve-after-deadline,
reject, payout-on-pending panic, zero-amount panic, non-admin approval
rejection, and the `INSURANCE_BPS` constant arithmetic).

## Why it matters

An undocumented contract that may hold funds is exactly the kind of thing
that should either be reviewed into the light or removed. Right now
`insurance` is in the worst middle state: it's in the workspace (so
`cargo build --workspace` compiles it) and in `backend/README.md`'s tree
(so a contributor sees it), but it's not in the clippy script (so
`smart-contract:clippy` silently skips it), not in the deploy pipeline (so
it has never been deployed), and not in `docs/contracts.md` (so the
error/event catalogue the indexer would map against is missing it). That's
the "unreviewed contract that may hold funds" failure mode #1554 names.

## Proposed implementation

The contract has a clear purpose, comprehensive rustdoc, a working test
suite, and is designed to integrate with the escrow contract
(`escrow::release_funds()` → `insurance::contribute_to_pool()`). Removing
it would discard a working safety-net layer. The right answer is **keep,
wire into CI, and document**.

### Step 1 — Add to the clippy script

`package.json`'s `smart-contract:clippy` currently lists:

```
-p stellar-bounty-contract -p stellar-core-contract -p stellar-escrow-contract \
-p stellar-freelancer-contract -p stellar-governance-contract -p oracle \
-p stellar-identity-contract -p stellar-referral-contract -p stellar_insights
```

Add `-p stellar-insurance-contract` (the package name in
`backend/contracts/insurance/Cargo.toml` is `stellar-insurance-contract`).
This makes `pnpm run smart-contract:clippy` and the `cli-checks.yml` job
that calls it cover the insurance crate, matching the workspace membership.

`backend:clippy` (`cargo clippy --workspace ...`) and `ci.yml`'s clippy
step (`cargo clippy --workspace --all-targets --all-features`) already
cover it via the workspace; the gap is only the smart-contract-specific
script.

### Step 2 — Document in README and contracts.md

- Add `insurance` to the README's canonical contracts list with a
  one-line purpose: "0.1 % levy on platform fees into a governance-gated
  pool that pays verified claims".
- Add an `InsuranceError` table to `docs/contracts.md` under "Error codes"
  (the table above), so the backend/indexer can map failure codes.
- Add an insurance events table to `docs/contracts.md` under "Events"
  (the table above), so the indexer's topic matching covers `("ins", *)`
  topics.

### Step 3 — Verify the escrow integration point

The rustdoc's design diagram says `escrow::release_funds()` calls
`insurance::contribute_to_pool(fee * 0.001, token)`. Before this contract
can be deployed, verify that `backend/contracts/escrow/src/lib.rs`
actually makes that cross-contract call; if it doesn't, the insurance
pool will always read zero. If the escrow side isn't wired, file a
follow-up issue (the insurance contract is correct in isolation; the
missing piece is the escrow-side contribution call) and document the
dependency in `docs/contracts.md`.

### Step 4 — Decide on deploy pipeline inclusion (out of scope here)

Whether to add `insurance` to `deploy-contracts.yml`'s build/deploy step
is a separate decision tracked in #1585. This issue is only about
documenting the contract's presence and wiring it into the clippy script,
not deploying it.

## Acceptance criteria

- [ ] `package.json` `smart-contract:clippy` includes
      `-p stellar-insurance-contract`
- [ ] README's canonical contracts list includes `insurance` with a
      one-line purpose
- [ ] `docs/contracts.md` has an `InsuranceError` error-codes table and an
      insurance events table
- [ ] Escrow-side `contribute_to_pool` call is either confirmed present or
      filed as a follow-up issue (linked here)
- [ ] CI is green (lint, type-check, tests)
- [ ] No new TODOs without a linked issue

## Out of scope

- Deploying the insurance contract. Tracked by #1585.
- Wiring the escrow-side contribution call if it's missing. That's a
  follow-up issue; this issue only surfaces the dependency.
- Changing the contract's storage layout or error codes. The codes are
  append-only (see `docs/contracts.md` "Error codes" note).
