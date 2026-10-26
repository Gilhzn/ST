import { Stack } from 'expo-router';

import { useSession } from '@/state/session';

/** Auth flow: phone → otp (signed out), then age-gate → onboarding (signed in, no profile). */
export default function AuthLayout() {
  const { status } = useSession();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'signedOut'} redirectTo="/age-gate">
        <Stack.Screen name="phone" />
        <Stack.Screen name="otp" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'needsProfile'} redirectTo="/phone">
        <Stack.Screen name="age-gate" />
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
    </Stack>
  );
}
