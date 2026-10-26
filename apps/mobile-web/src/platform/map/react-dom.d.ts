/**
 * Minimal typing for the one react-dom API the web map uses (`createPortal`), because
 * @types/react-dom isn't installed. Delete this file if @types/react-dom is added.
 */
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';

  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal;
}
