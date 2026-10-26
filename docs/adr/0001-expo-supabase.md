# ADR 0001: Expo (React Native + Expo Router) and Supabase

- Status: Accepted (2026-10)
- Deciders: Product owner, Architect

## Context
Sport Talent must ship a full web app plus iOS and Android from day one, in 13 locales, with a small team of agents. It needs geo queries, row-level authorization, realtime chat, scheduled jobs and server functions that call AI and payment vendors. Docker is not available in the build container, so local verification must work without it.

## Decision
- **Client:** one Expo SDK 58 codebase with Expo Router for web, iOS and Android. Platform differences are isolated in `src/platform/**` using `*.native.tsx` / `*.web.tsx` files. A dev client is used (native modules such as MapLibre).
- **Backend:** Supabase: Postgres + PostGIS, RLS on every table, SECURITY DEFINER RPCs for business writes, Realtime Broadcast for chat, Edge Functions for vendor calls, pg_cron for jobs, Auth with phone OTP.
- **Seams:** the app talks to a `DataPort` interface (`SupabaseAdapter`, `InMemoryAdapter`); Edge Functions are pure `handle(req, deps)`.

## Consequences
- + One codebase, one language (TS) end to end; web e2e covers most behaviour.
- + Authorization lives next to data (RLS); fewer custom servers.
- + `DataPort` and `handle(req, deps)` keep a migration path open (Fastify, another Postgres host).
- − Native behaviour (geofence, push, camera) cannot be verified in CI containers; mitigated by thin platform files and EAS builds.
- − Some vendor lock-in to Supabase Realtime/Auth; contained by the adapter.
- − SQL and TS both implement trust rules; mitigated by golden parity tests (ADR 0003).
