/**
 * Production wiring for the Phase 1.5 functions (media-upload, media-process,
 * rating-period, series-jobs, invite-preview). Runtime-agnostic like
 * `wiring.ts`: env is injected and every vendor adapter is plain `fetch`.
 */
import { createPushDispatcher, type PushDispatcher } from '#shared/functions-client';
import {
  createCloudflareStream,
  createOmniImageModerator,
  createPhotoDnaScanner,
  manualCsamReporter,
  storageTransformRenditions,
  type CsamReporter,
  type CsamScanner,
  type ImageModerator,
  type RenditionProvider,
  type VideoProvider,
} from '#shared/media-providers';
import { createPhase15Store, type Phase15Store } from '#shared/phase15-store';
import { createSupabaseStorage, type StorageClient } from '#shared/storage';
import { createSupabaseClient } from '#shared/supabase';
import { buildContext, type BaseContext, type Env } from '#shared/wiring';

export interface Phase15Context extends BaseContext {
  p15: Phase15Store;
}

export function buildPhase15Context(env: Env, functionName: string): Phase15Context {
  const base = buildContext(env, functionName);
  const url = env.get('SUPABASE_URL') as string;
  const admin = createSupabaseClient({ url, apiKey: env.get('SUPABASE_SERVICE_ROLE_KEY') as string });
  const anon = createSupabaseClient({ url, apiKey: env.get('SUPABASE_ANON_KEY') as string });
  const p15 = createPhase15Store({
    admin,
    anon,
    asUser: (accessToken) => createSupabaseClient({ url, apiKey: env.get('SUPABASE_ANON_KEY') as string, accessToken }),
  });
  return { ...base, p15 };
}

export interface MediaEnv {
  storage: StorageClient;
  bucket: string;
  quarantineBucket: string;
  csam: CsamScanner | null;
  reporter: CsamReporter;
  moderator: ImageModerator | null;
  renditions: RenditionProvider;
  video: VideoProvider | null;
}

const BUCKET_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/;

function bucketName(env: Env, name: string, fallback: string): string {
  const v = env.get(name) ?? fallback;
  if (!BUCKET_RE.test(v)) throw new Error(`invalid ${name}`);
  return v;
}

/** Media vendors from env. A missing CSAM or moderation key leaves the port `null`: nothing is published (fail closed). */
export function mediaEnv(env: Env): MediaEnv {
  const bucket = bucketName(env, 'MEDIA_BUCKET', 'media');
  const csamKey = env.get('CSAM_PROVIDER_KEY');
  const openai = env.get('OPENAI_API_KEY');
  const cfAccount = env.get('CLOUDFLARE_ACCOUNT_ID');
  const cfToken = env.get('CLOUDFLARE_STREAM_TOKEN');
  const cfCode = env.get('CLOUDFLARE_STREAM_CUSTOMER_CODE');
  return {
    storage: createSupabaseStorage({ url: env.get('SUPABASE_URL') as string, serviceKey: env.get('SUPABASE_SERVICE_ROLE_KEY') as string }),
    bucket,
    quarantineBucket: bucketName(env, 'MEDIA_QUARANTINE_BUCKET', bucket),
    csam: csamKey ? createPhotoDnaScanner({ apiKey: csamKey }) : null,
    reporter: manualCsamReporter,
    moderator: openai ? createOmniImageModerator({ apiKey: openai }) : null,
    renditions: storageTransformRenditions,
    video: cfAccount && cfToken && cfCode ? createCloudflareStream({ accountId: cfAccount, apiToken: cfToken, customerCode: cfCode }) : null,
  };
}

/** `push-dispatch` client, or `null` when the notifications INSERT webhook already pushes (`PUSH_VIA_WEBHOOK=1`). */
export function pushDispatcher(env: Env): PushDispatcher | null {
  if (env.get('PUSH_VIA_WEBHOOK') === '1') return null;
  return createPushDispatcher({ url: env.get('SUPABASE_URL') as string, serviceKey: env.get('SUPABASE_SERVICE_ROLE_KEY') as string });
}

/** `OG_BASE_URL`: the public web app origin (https) that serves `/invite/<token>` and `/og/<sport>.png`. */
export function ogBaseUrl(env: Env): string {
  const raw = env.get('OG_BASE_URL');
  if (!raw) throw new Error('missing environment variable OG_BASE_URL');
  const u = new URL(raw);
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error('OG_BASE_URL must be https');
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}
