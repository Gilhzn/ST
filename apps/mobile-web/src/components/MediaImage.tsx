/**
 * A Media Vault image that fills its box (cover). Generated demo scenes arrive as
 * `data:image/svg+xml` URIs and render with react-native-svg on every platform; real photos
 * (signed URLs, picked files) render with expo-image. Decorative unless `label` is given.
 */
import { useTheme } from '@st/ui';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

const SVG_PREFIX = 'data:image/svg+xml;utf8,';

export function MediaImage({
  uri,
  width,
  height,
  radius = 0,
  label,
  style,
  testID,
}: {
  uri: string | null | undefined;
  width: number | `${number}%`;
  height: number | `${number}%`;
  radius?: number;
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const theme = useTheme();
  const xml = useMemo(() => {
    if (!uri || !uri.startsWith(SVG_PREFIX)) return null;
    try {
      return decodeURIComponent(uri.slice(SVG_PREFIX.length));
    } catch {
      return null;
    }
  }, [uri]);
  return (
    <View
      testID={testID}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={[{ width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }, style]}
    >
      {xml ? (
        <SvgXml xml={xml} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />
      ) : uri ? (
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={150} accessible={false} />
      ) : null}
    </View>
  );
}
