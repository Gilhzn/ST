/**
 * GPS "radar" (design v2 §15.8): a progress ring (readings taken) around a small map-like
 * scope centred on the venue pin, with the allowed radius as a dashed circle, each reading
 * as a numbered dot at its real offset, and a pulse while sampling. Like the map, the scope
 * never mirrors in RTL (north stays up, east stays right); the ring does.
 * Decorative: the screen announces progress in text.
 */
import { DEFAULT_TRUST_CONFIG, haversineMeters, type GpsSample, type LatLng } from '@st/domain';
import { Icon, ProgressRing, useTheme } from '@st/ui';
import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';

const M_PER_DEG_LAT = 110_540;

/** Offset of `p` from `origin` in metres (east, north); fine at venue scale. */
function offset(origin: LatLng, p: LatLng): { east: number; north: number } {
  return {
    east: (p.lng - origin.lng) * Math.cos((origin.lat * Math.PI) / 180) * 111_320,
    north: (p.lat - origin.lat) * M_PER_DEG_LAT,
  };
}

/** Mean position of the readings. */
export function centroid(samples: readonly GpsSample[]): LatLng | null {
  if (!samples.length) return null;
  return {
    lat: samples.reduce((a, s) => a + s.lat, 0) / samples.length,
    lng: samples.reduce((a, s) => a + s.lng, 0) / samples.length,
  };
}

export function distanceToPin(samples: readonly GpsSample[], pin: LatLng | null): number | null {
  const c = centroid(samples);
  return c && pin ? haversineMeters(c, pin) : null;
}

export function GpsRadar({
  samples,
  total,
  pin,
  active,
  done,
  size = 220,
}: {
  samples: readonly GpsSample[];
  total: number;
  pin: LatLng | null;
  active: boolean;
  done?: boolean;
  size?: number;
}) {
  const theme = useTheme();
  const c = theme.colors;
  const ring = 12;
  const inner = size - ring * 2 - 16;
  const r = inner / 2;
  const allowed = DEFAULT_TRUST_CONFIG.gpsBaseRadiusM;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || theme.reducedMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [active, theme.reducedMotion, pulse]);

  // Scale: the allowed radius sits at 45% of the scope, widened when a reading lands further out.
  const offsets = pin ? samples.map((s) => offset(pin, s)) : samples.map(() => ({ east: 0, north: 0 }));
  const far = Math.max(allowed / 0.45, ...offsets.map((o) => Math.hypot(o.east, o.north) / 0.85));
  const px = (m: number) => (m / far) * r;
  const dark = theme.scheme === 'dark';
  const gridColor = dark ? 'rgba(170, 157, 255, 0.22)' : 'rgba(91, 61, 245, 0.16)';
  const scopeBg = dark ? '#151338' : '#F3F1FF';

  return (
    <View aria-hidden style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <ProgressRing
        progress={done ? 1 : samples.length / total}
        size={size}
        thickness={ring}
        gradient={done ? [c.success, c.success] : (theme.gradients.brand.colors as unknown as readonly [string, string])}
        style={{ position: 'absolute' }}
      />
      <View style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: scopeBg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {active && !theme.reducedMotion ? (
          <Animated.View
            style={{
              position: 'absolute',
              width: inner,
              height: inner,
              borderRadius: inner / 2,
              borderWidth: 2,
              borderColor: c.primary,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }) }],
            }}
          />
        ) : null}
        <Svg width={inner} height={inner} style={{ position: 'absolute' }}>
          <G>
            <Line x1={r} y1={6} x2={r} y2={inner - 6} stroke={gridColor} strokeWidth={1} />
            <Line x1={6} y1={r} x2={inner - 6} y2={r} stroke={gridColor} strokeWidth={1} />
            <Circle cx={r} cy={r} r={r * 0.9} stroke={gridColor} strokeWidth={1} fill="none" />
            <Circle cx={r} cy={r} r={r * 0.62} stroke={gridColor} strokeWidth={1} fill="none" />
            {pin ? (
              <Circle cx={r} cy={r} r={px(allowed)} stroke={done ? c.success : c.primary} strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="4 4" fill={done ? c.success : c.primary} fillOpacity={0.08} />
            ) : null}
            {offsets.map((o, i) => {
              const x = r + px(o.east);
              const y = r - px(o.north);
              const acc = Math.min(r, px(samples[i]?.accuracyM ?? 0));
              return (
                <G key={i}>
                  {pin && acc > 6 ? <Circle cx={x} cy={y} r={acc} fill={c.primary} fillOpacity={0.1} /> : null}
                  <Circle cx={x} cy={y} r={9} fill={done ? c.success : c.primary} stroke={scopeBg} strokeWidth={2} />
                  <SvgText x={x} y={y + 3.5} fontSize={10} fontWeight="700" fill="#FFFFFF" textAnchor="middle">
                    {String(i + 1)}
                  </SvgText>
                </G>
              );
            })}
          </G>
        </Svg>
        {pin || !samples.length ? (
          <View style={{ marginTop: -18 }}>
            <Icon name="MapPin" size={34} weight="fill" color={done ? 'success' : 'primary'} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Signal quality from the best accuracy, against the server's accuracy limit. */
export function signalQuality(accuracyM: number | null): 'good' | 'fair' | 'poor' | null {
  if (accuracyM === null) return null;
  const max = DEFAULT_TRUST_CONFIG.gpsMaxAccuracyM;
  if (accuracyM <= max * 0.6) return 'good';
  if (accuracyM <= max) return 'fair';
  return 'poor';
}

/** Four rising bars (like a phone's signal icon). Paired with a text label. */
export function SignalBars({ quality }: { quality: 'good' | 'fair' | 'poor' | null }) {
  const { colors } = useTheme();
  const filled = quality === 'good' ? 4 : quality === 'fair' ? 3 : quality === 'poor' ? 1 : 0;
  const color = quality === 'good' ? colors.success : quality === 'fair' ? colors.warning : colors.danger;
  return (
    <View aria-hidden style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 }}>
      {[5, 8, 11, 14].map((h, i) => (
        <View key={i} style={{ width: 4, height: h, borderRadius: 1.5, backgroundColor: i < filled ? color : colors.surfaceSunken }} />
      ))}
    </View>
  );
}
