/**
 * Keyboard-modality tracking for web focus rings (the :focus-visible heuristic). Pressable's
 * `focused` is also true after a mouse/touch press, which left a ring on tapped tiles, tabs and
 * buttons. On web we track the last input modality and, after a pointer click, release focus
 * from non-text controls so rings only appear for keyboard users. Native: no-op.
 */
import { Platform } from 'react-native';

let keyboard = Platform.OS !== 'web';
let installed = false;

const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Call once at startup (root layout). */
export function installFocusVisible() {
  if (installed || Platform.OS !== 'web' || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('keydown', () => (keyboard = true), true);
  document.addEventListener('pointerdown', () => (keyboard = false), true);
  document.addEventListener('click', () => {
    if (keyboard) return;
    setTimeout(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || TEXT_ENTRY.has(el.tagName) || el.isContentEditable) return;
      if (el.closest('[aria-modal="true"]')) return; // keep focus inside dialogs
      el.blur();
    }, 0);
  }, true);
}

export function focusVisible(focused: boolean | undefined): boolean {
  return Boolean(focused) && keyboard;
}
