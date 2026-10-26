import { type ComponentRef, type Ref } from "react";
import { Animated, Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

import { isolate } from "../bidi";
import { Haptics } from "../haptics";
import { Icon, type IconWeight } from "../icons/Icon";
import type { IconName } from "../icons/registry";
import { useTheme } from "../theme";
import { borderWidth, radius, sizing, type ColorToken, type HapticEvent } from "../tokens";
import { Text } from "./Text";
import { usePressScale } from "./usePressScale";

/**
 * plain: icon only · tonal: sunken fill · filled: brand fill · glass: translucent surface with
 * shadow, for controls floating over the map or media · inverse: ink fill (on light media).
 */
export type IconButtonVariant = "plain" | "tonal" | "filled" | "glass" | "inverse";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends Omit<PressableProps, "children" | "style"> {
  icon: IconName;
  /** Required: icon-only controls must have a spoken name ("Back", "Settings", "Locate me"). */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** `fill` for the selected state of toggles (e.g. favorite). */
  weight?: IconWeight;
  color?: ColorToken | (string & {});
  /** Toggle buttons: sets aria-pressed and fills the icon. */
  selected?: boolean;
  /** Small count/dot badge at the top-end corner (e.g. unread). */
  badge?: number | boolean;
  haptic?: HapticEvent | "none";
  style?: StyleProp<ViewStyle>;
}

const dims: Record<IconButtonSize, number> = { sm: 36, md: 44, lg: 52 };
const glyph: Record<IconButtonSize, number> = { sm: 20, md: 22, lg: 24 };

/** Round icon-only button with 48dp hit area, spring press and optional badge. */
export function IconButton({
  icon,
  label,
  variant = "plain",
  size = "md",
  weight,
  color,
  selected,
  badge,
  haptic = "none",
  disabled,
  style,
  onPress,
  onPressIn,
  onPressOut,
  ref,
  ...rest
}: IconButtonProps & { ref?: Ref<ComponentRef<typeof View>> }) {
  const theme = useTheme();
  const c = theme.colors;
  const d = dims[size];
  const slop = Math.max(0, (sizing.touchTarget - d) / 2);
  const press = usePressScale(0.92);
  const bg =
    variant === "filled" ? c.primary : variant === "tonal" ? c.surfaceSunken : variant === "glass" ? c.surface : variant === "inverse" ? c.surfaceInverse : "transparent";
  const fg: ColorToken | string =
    color ?? (variant === "filled" ? "onPrimary" : variant === "inverse" ? "textInverse" : selected ? "primary" : "text");
  const count = typeof badge === "number" ? (badge > 99 ? "99+" : String(badge)) : null;

  return (
    <Animated.View style={[press.style, style]}>
      <Pressable
        ref={ref}
        role="button"
        aria-label={label}
        aria-pressed={selected}
        aria-disabled={Boolean(disabled)}
        disabled={disabled}
        hitSlop={slop || undefined}
        onPressIn={(e) => {
          press.onPressIn();
          onPressIn?.(e);
        }}
        onPressOut={(e) => {
          press.onPressOut();
          onPressOut?.(e);
        }}
        onPress={(e) => {
          if (haptic !== "none") Haptics.trigger(haptic);
          onPress?.(e);
        }}
        style={(st) => {
          const { pressed, focused } = st as { pressed: boolean; focused?: boolean };
          return {
            width: d,
            height: d,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed && variant === "plain" ? c.surfaceSunken : bg,
            opacity: disabled ? 0.45 : pressed && variant !== "plain" ? 0.88 : 1,
            ...(variant === "glass" ? theme.elevation(2) : null),
            ...(focused
              ? { outlineColor: c.focusRing, outlineWidth: borderWidth.focus, outlineStyle: "solid", outlineOffset: 2 }
              : null),
          } as ViewStyle;
        }}
        {...rest}
      >
        <Icon name={icon} size={glyph[size]} weight={weight ?? (selected ? "fill" : "regular")} color={fg} />
        {badge ? (
          <View
            aria-hidden
            style={{
              position: "absolute",
              top: count ? -2 : 4,
              end: count ? -4 : 4,
              minWidth: count ? 18 : 10,
              height: count ? 18 : 10,
              paddingStart: count ? 4 : 0,
              paddingEnd: count ? 4 : 0,
              borderRadius: radius.pill,
              backgroundColor: c.danger,
              borderWidth: 2,
              borderColor: variant === "glass" ? c.surface : c.background,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {count ? <BadgeCount value={count} /> : null}
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function BadgeCount({ value }: { value: string }) {
  return (
    <Text variant="caption" color="onDanger" weight="bold" allowFontScaling={false} style={{ fontSize: 10, lineHeight: 12 }}>
      {isolate(value, "ltr")}
    </Text>
  );
}
