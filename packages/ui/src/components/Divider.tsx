import { View, type ViewProps } from "react-native";

import { useTheme } from "../theme";
import { spacing, type SpaceToken } from "../tokens";

export interface DividerProps extends ViewProps {
  vertical?: boolean;
  /** Indent from the start edge (e.g. to align with list text after an avatar). */
  insetStart?: SpaceToken | number;
  strong?: boolean;
}

/** Hairline separator; decorative, hidden from screen readers. */
export function Divider({ vertical, insetStart, strong, style, ...rest }: DividerProps) {
  const { colors } = useTheme();
  const inset = typeof insetStart === "number" ? insetStart : insetStart ? spacing[insetStart] : 0;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        vertical
          ? { width: 1, alignSelf: "stretch", backgroundColor: strong ? colors.borderStrong : colors.border }
          : {
              height: 1,
              alignSelf: "stretch",
              marginStart: inset,
              backgroundColor: strong ? colors.borderStrong : colors.border,
            },
        style,
      ]}
      {...rest}
    />
  );
}
