/**
 * HTML output helpers for the few public pages the functions render (invite
 * rich previews). Every interpolated value goes through {@link escapeHtml};
 * URLs additionally go through {@link safeHttpUrl} so a `javascript:` or
 * `data:` URL can never reach an attribute.
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;',
};

/** C0/C1 controls (except tab/newline), bidi overrides and lone surrogates. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Escapes text for element content and quoted attribute values. Strips control and bidi-override characters. */
export function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s.replace(UNSAFE_CHARS, '').replace(/[&<>"'`=]/g, (c) => HTML_ESCAPES[c] as string);
}

/** Returns `url` when it is an absolute http(s) URL without credentials, else `null`. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null;
  return u.toString();
}

/** Single-line, length-capped text for meta tags (whitespace collapsed). */
export function metaText(value: string, max: number): string {
  const s = value.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // No scripts, no framing, no referrer leak of the invite token.
      'content-security-policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...headers,
    },
  });
}
