import { Animated, Platform, Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import { isolate } from "../bidi";
import { Icon, SportGlyphBadge } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { useTheme } from "../theme";
import { borderWidth, motion, radius, sportColors, spacing, type ReliabilityStatus, type SportKey } from "../tokens";
import { AvatarStack } from "./Avatar";
import { BidiText } from "./BidiText";
import { Gradient } from "./Gradient";
import { ProgressRing } from "./ProgressRing";
import { StatusBadge, StatusPill, type PillTone } from "./StatusBadge";
import { Text } from "./Text";
import { usePressScale } from "./usePressScale";
import { showFocusRing } from "../focusVisible";

export interface GameHeroCardProps {
  sport: SportKey;
  /** Eyebrow on the band: "Football · 5v5". */
  sportLabel: string;
  /** Game title or venue name (user content → BidiText). */
  title: string;
  /** Venue name / area (user content). */
  venue: string;
  /** Big start time, pre-formatted for the locale: "18:00", "6:30 PM". Rendered as an LTR isolate. */
  timeLabel: string;
  /** "Today", "Tomorrow", "Sat 2 Nov". */
  dayLabel: string;
  /** "in 45 min" (optional, shown after the day). */
  relativeLabel?: string;
  /** "1.2 km" (pre-formatted, miles where appropriate). */
  distanceLabel?: string;
  filled: number;
  capacity: number;
  /** Localized "7 of 10 players". */
  playersLabel: string;
  /** Preview of joined players for the avatar stack. */
  people?: ReadonlyArray<{ name: string; uri?: string | null }>;
  /** Spoken summary of the stack ("Dana, Yossi and 5 others"). */
  peopleLabel?: string;
  /** "₪20 deposit" → deposit chip. */
  depositLabel?: string;
  /** Status pill on the band (Open · Filling fast · Full · Live · Joined · Waitlist #2). */
  status?: { label: string; tone?: PillTone; icon?: IconName };
  /** Extra chips (Women only, Private, Beginner friendly). */
  tags?: ReadonlyArray<{ label: string; icon?: IconName }>;
  /** Host reliability badge (first chip in the tag row). */
  hostReliability?: { status: ReliabilityStatus; label: string; percent?: number };
  /** One spoken summary for the whole card. Required (cards are a single focus stop). */
  accessibilityLabel: string;
  onPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The v2 game card: sport gradient band (glyph, sport, big time, status pill, watermark glyph),
 * then title, venue · distance, tags/deposit, and a footer with the avatar stack, players text
 * and a filled/total progress ring. Presentational only (props in, onPress out).
 */
export function GameHeroCard(props: GameHeroCardProps) {
  const {
    sport,
    sportLabel,
    title,
    venue,
    timeLabel,
    dayLabel,
    relativeLabel,
    distanceLabel,
    filled,
    capacity,
    playersLabel,
    people,
    peopleLabel,
    depositLabel,
    status,
    tags,
    hostReliability,
    accessibilityLabel,
    onPress,
    testID,
    style,
  } = props;
  const theme = useTheme();
  const c = theme.colors;
  const press = usePressScale(motion.pressedScaleCard);
  const ratio = capacity > 0 ? filled / capacity : 0;
  const full = capacity > 0 && filled >= capacity;
  const ringColor = full ? c.textTertiary : ratio >= 0.75 ? sportColors[sport].gradient[0] : c.primary;

  const body = (
    <View style={{ borderRadius: radius.lg, overflow: "hidden", backgroundColor: c.surface }}>
      {/* Band */}
      <Gradient name={sport} style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.lg, minHeight: 104, overflow: "hidden" }}>
        <View aria-hidden style={{ position: "absolute", end: -18, bottom: -34, opacity: 0.16 }}>
          <Icon name={sportColors[sport].phosphor} size={132} weight="fill" color="#FFFFFF" directional={false} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
          <SportGlyphBadge sport={sport} size={44} variant="glass" squircle />
          <View style={{ flex: 1, gap: 2 }}>
            {/* The status pill shares the overline row, so the day line below gets the full width
                ("Today · in 34 minutes" truncated next to "On the waitlist" before). */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 24 }}>
              <Text variant="overline" color="textOnMedia" numberOfLines={1} style={{ opacity: 0.88, flex: 1 }}>
                {sportLabel}
              </Text>
              {status ? <StatusPill label={status.label} tone={status.tone ?? "glass"} icon={status.icon} /> : null}
            </View>
            <Text variant="title1" weight="bold" color="textOnMedia" role="none" style={{ fontVariant: ["tabular-nums"], letterSpacing: -0.6 }}>
              {isolate(timeLabel, "ltr")}
            </Text>
            <Text variant="footnote" weight="medium" color="textOnMedia" numberOfLines={1} style={{ opacity: 0.92 }}>
              {relativeLabel ? `${dayLabel} · ${relativeLabel}` : dayLabel}
            </Text>
          </View>
        </View>
      </Gradient>

      {/* Body */}
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ gap: spacing.xs }}>
          <BidiText variant="title3" numberOfLines={2} role="none">
            {title}
          </BidiText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Icon name="MapPin" size={16} weight="fill" color="textTertiary" />
            <BidiText variant="footnote" color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {venue}
            </BidiText>
            {distanceLabel ? (
              <>
                <Text variant="footnote" color="textTertiary" aria-hidden>
                  ·
                </Text>
                <Text variant="footnote" weight="medium" color="textSecondary" numberOfLines={1}>
                  {isolate(distanceLabel, "ltr")}
                </Text>
              </>
            ) : null}
          </View>
        </View>

        {depositLabel || tags?.length || hostReliability ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2 }}>
            {hostReliability ? <StatusBadge size="sm" status={hostReliability.status} label={hostReliability.label} percent={hostReliability.percent} /> : null}
            {depositLabel ? <StatusPill label={depositLabel} tone="warning" icon="Coins" /> : null}
            {tags?.map((t) => <StatusPill key={t.label} label={t.label} tone="neutral" icon={t.icon} />)}
          </View>
        ) : null}

        <View aria-hidden style={{ height: 1, backgroundColor: c.border }} />

        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          {people?.length ? <AvatarStack people={people} total={filled} max={4} size="sm" label={peopleLabel ?? playersLabel} /> : null}
          <View style={{ flex: 1, gap: 0 }}>
            <Text variant="statSmall" role="none">
              {isolate(`${filled}/${capacity}`, "ltr")}
            </Text>
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {playersLabel}
            </Text>
          </View>
          <ProgressRing progress={ratio} size={40} thickness={4} color={ringColor}>
            <Icon name={full ? "LockSimple" : "Users"} size={16} weight="fill" color={full ? "textTertiary" : "textSecondary"} />
          </ProgressRing>
        </View>
      </View>
    </View>
  );

  const shell: ViewStyle = { borderRadius: radius.lg, ...theme.elevation(theme.scheme === "dark" ? 1 : 2) };

  if (!onPress) {
    return (
      <View testID={testID} accessible role="group" aria-label={accessibilityLabel} style={[shell, style]}>
        <View aria-hidden>{body}</View>
      </View>
    );
  }
  return (
    <Animated.View style={[press.style, style]}>
      <Pressable
        testID={testID}
        role="button"
        // Web: the name comes from the visible card text (WCAG 2.5.3 label in name — a summary
        // label that differs from what sighted voice-control users see fails it). Native keeps
        // the one-sentence summary for VoiceOver/TalkBack.
        aria-label={Platform.OS === "web" ? undefined : accessibilityLabel}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={(st) => {
          const { focused: rawFocused } = st as { focused?: boolean };
          const focused = showFocusRing(rawFocused);
          return [
            shell,
            focused ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: 2 } : null,
          ];
        }}
      >
        {body}
      </Pressable>
    </Animated.View>
  );
}
