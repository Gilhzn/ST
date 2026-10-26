// Deno entrypoint (excluded from tsc; see supabase/functions/README.md). Wiring only: logic lives in handler.ts.
import { buildPhase15Context, mediaEnv } from '../_shared/wiring-phase15.ts';
import { handle, type MediaUploadDeps } from './handler.ts';

const env = { get: (k: string) => Deno.env.get(k) };
const ctx = buildPhase15Context(env, 'media-upload');
const media = mediaEnv(env);
const deps: MediaUploadDeps = {
  auth: ctx.auth,
  store: ctx.p15,
  storage: media.storage,
  bucket: media.bucket,
  rateLimiter: ctx.rateLimiter,
  clock: ctx.clock,
  log: ctx.log,
  cors: ctx.cors,
};

Deno.serve((req) => handle(req, deps));
