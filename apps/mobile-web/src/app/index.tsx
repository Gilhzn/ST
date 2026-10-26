import { Redirect } from 'expo-router';

import { useSession } from '@/state/session';

/** `/` → the map when onboarded, else the auth flow. */
export default function Index() {
  const { status } = useSession();
  if (status === 'ready') return <Redirect href="/map" />;
  if (status === 'needsProfile') return <Redirect href="/age-gate" />;
  return <Redirect href="/phone" />;
}
