# #1553: Explain or remove `backend/contracts/stellar_insights` from this repo

Related ADR: [`docs/adr/0004-stellar-insights-contract-purpose.md`](../adr/0004-stellar-insights-contract-purpose.md)
Related issues: [#1552](1552-legacy-contracts-tree.md), [#1585](https://github.com/yosemite01/stellar-creator-portfolio/issues/1585) (add contract tests to CI for every canonical contract crate)

## Context

`backend/contracts/stellar_insights/` is a workspace member
([`backend/Cargo.toml`](../../backend/Cargo.toml) lists
`contracts/stellar_insights`) and is linted by the `smart-contract:clippy`
script in `package.json` (`-p stellar_insights`). It is **not** in the
`deploy-contracts.yml` build/deploy pipeline, so it has never been deployed
by CI; like `core`, `insurance`, `referral`, and `test-utils`, it is a
workspace member that the deploy pipeline doesn't reach yet.

The complaint in #1553 is twofold:

1. The name `stellar_insights` reads like a different project, not a
   contract in this platform. A contributor auditing the workspace sees
   a crate named after an external "Stellar Insights" product and can't
   tell from the name whether it belongs here.
2. The contract's purpose is not documented in the README's canonical
   contracts list, even though it **is** already documented in
   [`docs/contracts.md`](../contracts.md) (the `InsightsError` table under
   "Error codes").

## What the contract actually does

Reading [`backend/contracts/stellar_insights/src/lib.rs`](../../backend/contracts/stellar_insights/src/lib.rs),
this is the platform's **creator reputation and review-integrity contract**.
It is not an unrelated project; it is the on-chain half of the reviews and
reputation surfaces the app exposes. Its surface area:

| Entrypoint | Purpose | Auth |
| --- | --- | --- |
| `initialize(admin, platform_token)` | One-shot setup; stores admin + platform token | admin `require_auth` |
| `record_review(creator, reviewer, rating)` | Records a 1–5 star review for a creator | reviewer `require_auth` |
| `challenge_review(review_id, challenger, reason)` | Stake `CHALLENGE_DEPOSIT` (10 XLM) to flag a fake review | challenger `require_auth`; pulls token |
| `uphold_challenge(admin, challenge_id)` | Admin agrees the review was fake: review removed, challenger's deposit returned | admin `require_auth` |
| `reject_challenge(admin, challenge_id)` | Admin disagrees: review restored to `Active`, deposit forfeited to admin | admin `require_auth` |
| `set_reputation(admin, creator, score)` | Admin seeds a creator's reputation | admin `require_auth` |
| `record_bounty_completion(admin, creator, bonus)` | Adds a bounded bonus (≤ `MAX_BONUS_PER_COMPLETION = 100`) to a creator's reputation on bounty completion; refreshes activity timestamp | admin `require_auth` |
| `get_effective_reputation(creator)` | Returns reputation after time-decay (3-month grace, then exponential decay at a configurable `DecayRate`) | read-only |
| `is_decaying(creator)` | Whether the creator is past the grace period | read-only |
| `set_decay_rate(admin, new_rate)` | Adjust the decay rate (1–10 000) | admin `require_auth` |
| `validate_epoch(admin, epoch, data_hash)` | Admin attests an epoch's data hash | admin `require_auth` |
| `upgrade(admin, new_wasm_hash)` | Standard admin-gated WASM upgrade | admin `require_auth` |

Storage uses `DataKey::{Epoch, Review, ReviewCounter, Challenge,
ChallengeCounter, Admin, PlatformToken, Reputation, DecayRate}`, all
`env.storage().persistent()`. Error codes are the `InsightsError` enum
already documented in `docs/contracts.md`. Events use the deprecated
`Events::publish` (kept as-is for SDK 23; migration to
`#[contractevent]` is a separate change because it shifts on-chain event
layout the indexer decodes).

It has a real, exercised test suite (`#[cfg(test)] mod tests` covers epoch
validation, challenge staking, uphold/reject flow, decay within and after
the grace period, bounty-completion refresh, and governance-set decay rate).

## Why it matters

A contract named after another project, sitting in the canonical workspace
but absent from the README's contract list, is the kind of thing that slows
audits ("is this a stray dependency?") and misleads contributors about the
platform's scope. The cost is small today (clippy time on a crate no one
deploys) but compounds: every contract added without a README entry raises
the same question, and the next reviewer has to re-do the same archaeology.

