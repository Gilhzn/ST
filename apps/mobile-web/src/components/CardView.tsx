/**
 * `@st/ui` Card that keeps its `testID` when it is not pressable (the package's static branch
 * renders a bare View without the rest props). v2 cards: radius 20, elevation 1 (dark: border).
 */
import { Card as UiCard, type CardProps } from '@st/ui';
import { View } from 'react-native';

export function Card(props: CardProps) {
  if (props.onPress || !props.testID) return <UiCard {...props} />;
  const { testID, ...rest } = props;
  return (
    <View testID={testID}>
      <UiCard {...rest} />
    </View>
  );
}
