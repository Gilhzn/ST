import { AppTabs } from '@/components/AppNav';
import { useGeofenceSync } from '@/hooks/useGeofenceSync';

export default function TabsLayout() {
  useGeofenceSync(true);
  return <AppTabs />;
}
