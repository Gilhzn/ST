import { Stack } from 'expo-router';

/** Settings stack: hub (`index`) plus language, notifications, privacy and delete-account. */
export default function SettingsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
