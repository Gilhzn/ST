import { Stack } from 'expo-router';

/** Game routes: details and its sub-screens; Create is a modal (design §12.2). */
export default function GameLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="create" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[id]/index" />
      <Stack.Screen name="[id]/chat" />
      <Stack.Screen name="[id]/checkin" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[id]/teams" />
      <Stack.Screen name="[id]/result" options={{ presentation: 'modal' }} />
      <Stack.Screen name="[id]/qr" options={{ presentation: 'fullScreenModal' }} />
    </Stack>
  );
}
