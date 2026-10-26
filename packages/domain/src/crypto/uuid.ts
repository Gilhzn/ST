import { sha256 } from './sha256';

/**
 * Deterministic UUID derived from a string key: the first 16 bytes of
 * `SHA-256(utf8(key))` with the RFC 9562 version nibble set to 8 (custom) and
 * the variant bits set to `10`. Lower-case, `8-4-4-4-12` format.
 *
 * Used for {@link deriveSanctionId} / {@link deriveReviewItemId}: the pure engine
 * must reference sanctions it has just emitted (escalation `causedBy`, review
 * `sanctionId`) before the database has assigned an id. SQL equivalent:
 *
 * ```sql
 * -- h = digest(key, 'sha256') (pgcrypto)
 * select (substr(x,1,8)||'-'||substr(x,9,4)||'-8'||substr(x,14,3)||'-'||
 *         to_hex((get_byte(h,8) & 63) | 128)||substr(x,19,2)||'-'||substr(x,21,12))::uuid
 * from (select h, encode(h,'hex') x from (select digest(key,'sha256') h) s) t;
 * ```
 */
export function stableUuid(key: string): string {
  const b = sha256(key).slice(0, 16);
  b[6] = ((b[6] as number) & 0x0f) | 0x80;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  let hex = '';
  for (const byte of b) hex += (byte < 16 ? '0' : '') + byte.toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Id an adapter must use when inserting a system sanction with this `dedupeKey`. */
export function deriveSanctionId(dedupeKey: string): string {
  return stableUuid(`sanction:${dedupeKey}`);
}

/** Id an adapter must use when inserting a review item with this `dedupeKey`. */
export function deriveReviewItemId(dedupeKey: string): string {
  return stableUuid(`review:${dedupeKey}`);
}
