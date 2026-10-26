/**
 * Root: providers (safe area → i18n → theme → data → session → toasts) and the
 * route gate. Route groups are protected by session state:
 *   signed out → (auth)/phone, otp · needs profile → (auth)/age-gate, onboarding · ready → app.
 * Legal pages, invite links and the not-found screen are always reachable.
 */
import { BrandMark, useAppFonts, useTheme } from '@st/ui';
import { router, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { installFocusVisible } from '@/components/focusVisible';
import { ToastProvider } from '@/components/Toast';
import { createDataPort, resolveDataMode } from '@/data';
import { DataProvider } from '@/data/DataProvider';
import { I18nProvider, useT } from '@/i18n';
// Side effect: registers the background geofence task at startup (native; no-op on web).
import '@/platform/geofence';
import { addNotificationTapListener, configureNotificationHandler } from '@/platform/push';
import { SessionProvider, takePostAuthRedirect, useSession } from '@/state/session';
import { AppThemeProvider } from '@/state/theme';

export const unstable_settings = { anchor: '(tabs)' };

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
configureNotificationHandler();

const DATA_MODE = resolveDataMode();

/**
 * Web: decorative icons (Phosphor <svg aria-hidden tabindex="-1">) must not take focus or the
 * click from their pressable parent; otherwise Chrome draws its default focus ring around them.
 */
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('st-global-css')) {
  const style = document.createElement('style');
  style.id = 'st-global-css';
  style.textContent = 'svg[aria-hidden="true"]{pointer-events:none}svg[tabindex="-1"]:focus{outline:none}';
  document.head.appendChild(style);
}
installFocusVisible();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <ThemedRoot />
      </I18nProvider>
    </SafeAreaProvider>
  );
}

function ThemedRoot() {
  const { locale } = useT();
  // Rubik (Latin, Cyrillic, Hebrew) + the locale's script fallback (Arabic, Devanagari); web and native.
  const brandFonts = useAppFonts(locale);
  return (
    <AppThemeProvider locale={locale} brandFonts={brandFonts}>
      <DataProvider create={() => createDataPort(DATA_MODE)} mode={DATA_MODE}>
        <SessionProvider>
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </SessionProvider>
      </DataProvider>
    </AppThemeProvider>
  );
}

function RootNavigator() {
  const { status } = useSession();
  const { t } = useT();
  const theme = useTheme();
  const pathname = usePathname();
  const previous = useRef(status);

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync().catch(() => undefined);
  }, [status]);

  // Explicit transitions between gate states (guards also redirect; this keeps intent clear).
  useEffect(() => {
    const prev = previous.current;
    previous.current = status;
    if (prev === status || status === 'loading') return;
    if (status === 'ready' && (prev === 'needsProfile' || prev === 'signedOut' || prev === 'loading')) {
      const next = takePostAuthRedirect();
      if (next) router.replace(next);
      else if (pathname === '/' || ['/phone', '/otp', '/age-gate', '/onboarding'].includes(pathname)) router.replace('/map');
    } else if (status === 'needsProfile' && prev !== 'loading') {
      router.replace('/age-gate');
    } else if (status === 'signedOut' && prev === 'ready') {
      router.replace('/phone');
    }
  }, [status, pathname]);

  useEffect(() => addNotificationTapListener((url) => router.push(url as never)), []);

  if (status === 'loading') {
    return (
      <View testID="app.loading" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <View aria-busy role="progressbar" aria-label={t('common:status.loading')}>
          <BrandMark size={56} />
        </View>
      </View>
    );
  }

  const onboarded = status === 'ready';
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Protected guard={!onboarded} redirectTo="/map">
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={onboarded} redirectTo={status === 'needsProfile' ? '/age-gate' : '/phone'}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="game" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="sanctions/[id]" />
        </Stack.Protected>
        <Stack.Screen name="index" />
        <Stack.Screen name="invite/[token]" />
        <Stack.Screen name="legal" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}
