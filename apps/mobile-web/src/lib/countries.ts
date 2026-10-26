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
