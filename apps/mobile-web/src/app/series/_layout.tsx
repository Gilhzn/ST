import { Stack } from 'expo-router';

/** Recurring series: the series screen and its WhatsApp-group invite flow. */
export default function SeriesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[id]/index" />
      <Stack.Screen name="[id]/invite" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
