import { StatusPill, type PillTone } from '@st/ui';
import { View } from 'react-native';

import type { IconName } from './Icon';

export type TagTone = PillTone;

/**
 * Small labelled status pill (Deposit, Women only, Private, Waitlist, Hosting…): `StatusPill`
 * with a bold Phosphor icon + label, never color alone.
 */
export function Tag({ icon, label, tone = 'neutral', size = 'sm', testID }: { icon?: IconName; label: string; tone?: TagTone; size?: 'sm' | 'md'; testID?: string }) {
  const pill = <StatusPill label={label} tone={tone} icon={icon} size={size} />;
  return testID ? <View testID={testID}>{pill}</View> : pill;
}
