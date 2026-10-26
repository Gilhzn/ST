// Deno entrypoint (excluded from tsc; see supabase/functions/README.md). Wiring only: logic lives in handler.ts.
import { buildContext } from '../_shared/wiring.ts';
import { mediaEnv } from '../_shared/wiring-phase15.ts';
import { handle, type MediaPurgeDeps } from './handler.ts';

const env = { get: (k: string) => Deno.env.get(k) };
const ctx = buildContext(env, 'media-purge');
const media = mediaEnv(env);
const deps: MediaPurgeDeps = {
  internalSecrets: ctx.internalSecrets,
  storage: media.storage,
  bucket: media.bucket,
  video: media.video,
  log: ctx.log,
};

Deno.serve((req) => handle(req, deps));
