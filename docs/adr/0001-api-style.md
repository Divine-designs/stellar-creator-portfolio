# ADR 0001: Pick one API style per consumer (tRPC, REST, GraphQL)

- **Status:** Accepted
- **Date:** 2025-01-01
- **Issue:** #1549

## Context

The platform currently exposes four API surfaces:

| Style | Location | Primary consumer |
|---|---|---|
| tRPC | `server/api/router.ts` (context, rate limiting in `server/api/`) | Next.js web app (`components/providers/` tRPC provider) |
| GraphQL | `server/graphql/` (schema, resolvers, context) | None confirmed — no first-party consumer in the repo |
| REST | `app/api/**` (~64 route handlers) | Web app, mobile app, third parties, webhooks |
| Rust Actix API | `backend/` (Actix-web services) | Internal services / contract-adjacent workloads |

Because features are split across these surfaces, auth, validation and rate
limiting are duplicated (e.g. tRPC context vs. REST route middleware vs.
GraphQL context). Contributors have no clear default for where a new feature
belongs.

## Decision

Choose **one primary style per consumer**:

1. **Web app → tRPC.** New first-party web features are added to
   `server/api/router.ts` and consumed via the tRPC client. tRPC gives
   end-to-end type safety and a single auth/rate-limit context.
2. **Mobile app and third parties → REST (OpenAPI 3.1).** Public and
   cross-client endpoints live under `app/api/**` and are described by an
   OpenAPI 3.1 document. REST is the lingua franca for the Expo mobile app and
   external integrators, and supports standard deprecation signalling.
3. **GraphQL → deprecated.** `server/graphql/` is frozen. No new resolvers are
   added. It is removed once we confirm no consumer depends on it (see
   migration plan).
4. **Rust Actix API → internal only.** It stays for workloads that need Rust
   (contract indexing, heavy compute) and is not a public API surface.

## Deprecation of non-primary styles

- **GraphQL** is marked deprecated. New work must not target it. When the
  surface is retired, responses will carry the `Sunset` header
  ([RFC 8594](https://www.rfc-editor.org/rfc/rfc8594)) and the `Deprecation`
  header, and the OpenAPI document will flag affected operations.
- **REST routes that duplicate tRPC-only web features** are candidates for
  consolidation into tRPC; they are not removed until the mobile/third-party
  consumers are migrated.
- Rate-limit responses will adopt the
  [IETF RateLimit header fields draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)
  on the REST surface.

## Consequences

- Contributors have a default: web → tRPC, external → REST.
- Auth, validation and rate limiting can be consolidated per surface instead of
  duplicated across three.
- GraphQL maintenance cost drops to zero once retired.
- Some short-term duplication remains while REST routes that back web-only
  features are migrated to tRPC.

## Alternatives considered

- **tRPC only.** Best DX for the web app, but unusable for the Expo mobile app
  and third parties without a REST/OpenAPI bridge.
- **GraphQL only.** Powerful for flexible clients, but no current consumer
  needs it, and it adds schema/resolver overhead and a separate auth path.
- **REST only.** Universal, but loses tRPC's end-to-end type safety for the
  web app and would require hand-written client types.
- **Keep all three.** Status quo — duplicated auth/validation/rate limiting and
  unclear ownership. Rejected.

## Migration plan (tracked as separate issues)

1. Publish an OpenAPI 3.1 document for `app/api/**` and wire it into CI.
2. Inventory GraphQL consumers; if none, remove `server/graphql/`.
3. Migrate web-only REST routes to tRPC, one route per PR.
4. Add `Sunset`/`Deprecation` headers to any endpoint being retired.
5. Update `README.md` and `docs/architecture.md` as each step lands.