## Proposed implementation

The contract has a clear purpose and a working test suite, so the right
answer is **keep, rename, and document** — not remove.

### Step 1 — Rename the crate to reflect its purpose

`stellar_insights` → `reputation` (or `creator_reputation` if the
shorter name is ambiguous against future contracts). Rename the directory
`backend/contracts/stellar_insights/` → `backend/contracts/reputation/`,
update `backend/Cargo.toml`'s workspace member, update the crate name in
`Cargo.toml` (`name = "stellar_insights"` → `name = "stellar-reputation-contract"`
to match the `stellar-*-contract` convention used by the other canonical
contracts), and update the `-p stellar_insights` reference in
`package.json`'s `smart-contract:clippy` script.

The Rust `#[contract] pub struct StellarInsights;` and the generated client
`StellarInsightsClient` can stay as the on-chain type name — that's
cosmetic and changing it would break any deployed instance's storage key
derivation. Only the crate/package name needs to move.

### Step 2 — Document in README and contracts.md

- Add `reputation` (née `stellar_insights`) to the README's canonical
  contracts list with a one-line purpose: "creator reviews, review
  challenges with staked deposits, and time-decaying reputation scores".
- `docs/contracts.md` already has the `InsightsError` table; add a short
  "Reputation contract" section describing the flow (record → challenge →
  uphold/reject → reputation decay), linking to the entrypoint table
  above. Add the events table (`review/recorded`, `review/challeng`,
  `review/upheld`, `review/reject`, `rep_set`, `bty_done`,
  `rep/decay_set`, `contract/upgraded`) alongside the existing bounty and
  freelancer event tables.

### Step 3 — Add a note on the name change

Because the crate is renamed but no instance is deployed (it's not in the
deploy pipeline), there is no on-chain migration: the contract type name
`StellarInsights` and its storage layout are unchanged, only the crate's
package name moves. If a deployed instance existed, renaming the package
would still be safe (the on-chain identity is the contract ID, not the
crate name), but the storage `DataKey` derivation must not change — which
it doesn't, since we're not touching the Rust types.

### Step 4 — Decide on deploy pipeline inclusion (out of scope here)

Whether to add `reputation` to `deploy-contracts.yml`'s build/deploy step
is a separate decision tracked in #1585 ("Add contract tests to CI for
every canonical contract crate"). This issue is only about explaining the
crate's presence, not deploying it.

## Acceptance criteria

- [ ] Crate renamed from `stellar_insights` to `reputation` (or
      `creator_reputation`) across `backend/Cargo.toml`, the directory, the
      crate `Cargo.toml`, and `package.json`'s `smart-contract:clippy`
- [ ] README's canonical contracts list includes the contract with a
      one-line purpose
- [ ] `docs/contracts.md` has a "Reputation contract" section with the
      entrypoint summary and an events table
- [ ] No reference to `stellar_insights` as a current crate name remains
      outside this issue doc and ADR 0004 (which record the rename)
- [ ] CI is green (lint, type-check, tests)
- [ ] No new TODOs without a linked issue

## Out of scope

- Deploying the reputation contract. Tracked by #1585.
- Migrating from `Events::publish` to `#[contractevent]`. That changes
  on-chain event layout and is a separate change.
- Changing the on-chain `StellarInsights` type name. Unnecessary and would
  touch storage key derivation for any deployed instance.
