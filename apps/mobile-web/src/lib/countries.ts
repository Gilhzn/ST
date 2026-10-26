/**
 * Calling codes for the phone field. Names are localized at runtime with
 * Intl.DisplayNames, so no country names live in the bundle.
 */
export const COUNTRY_DIAL: Readonly<Record<string, string>> = {
  IL: '972', US: '1', CA: '1', GB: '44', IE: '353', ES: '34', PT: '351', FR: '33', DE: '49', IT: '39', NL: '31', BE: '32',
  CH: '41', AT: '43', SE: '46', NO: '47', DK: '45', FI: '358', PL: '48', CZ: '420', GR: '30', TR: '90', RU: '7', UA: '380',
  BR: '55', AR: '54', MX: '52', CO: '57', CL: '56', PE: '51', JP: '81', CN: '86', TW: '886', HK: '852', KR: '82', IN: '91',
  SG: '65', AU: '61', NZ: '64', ZA: '27', EG: '20', AE: '971', SA: '966', JO: '962', MA: '212', NG: '234', KE: '254',
};

export function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65));
}

export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** National number → E.164 (drops a trunk "0"; keeps digits only). Null when implausible. */
export function toE164(dial: string, national: string): string | null {
  let digits = national.replace(/\D/g, '');
  if (national.trim().startsWith('+')) {
    return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  const full = `${dial}${digits}`;
  return /^[1-9]\d{6,14}$/.test(full) && digits.length >= 6 ? `+${full}` : null;
}

/**
 * Readable E.164 for display ("+972 50-000-0001", "+1 201-555-1196", "+44 7700 900123").
 * Display only: the stored/sent value stays E.164. Callers wrap it as an LTR isolate.
 */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (!e164.startsWith('+') || digits.length < 7) return e164;
  const dial = [...new Set(Object.values(COUNTRY_DIAL))]
    .sort((a, b) => b.length - a.length)
    .find((d) => digits.startsWith(d));
  if (!dial) return e164;
  const n = digits.slice(dial.length);
  if (dial === '1' && n.length === 10) return `+1 ${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
  if (dial === '972' && n.length === 9) return `+972 ${n.slice(0, 2)}-${n.slice(2, 5)}-${n.slice(5)}`;
  if (dial === '972' && n.length === 8) return `+972 ${n.slice(0, 1)}-${n.slice(1, 4)}-${n.slice(4)}`;
  // Generic: groups of 3–4 from the start ("7700 900 123" style is close enough for review screens).
  const groups = n.length > 7 ? [n.slice(0, n.length - 6), n.slice(-6, -3), n.slice(-3)] : [n.slice(0, n.length - 4), n.slice(-4)];
  return `+${dial} ${groups.filter(Boolean).join(' ')}`;
}
