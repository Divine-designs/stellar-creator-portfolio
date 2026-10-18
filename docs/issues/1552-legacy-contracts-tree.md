# #1552: Decide the fate of the legacy top-level `contracts/` tree

Related ADR: [`docs/adr/0003-legacy-contracts-tree-archived.md`](../adr/0003-legacy-contracts-tree-archived.md)
Related issues: [#1571](https://github.com/yosemite01/stellar-creator-portfolio/issues/1571) (upgrade legacy contracts/ or archive them), [#1553](1553-stellar-insights-contract.md)

## Context

The repo historically held **two** Soroban contract trees:

| Tree | Location | SDK | Built by CI | Deployed | Status |
| --- | --- | --- | --- | --- | --- |
| Canonical | `backend/contracts/` | soroban-sdk 23.5.3 | yes (`deploy-contracts.yml`) | testnet on every push to `main` | live |
| Legacy | top-level `contracts/` (`amm`, `analytics`, `core`, `escrow`, `vault`) | soroban-sdk 21.7.7 | no | one-off manual testnet deploy | source removed; addresses still live on testnet |

The README's "Live Contracts — Stellar Testnet" table still publishes the
legacy testnet addresses:

| Contract | Address |
| --- | --- |
| Escrow (`contracts/escrow`, legacy) | `CDDVR4DXPPYYH43OVBVUVK2V7A4NPNN6DAJJ7QFPRB53LMK3XK4U4D76` |
| Vault | `CA23KXIQGCGMBITUT7IZCTQWMMO3A2PDIZXCL4FS7KZHS6FEMGUY4Y6U` |
| AMM | `CD2733NB3EKZQFS7BDFWVS4W7QOQ4IX5EVY5PTPCHLPMRBW7UBSPWFHD` |
| Analytics | `CAZNWED5SCKMPIOSU274DCHLFRGGFZLQNMCWXWNAO3HF5RY2PMPIODWA` |

The README already records that the legacy tree was removed rather than
upgraded — its source is preserved in git history at commit `734cff58`
(e.g. `git show 734cff58:contracts/vault/src/lib.rs`). A `list_directory` of
the workspace root confirms no top-level `contracts/` directory remains.

## Why it matters

Two escrow contracts — the legacy `contracts/escrow` (live on testnet) and
the canonical `backend/contracts/escrow` (built and deployed by CI) — invite
integrators to wire against the wrong one. The legacy contracts are also
pinned to an SDK version (21.7.7) two majors behind the workspace's single
pinned version (23.5.3), so building them would require a separate toolchain
no one in this repo maintains.

Nothing in the platform integrates against the legacy addresses — the
canonical contract addresses live in
[`deployments/testnet.json`](../../deployments/testnet.json) and are read by
`lib/contracts/deployments.ts`; the legacy addresses are not referenced by
any code path in the app, the Rust services, or the mobile app.

## What's already done

Reviewing the current state of `main`:

- [x] Top-level `contracts/` tree removed from `main`. Source preserved at
      commit `734cff58`.
- [x] `backend/Cargo.toml` workspace lists only `backend/contracts/*` members;
      no top-level `contracts/` crate is referenced.
- [x] `package.json` `smart-contract:clippy` script targets only
      `backend/contracts/*` packages; no legacy crate is linted.
- [x] `deploy-contracts.yml` build step lists only the six canonical
      packages (`bounty`, `escrow`, `freelancer`, `governance`, `oracle`,
      `identity`); no legacy contract is built or deployed.
- [x] README documents the archive and points to `734cff58` for revival.
- [x] README's "Tech Stack" table states the workspace pins a single
      `soroban-sdk = "23.5.3"`.

## What's left

The cleanup is ~95% done. The remaining work is documentation hygiene:

1. **The README "Live Contracts — Stellar Testnet" table is in the wrong
   section.** It sits at the very top of the README under a heading that reads
   like the canonical contract list, but the prose immediately above it says
   the legacy tree has been archived and "nothing in the platform integrates
   against them." A reader scanning the README sees four testnet addresses
   before they see the canonical contracts table. Move the legacy table into
   a clearly labelled "Historical: legacy testnet addresses" subsection (or
   into `docs/contracts.md`), so the canonical contracts surface first.

2. **README "Smart Contracts" section still shows `cd contracts/escrow`** in
   its build/deploy snippet. That path no longer exists in `main`; the snippet
   should point at `backend/contracts/escrow` or, better, defer to
   `docs/contracts.md`'s CI-driven deploy story (manual deploys are the
   exception, not the workflow).

3. **ADR.** The decision to archive rather than upgrade was made and executed
   but never captured in `docs/adr/`. ADR 0003 (linked above) records it,
   including the alternatives considered (upgrade in place, dual-build, keep
   as reference) and why each was rejected.

## Proposed implementation

Small, independently mergeable steps:

### Step 1 — ADR

Merge [`docs/adr/0003-legacy-contracts-tree-archived.md`](../adr/0003-legacy-contracts-tree-archived.md)
recording the decision. Status: **Accepted** (the work already landed; this
ADR documents what happened rather than proposing new work).

### Step 2 — README hygiene

- Move the legacy testnet addresses table into a "Historical — legacy
  testnet addresses" subsection below the canonical contracts description, or
  relocate it to `docs/contracts.md` under a "Legacy" heading.
- Fix the "Smart Contracts" section's `cd contracts/escrow` snippet to point
  at the canonical path, or replace it with a pointer to
  `docs/contracts.md` (CI deploys; manual deploys are the exception).
- The existing "Legacy `contracts/` tree (archived)" note in "Project
  Structure" is already accurate and can stay.

### Step 3 — Verify no stale references

Grep the repo for any remaining references to the top-level `contracts/`
path that imply it still exists (as opposed to git-history pointers, which
are intentional). Known intentional references to keep:

- README's `734cff58` git-history pointer (revival instructions).
- This issue doc and ADR 0003.

Any other reference (a script, a Makefile target, a CI step, a doc link that
isn't git-history) is a stale leftover and should be removed or repointed.

## Acceptance criteria

- [ ] ADR 0003 merged in `docs/adr/`
- [ ] README lists exactly one escrow contract (`backend/contracts/escrow`)
      as canonical; the legacy addresses are clearly labelled historical
- [ ] No stale reference to the top-level `contracts/` path as a live
      directory (git-history pointers in README and ADR are intentional and
      stay)
- [ ] `backend/Cargo.toml`, `package.json` `smart-contract:clippy`, and
      `deploy-contracts.yml` reference only `backend/contracts/*` (already
      true — keep it that way)
- [ ] CI is green (lint, type-check, tests)
- [ ] No new TODOs without a linked issue

## Out of scope

- Reviving any legacy contract (`amm`, `vault`, `analytics`) by porting it
  into `backend/contracts/` against SDK 23. That's a separate, opt-in
  decision per contract — see the README's revival instructions and, if
  taken, warrants its own ADR.
- Upgrading the legacy tree in place. Rejected; see ADR 0003 alternatives.
