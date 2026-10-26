import type { ComponentRef, Ref } from "react";
import { View, type ViewProps, type ViewStyle } from "react-native";

import { spacing, type SpaceToken } from "../tokens";

type Align = "start" | "center" | "end" | "stretch" | "baseline";
type Justify = "start" | "center" | "end" | "between" | "around" | "evenly";

export interface StackProps extends ViewProps {
  ref?: Ref<ComponentRef<typeof View>>;
  gap?: SpaceToken;
  /** Cross-axis alignment. "start"/"end" are logical (follow layout direction). */
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
  padding?: SpaceToken;
  paddingInline?: SpaceToken;
  paddingBlock?: SpaceToken;
  flex?: number;
}

const alignMap: Record<Align, ViewStyle["alignItems"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline",
};
const justifyMap: Record<Justify, ViewStyle["justifyContent"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};

function layout(direction: "row" | "column", p: StackProps): ViewStyle {
  return {
    flexDirection: direction,
    ...(p.gap ? { gap: spacing[p.gap] } : null),
    ...(p.align ? { alignItems: alignMap[p.align] } : null),
    ...(p.justify ? { justifyContent: justifyMap[p.justify] } : null),
    ...(p.wrap ? { flexWrap: "wrap" } : null),
    ...(p.padding ? { padding: spacing[p.padding] } : null),
    ...(p.paddingInline ? { paddingStart: spacing[p.paddingInline], paddingEnd: spacing[p.paddingInline] } : null),
    ...(p.paddingBlock ? { paddingTop: spacing[p.paddingBlock], paddingBottom: spacing[p.paddingBlock] } : null),
    ...(p.flex !== undefined ? { flex: p.flex } : null),
  };
}

/** Vertical stack with token gap. */
export function Stack(props: StackProps) {
  const {
    ref,
    gap: _g,
    align: _a,
    justify: _j,
    wrap: _w,
    padding: _p,
    paddingInline: _pi,
    paddingBlock: _pb,
    flex: _f,
    style,
    ...rest
  } = props;
  return <View ref={ref} style={[layout("column", props), style]} {...rest} />;
}

/**
 * Horizontal row. `flexDirection: "row"` already flows start→end, so it mirrors in RTL
 * automatically. Never reverse rows to fake RTL.
 */
export function Row(props: StackProps) {
  const {
    ref,
    gap: _g,
    align = "center",
    justify: _j,
    wrap: _w,
    padding: _p,
    paddingInline: _pi,
    paddingBlock: _pb,
    flex: _f,
    style,
    ...rest
  } = props;
  return <View ref={ref} style={[layout("row", { ...props, align }), style]} {...rest} />;
}
