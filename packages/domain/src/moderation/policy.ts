/**
 * Combines layer verdicts into one `ModerationVerdict` (ADR 0005, CHAT-010…013).
 *
 * - Provider outcomes that are missing, `timeout`, `error` or `pending` are unavailable.
 * - No server provider available → `pending` (fail-open: delivered and re-checked), source `fallback`.
 * - `block`: any available provider blocks with a severe category; or the LLM
 *   (context-aware) blocks; or the only available provider blocks; or both block.
 * - omni blocks a non-severe category while the LLM does not → `nudge` (omni has
 *   more false positives, e.g. sports slang like "we'll destroy them").
 * - `nudge`: any provider nudges, or the blocklist matched (profanity), with no block.
 * - otherwise `allow`.
 * `reasonKey` (namespace `chat`): `moderation.block.<category>` / `moderation.nudge.<category>`.
 */
import type { ModerationCategory, ModerationSource, ModerationVerdict } from '../types';
import type { BlocklistMatch } from './match';

/** Categories that block on any single provider's say-so. */
export const SEVERE_MODERATION_CATEGORIES: readonly ModerationCategory[] = ['sexual_minors', 'threat', 'hate', 'violence'];

/** Severity order used to pick the primary category for the reason key. */
export const CATEGORY_SEVERITY: readonly ModerationCategory[] = [
  'sexual_minors',
  'threat',
  'violence',
  'hate',
  'self_harm',
  'sexual',
  'harassment',
  'personal_data',
  'spam',
  'profanity',
  'other',
];

export type ProviderOutcome = ModerationVerdict | 'timeout' | 'error' | null | undefined;

export interface ModerationInputs {
  blocklist?: BlocklistMatch | null;
  omni?: ProviderOutcome;
  llm?: ProviderOutcome;
}

function available(o: ProviderOutcome): ModerationVerdict | null {
  return o && typeof o === 'object' && o.decision !== 'pending' ? o : null;
}

function sortCategories(cats: Iterable<ModerationCategory>): ModerationCategory[] {
  return [...new Set(cats)].sort((a, b) => CATEGORY_SEVERITY.indexOf(a) - CATEGORY_SEVERITY.indexOf(b));
}

function verdict(decision: 'allow' | 'nudge' | 'block', cats: Iterable<ModerationCategory>, source: ModerationSource): ModerationVerdict {
  const categories = sortCategories(cats);
  const primary = categories[0] ?? 'other';
  return { decision, categories, source, reasonKey: decision === 'allow' ? null : `moderation.${decision}.${primary}` };
}

export function combineModerationVerdicts(inputs: ModerationInputs): ModerationVerdict {
  const omni = available(inputs.omni);
  const llm = available(inputs.llm);
  const listHit = inputs.blocklist?.matched === true;
  if (!omni && !llm) {
    return { decision: 'pending', categories: listHit ? ['profanity'] : [], source: 'fallback', reasonKey: null };
  }
  const contributors = (omni ? 1 : 0) + (llm ? 1 : 0) + (listHit ? 1 : 0);
  const source: ModerationSource = contributors > 1 ? 'combined' : omni ? 'omni' : 'llm';
  const blockers = [omni, llm].filter((v): v is ModerationVerdict => v?.decision === 'block');
  const severe = blockers.flatMap((v) => v.categories).filter((c) => SEVERE_MODERATION_CATEGORIES.includes(c));
  const onlyOne = !omni || !llm;
  if (severe.length > 0 || llm?.decision === 'block' || (onlyOne && blockers.length > 0)) {
    return verdict('block', blockers.flatMap((v) => v.categories), source);
  }
  const flagged = [omni, llm].filter((v): v is ModerationVerdict => v !== null && v.decision !== 'allow');
  if (flagged.length > 0 || listHit) {
    return verdict('nudge', [...flagged.flatMap((v) => v.categories), ...(listHit ? (['profanity'] as const) : [])], source);
  }
  return verdict('allow', [], source);
}
