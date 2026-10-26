/**
 * i18n catalog check. Run with `npm run check --workspace=@st/i18n` (or `npm run i18n:check`).
 *
 * Verifies, for every locale folder: same keys as `en`, no empty strings, valid ICU,
 * matching placeholders, CLDR plural categories, and (for `en`) coverage of the
 * domain enums. Exits 1 when there are errors.
 *
 * Options: `--strict` also fails on warnings; `--dir <path>` checks another locales folder.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport, loadCatalog, validateCatalog } from './validate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dirFlag = process.argv.indexOf('--dir');
const localesDir = dirFlag >= 0 && process.argv[dirFlag + 1] ? resolve(process.argv[dirFlag + 1] as string) : join(here, '..', 'locales');
const issues = validateCatalog(loadCatalog(localesDir), {
  domainTypesPath: join(here, '..', '..', 'domain', 'src', 'types.ts'),
});

const strict = process.argv.includes('--strict');
console.log(formatReport(issues));
const failed = issues.some((i) => i.level === 'error' || (strict && i.level === 'warn'));
process.exit(failed ? 1 : 0);
