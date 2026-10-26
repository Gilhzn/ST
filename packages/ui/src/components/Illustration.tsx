import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, Rect, Stop } from "react-native-svg";

import { SportGlyphBadge } from "../icons/Icon";
import { useTheme } from "../theme";
import { palette, radius, spacing, sportColors, type SportKey } from "../tokens";
import { Text } from "./Text";

export type IllustrationName =
  | "emptyGames"
  | "noChat"
  | "noNotifications"
  | "success"
  | "location"
  | "ageGate"
  | "offline"
  | "error";

export interface IllustrationProps {
  name: IllustrationName;
  /** Square size in dp. Default 160. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Spot illustrations drawn from SVG shapes only (no bitmaps), themed from tokens so they work
 * in light and dark. Decorative (hidden from assistive tech): the copy next to them carries meaning.
 * Language-neutral: no text inside the artwork.
 */
export function Illustration({ name, size = 160, style }: IllustrationProps) {
  const theme = useTheme();
  const dark = theme.scheme === "dark";
  const c = theme.colors;
  const k = {
    blob: dark ? "#1F1B4A" : "#ECE9FF",
    blob2: dark ? "#17162E" : "#F6F5FF",
    card: dark ? palette.ink800 : "#FFFFFF",
    line: dark ? palette.ink700 : "#E3E2EE",
    ink: dark ? palette.ink300 : palette.ink350,
    brand: c.primary,
    brandDeep: dark ? palette.indigo300 : palette.indigo700,
    volt: palette.volt400,
    shadow: dark ? "rgba(0, 0, 0, 0.35)" : "rgba(18, 17, 41, 0.10)",
  };
  return (
    <View aria-hidden style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 160 160">
        <Defs>
          <LinearGradient id="st-ill-brand" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#7A61FF" />
            <Stop offset="1" stopColor="#3C1FC7" />
          </LinearGradient>
          <LinearGradient id="st-ill-volt" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#E1FF66" />
            <Stop offset="1" stopColor="#B8F000" />
          </LinearGradient>
        </Defs>
        {/* backdrop */}
        <Circle cx={80} cy={78} r={64} fill={k.blob} />
        <Circle cx={128} cy={34} r={10} fill={k.blob2} />
        <Ellipse cx={80} cy={140} rx={46} ry={5} fill={k.shadow} />
        {art(name, k)}
      </Svg>
    </View>
  );
}

type Kit = Record<"blob" | "blob2" | "card" | "line" | "ink" | "brand" | "brandDeep" | "volt" | "shadow", string>;

function sparkle(x: number, y: number, s: number, fill: string) {
  return <Path d={`M${x} ${y - s} L${x + s * 0.28} ${y - s * 0.28} L${x + s} ${y} L${x + s * 0.28} ${y + s * 0.28} L${x} ${y + s} L${x - s * 0.28} ${y + s * 0.28} L${x - s} ${y} L${x - s * 0.28} ${y - s * 0.28} Z`} fill={fill} />;
}

/** The brand's volt ball (same motif as the BrandMark): volt disc, two seams, soft highlight. */
function voltBall(cx: number, cy: number, r: number) {
  return (
    <G>
      <Circle cx={cx} cy={cy + r * 0.12} r={r} fill="#121129" opacity={0.12} />
      <Circle cx={cx} cy={cy} r={r} fill="url(#st-ill-volt)" />
      <Path d={`M${cx - r * 0.95} ${cy - r * 0.25} C${cx - r * 0.3} ${cy - r * 0.05} ${cx + r * 0.3} ${cy - r * 0.05} ${cx + r * 0.95} ${cy - r * 0.35}`} stroke="#121129" strokeOpacity={0.45} strokeWidth={r * 0.1} fill="none" strokeLinecap="round" />
      <Path d={`M${cx - r * 0.75} ${cy + r * 0.62} C${cx - r * 0.2} ${cy + r * 0.38} ${cx + r * 0.3} ${cy + r * 0.4} ${cx + r * 0.8} ${cy + r * 0.58}`} stroke="#121129" strokeOpacity={0.45} strokeWidth={r * 0.1} fill="none" strokeLinecap="round" />
      <Circle cx={cx - r * 0.38} cy={cy - r * 0.5} r={r * 0.18} fill="#FFFFFF" opacity={0.6} />
    </G>
  );
}

function art(name: IllustrationName, k: Kit): ReactNode {
  switch (name) {
    case "emptyGames":
      return (
        <G>
          {/* calendar card */}
          <Rect x={34} y={44} width={78} height={80} rx={14} fill={k.card} />
          <Rect x={34} y={44} width={78} height={22} rx={14} fill="url(#st-ill-brand)" />
          <Rect x={34} y={56} width={78} height={10} fill="url(#st-ill-brand)" />
          <Rect x={50} y={36} width={6} height={16} rx={3} fill={k.brandDeep} />
          <Rect x={90} y={36} width={6} height={16} rx={3} fill={k.brandDeep} />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3].map((col) => <Rect key={`${r}-${col}`} x={44 + col * 16} y={76 + r * 14} width={10} height={8} rx={3} fill={r === 1 && col === 2 ? k.brand : k.line} />),
          )}
          {/* ball */}
          {voltBall(114, 108, 19)}
          <Path d="M88 128 C96 132 104 132 110 130" stroke={k.ink} strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round" fill="none" />
          {sparkle(126, 64, 7, k.volt)}
          {sparkle(30, 100, 4, k.brand)}
        </G>
      );
    case "noChat":
      return (
        <G>
          <Rect x={26} y={44} width={76} height={50} rx={18} fill={k.card} />
          <Path d="M40 92 L36 106 L54 94 Z" fill={k.card} />
          {[48, 62, 76].map((x) => (
            <Circle key={x} cx={x} cy={69} r={5} fill={k.line} />
          ))}
          <Rect x={62} y={78} width={74} height={46} rx={18} fill="url(#st-ill-brand)" />
          <Path d="M120 122 L128 134 L110 124 Z" fill="#4A2BE6" />
          <Rect x={76} y={94} width={44} height={6} rx={3} fill="#FFFFFF" opacity={0.9} />
          <Rect x={76} y={106} width={28} height={6} rx={3} fill="#FFFFFF" opacity={0.6} />
          {sparkle(132, 60, 7, k.volt)}
        </G>
      );
    case "noNotifications":
      return (
        <G>
          <Path d="M80 34 C60 34 50 50 50 68 L50 90 L42 102 L118 102 L110 90 L110 68 C110 50 100 34 80 34 Z" fill="url(#st-ill-brand)" />
          <Path d="M66 106 C66 114 72 120 80 120 C88 120 94 114 94 106 Z" fill={k.brandDeep} />
          <Rect x={74} y={26} width={12} height={12} rx={6} fill={k.brandDeep} />
          <Path d="M62 54 C64 48 68 45 72 44" stroke="#FFFFFF" strokeOpacity={0.5} strokeWidth={4} strokeLinecap="round" fill="none" />
          <Circle cx={112} cy={46} r={11} fill="url(#st-ill-volt)" />
          <Path d="M107 46 L111 50 L118 42" stroke="#121129" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {sparkle(36, 56, 5, k.volt)}
        </G>
      );
    case "success":
      return (
        <G>
          <Circle cx={80} cy={80} r={42} fill="url(#st-ill-brand)" />
          <Circle cx={80} cy={80} r={52} fill="none" stroke={k.brand} strokeOpacity={0.25} strokeWidth={4} />
          <Path d="M62 81 L75 94 L100 67" stroke="#FFFFFF" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Rect x={28} y={42} width={10} height={5} rx={2.5} fill={sportColors.football.color} transform="rotate(-30 33 44)" />
          <Rect x={122} y={40} width={10} height={5} rx={2.5} fill={sportColors.basketball.color} transform="rotate(35 127 42)" />
          <Rect x={132} y={98} width={10} height={5} rx={2.5} fill={sportColors.volleyball.color} transform="rotate(-20 137 100)" />
          <Rect x={22} y={104} width={10} height={5} rx={2.5} fill={sportColors.running.color} transform="rotate(25 27 106)" />
          <Circle cx={118} cy={128} r={4} fill={sportColors.padel.color} />
          <Circle cx={40} cy={130} r={3} fill={sportColors.tennis.color} />
          {sparkle(130, 70, 6, k.volt)}
          {sparkle(30, 76, 5, k.volt)}
        </G>
      );
    case "location":
      return (
        <G>
          <Rect x={28} y={50} width={104} height={78} rx={16} fill={k.card} />
          <Path d="M28 96 C56 84 78 108 132 86" stroke={k.line} strokeWidth={8} fill="none" />
          <Path d="M64 50 L84 128" stroke={k.line} strokeWidth={6} />
          <Circle cx={80} cy={88} r={30} fill={k.brand} fillOpacity={0.12} stroke={k.brand} strokeOpacity={0.5} strokeWidth={2} strokeDasharray="4 5" />
          <Path d="M80 92 C74 85 62 75 62 62 C62 52 70 44 80 44 C90 44 98 52 98 62 C98 75 86 85 80 92 Z" fill="url(#st-ill-brand)" stroke="#FFFFFF" strokeWidth={3} />
          <Circle cx={80} cy={62} r={7} fill="#FFFFFF" />
          {sparkle(124, 40, 6, k.volt)}
        </G>
      );
    case "ageGate":
      return (
        <G>
          <Rect x={26} y={50} width={96} height={66} rx={14} fill={k.card} />
          <Rect x={26} y={50} width={96} height={16} rx={14} fill="url(#st-ill-brand)" />
          <Rect x={26} y={58} width={96} height={8} fill="url(#st-ill-brand)" />
          <Circle cx={50} cy={88} r={12} fill={k.line} />
          <Circle cx={50} cy={84} r={5} fill={k.ink} opacity={0.5} />
          <Path d="M41 97 C43 92 57 92 59 97" fill={k.ink} opacity={0.5} />
          <Rect x={70} y={80} width={40} height={6} rx={3} fill={k.line} />
          <Rect x={70} y={92} width={26} height={6} rx={3} fill={k.line} />
          <Path d="M118 84 L136 90 L136 104 C136 116 128 124 118 128 C108 124 100 116 100 104 L100 90 Z" fill="url(#st-ill-volt)" stroke="#FFFFFF" strokeWidth={3} />
          <Path d="M110 105 L116 111 L127 99" stroke="#121129" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </G>
      );
    case "offline":
      return (
        <G>
          <Path d="M40 74 C60 52 100 52 120 74" stroke={k.line} strokeWidth={9} strokeLinecap="round" fill="none" />
          <Path d="M54 90 C68 76 92 76 106 90" stroke={k.brand} strokeOpacity={0.5} strokeWidth={9} strokeLinecap="round" fill="none" />
          <Circle cx={80} cy={106} r={8} fill={k.brand} />
          <Line x1={44} y1={48} x2={118} y2={122} stroke={k.brandDeep} strokeWidth={7} strokeLinecap="round" />
        </G>
      );
    case "error":
      return (
        <G>
          <Circle cx={80} cy={80} r={40} fill="url(#st-ill-brand)" />
          <Rect x={75} y={58} width={10} height={30} rx={5} fill="#FFFFFF" />
          <Circle cx={80} cy={100} r={6} fill="#FFFFFF" />
          {sparkle(126, 50, 6, k.volt)}
        </G>
      );
  }
}

