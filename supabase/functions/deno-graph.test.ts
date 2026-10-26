/**
 * Deno module-graph smoke test: bundles every function's index.ts with
 * esbuild, resolving bare specifiers exactly as Deno will (import_map.json),
 * so a missing map entry, a broken relative import or a non-ESM dependency
 * fails CI here instead of at `supabase functions deploy`.
 */
import { build, type Plugin } from 'esbuild';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const map = JSON.parse(readFileSync(join(here, 'import_map.json'), 'utf8')) as { imports: Record<string, string> };
const functions = readdirSync(here).filter((d) => existsSync(join(here, d, 'index.ts')));

// The generated bundles may be absent in a fresh checkout: fall back to the package sources.
const fallback: Record<string, string> = {
  '@st/domain': join(root, 'packages/domain/src/index.ts'),
  '@st/payments': join(root, 'packages/payments/src/index.ts'),
};

const denoResolver: Plugin = {
  name: 'deno-import-map',
  setup(b) {
    b.onResolve({ filter: /^npm:|^jsr:|^https?:/ }, (args) => ({ path: args.path, external: true }));
    b.onResolve({ filter: /^(@st\/|#shared\/|#fn\/)/ }, (args) => {
      const target = map.imports[args.path];
      if (!target) return { errors: [{ text: `import_map.json has no entry for ${args.path}` }] };
      const abs = join(here, target);
      return { path: existsSync(abs) ? abs : (fallback[args.path] ?? abs) };
    });
    // Deno requires explicit extensions on relative imports.
    b.onResolve({ filter: /^\.\.?\// }, (args) => {
      if (args.importer.includes('/packages/')) return undefined; // bundled package sources (Node style)
      if (!/\.(ts|mjs|js|json)$/.test(args.path)) return { errors: [{ text: `relative import without extension: ${args.path}` }] };
      return undefined;
    });
  },
};

/** Stands in for the generated catalogs (notifications.json, invite-copy.json) when build-domain.mjs has not run. */
const catalogStub: Plugin = {
  name: 'catalog-stub',
  setup(b) {
    b.onResolve({ filter: /(notifications|invite-copy)\.json$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: '{}', loader: 'json' }));
  },
};

describe('Deno module graph', () => {
  it('has functions', () => {
    expect(functions).toEqual(
      expect.arrayContaining([
        'send-message', 'translate-message', 'checkin-verify', 'trust-evaluate', 'create-deposit', 'payments-webhook', 'settle-deposits', 'delete-account', 'push-dispatch',
        'media-upload', 'media-process', 'media-purge', 'rating-period', 'series-jobs', 'invite-preview',
      ]),
    );
  });

  it.each(functions)('%s/index.ts resolves with import_map.json', async (fn) => {
    const generated = existsSync(join(here, '_shared/notifications.json')) && existsSync(join(here, '_shared/invite-copy.json'));
    const result = await build({
      entryPoints: [join(here, fn, 'index.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      logLevel: 'silent',
      plugins: generated ? [denoResolver] : [denoResolver, catalogStub],
    });
    expect(result.errors).toEqual([]);
  });
});
