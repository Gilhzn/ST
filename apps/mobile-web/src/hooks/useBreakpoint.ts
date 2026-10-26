import { sizing } from '@st/ui';
import { useWindowDimensions } from 'react-native';

export type Breakpoint = 'compact' | 'medium' | 'wide';

/** Layout classes from design §12.2: < 768 phones, 768–1023 rail, ≥ 1024 split view. */
export function useBreakpoint(): { bp: Breakpoint; width: number; height: number; isWide: boolean; hasRail: boolean } {
  const { width, height } = useWindowDimensions();
  const bp: Breakpoint = width >= sizing.breakpointLg ? 'wide' : width >= sizing.breakpointMd ? 'medium' : 'compact';
  return { bp, width, height, isWide: bp === 'wide', hasRail: bp !== 'compact' };
}
