/**
 * Web uses the CSS font stacks from @st/ui ("Noto Sans", then system fonts).
 * TODO(fonts): self-host Noto @font-face per script (unicode-range) so the web
 * export needs no third-party font CDN; until then system fonts are used.
 */
export function useAppFonts(_locale: string): boolean {
  return true;
}