export interface BrandMarkProps {
  /** Mark size (square). Default 40. */
  size?: number;
  /** Show the "Sport Talent" wordmark next to the mark. */
  wordmark?: boolean;
  /** Wordmark color on media (white) vs on surfaces (text). */
  onMedia?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Brand mark: indigo squircle, volt ball with a motion arc. Logos never mirror. */
export function BrandMark({ size = 40, wordmark, onMedia, style }: BrandMarkProps) {
  return (
    <View role="img" aria-label="Sport Talent" style={[{ flexDirection: "row", alignItems: "center", gap: spacing.sm }, style]}>
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Defs>
          <LinearGradient id="st-mark" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#7A61FF" />
            <Stop offset="1" stopColor="#3C1FC7" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={40} height={40} rx={12} fill="url(#st-mark)" />
        <Path d="M8 28 C12 16 20 10 31 9" stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={2.6} strokeLinecap="round" fill="none" />
        <Path d="M9 33 C15 24 22 20 30 19" stroke="#FFFFFF" strokeOpacity={0.3} strokeWidth={2.2} strokeLinecap="round" fill="none" />
        <Circle cx={27} cy={26} r={7.5} fill="#CCFF33" />
        <Path d="M21.5 23.5 C25 25 29 25 33 22.5 M23 30.5 C26 28.5 30 28.6 33.6 30" stroke="#121129" strokeOpacity={0.55} strokeWidth={1.4} fill="none" />
      </Svg>
      {wordmark ? (
        <Text variant="title3" weight="heavy" color={onMedia ? "textOnMedia" : "text"} role="none" style={{ letterSpacing: -0.3 }}>
          Sport Talent
        </Text>
      ) : null}
    </View>
  );
}

export interface AuthHeroProps {
  title: string;
  subtitle?: string;
  /** Height of the art panel. Default 380. */
  height?: number;
  /** Sports floating in the art (default: four launch sports). */
  sports?: SportKey[];
  /** Safe-area top inset. */
  topInset?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Onboarding / auth hero: night-stadium panel (brand-night gradient, floodlight beams,
 * pitch lines in SVG), floating sport glyph badges, the brand mark, and a display headline.
 * Always dark (white text ≥ 4.5:1 on every stop) in both schemes; bottom corners radius 28.
 */
export function AuthHero({ title, subtitle, height = 380, sports = ["football", "basketball", "tennis", "padel"], topInset = 0, style }: AuthHeroProps) {
  const { isRTL } = useTheme();
  // Floating glyphs live in the upper-end quadrant; the headline owns the lower half.
  const spots: { x: number; y: number; s: number }[] = [
    { x: 0.62, y: 0.2, s: 52 },
    { x: 0.82, y: 0.1, s: 36 },
    { x: 0.8, y: 0.33, s: 40 },
    { x: 0.5, y: 0.37, s: 30 },
  ];
  return (
    <View style={[{ height: height + topInset, borderBottomStartRadius: radius.xl, borderBottomEndRadius: radius.xl, overflow: "hidden", backgroundColor: "#0B0A1C" }, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 400 380" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", top: 0, start: 0, ...(isRTL ? { transform: [{ scaleX: -1 }] } : null) }}>
        <Defs>
          <LinearGradient id="st-hero-bg" x1="0" y1="0" x2="0.4" y2="1">
            <Stop offset="0" stopColor="#2B1890" />
            <Stop offset="0.55" stopColor="#17123A" />
            <Stop offset="1" stopColor="#0B0A1C" />
          </LinearGradient>
          <LinearGradient id="st-hero-beam" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id="st-hero-glow" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#CCFF33" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#CCFF33" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={400} height={380} fill="url(#st-hero-bg)" />
        {/* floodlight beams from the top-end corner */}
        <Polygon points="330,-10 352,-10 430,240 250,240" fill="url(#st-hero-beam)" />
        <Polygon points="372,-10 388,-10 470,180 330,190" fill="url(#st-hero-beam)" opacity={0.55} />
        {/* pitch in perspective, kept below the headline's cap height and very faint */}
        <G opacity={0.1} stroke="#FFFFFF" strokeWidth={1.5} fill="none">
          <Path d="M-40 400 L150 250 L470 250 L520 400" />
          <Path d="M310 250 L330 400" />
          <Ellipse cx={322} cy={318} rx={58} ry={18} />
        </G>
        {/* ball flight */}
        <Path d="M150 200 C200 110 260 70 352 56" stroke="#CCFF33" strokeOpacity={0.65} strokeWidth={2.5} strokeDasharray="2 9" strokeLinecap="round" fill="none" />
        <Circle cx={360} cy={54} r={8} fill="#CCFF33" />
        <Circle cx={360} cy={54} r={18} fill="url(#st-hero-glow)" opacity={0.5} />
        {/* stars */}
        {[
          [40, 92],
          [96, 120],
          [170, 70],
          [230, 30],
          [26, 160],
        ].map(([x, y]) => (
          <Circle key={`${x}-${y}`} cx={x} cy={y} r={1.4} fill="#FFFFFF" opacity={0.55} />
        ))}
      </Svg>
      {sports.slice(0, 4).map((s, i) => {
        const p = spots[i]!;
        return (
          <View key={s} style={{ position: "absolute", top: topInset + p.y * height, start: `${p.x * 100}%`, transform: [{ rotate: `${i % 2 ? 8 : -6}deg` }] }}>
            <SportGlyphBadge sport={s} size={p.s} variant="solid" squircle />
          </View>
        );
      })}
      <View style={{ flex: 1, justifyContent: "flex-end", paddingTop: topInset + spacing.xl, paddingStart: spacing.xl, paddingEnd: spacing.xl, paddingBottom: spacing.xl, gap: spacing.md }}>
        <View style={{ position: "absolute", top: topInset + spacing.xl, start: spacing.xl }}>
          <BrandMark size={36} wordmark onMedia />
        </View>
        <Text variant="display" color="textOnMedia" style={{ maxWidth: 320 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" color="textOnMedia" style={{ opacity: 0.82, maxWidth: 320 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
