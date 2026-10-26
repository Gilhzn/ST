// Deno entrypoint (excluded from tsc; see supabase/functions/README.md). Wiring only: logic lives in handler.ts.
import catalogs from '../_shared/notifications.json' with { type: 'json' };
import { createLocalizer, type NotificationCatalogs } from '../_shared/i18n.ts';
import { createExpoPushSender, webPushStub } from '../_shared/push.ts';
import { buildContext } from '../_shared/wiring.ts';
import { handle, type PushDeps } from './handler.ts';

const env = { get: (k: string) => Deno.env.get(k) };
const ctx = buildContext(env, 'push-dispatch');
const deps: PushDeps = {
  internalSecrets: ctx.internalSecrets,
  store: ctx.store,
  expo: createExpoPushSender({ accessToken: env.get('EXPO_ACCESS_TOKEN') }),
  webPush: webPushStub,
  localizer: createLocalizer(catalogs as NotificationCatalogs),
  log: ctx.log,
};

Deno.serve((req) => handle(req, deps));
