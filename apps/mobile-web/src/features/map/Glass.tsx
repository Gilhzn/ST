/**
 * Floating "glass" surface for controls over the map: backdrop blur + translucent surface,
 * hairline edge and a soft shadow. Swap for the `@st/ui` v2 glass card when it ships.
 */
import { useTheme } from '@st/ui';
import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

export function Glass({ children, radius, style }: { children: ReactNode; radius: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  return (
    <View
      style={[
        {
          borderRadius: radius,
          boxShadow: dark ? '0px 8px 24px rgba(0,0,0,0.45)' : '0px 6px 20px rgba(18,17,41,0.12), 0px 1px 3px rgba(18,17,41,0.08)',
        },
        style,
      ]}
    >
      <BlurView
        intensity={dark ? 40 : 60}
        tint={dark ? 'dark' : 'light'}
        style={{
          borderRadius: radius,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)',
          backgroundColor: theme.colors.surfaceGlass,
        }}
      >
        {children}
      </BlurView>
    </View>
  );
}
