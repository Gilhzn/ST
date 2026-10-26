/**
 * Focus rings for keyboard users only (the :focus-visible heuristic, WCAG 2.4.7 without the
 * "ring after every tap" noise). Pressable's `focused` is also true after a mouse or touch
 * press on web, which left 3dp rings on tapped buttons (e.g. chat Send). We track the last
 * input modality at the document level; native keeps rings whenever focused (hardware
 * keyboards / switch access move focus without touches).
 */
import { Platform } from "react-native";

let keyboard = Platform.OS !== "web";
let installed = false;

function install() {
  if (installed || Platform.OS !== "web" || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("keydown", (e) => {
    if (!e.metaKey && !e.ctrlKey && !e.altKey) keyboard = true;
  }, true);
  document.addEventListener("pointerdown", () => (keyboard = false), true);
}

/** True when a focused control should draw its focus ring (keyboard modality). */
export function showFocusRing(focused: boolean | undefined): boolean {
  install();
  return Boolean(focused) && keyboard;
}
