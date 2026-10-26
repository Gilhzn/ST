// Deno entrypoint (excluded from tsc; see supabase/functions/README.md). Wiring only: logic lives in handler.ts.
// Public: deploy with --no-verify-jwt (link-preview crawlers send no Authorization header).
import catalogs from '../_shared/invite-copy.json' with { type: 'json' };
import { createInviteLocalizer, type InviteCatalogs } from '../_shared/invite-copy.ts';
import { buildPhase15Context, ogBaseUrl } from '../_shared/wiring-phase15.ts';
import { handle, type InvitePreviewDeps } from './handler.ts';

const env = { get: (k: string) => Deno.env.get(k) };
const ctx = buildPhase15Context(env, 'invite-preview');
const deps: InvitePreviewDeps = {
  store: ctx.p15,
  l10n: createInviteLocalizer(catalogs as InviteCatalogs),
  ogBaseUrl: ogBaseUrl(env),
  rateLimiter: ctx.rateLimiter,
  log: ctx.log,
};

Deno.serve((req) => handle(req, deps));
