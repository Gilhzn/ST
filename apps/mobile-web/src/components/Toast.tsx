/**
 * Transient, non-blocking messages (design v2 §14 Toast): an inverse card with a tone disc and
 * bold icon, slid in at the top under the status bar, 4 s dwell, dismissible. Announced politely
 * (errors assertively) and never the only place an error is shown.
 */
import { Haptics, motion, spacing, Toast, useTheme, zIndex, type ToastTone } from '@st/ui';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';

export type AppToastTone = ToastTone;

interface ToastItem {
  id: number;
  message: string;
  tone: AppToastTone;
}

type ShowToast = (message: string, tone?: AppToastTone) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { t } = useT();
  const anim = useRef(new Animated.Value(0)).current;

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(anim, { toValue: 0, duration: motion.duration.fast, useNativeDriver: false }).start(() => setToast(null));
  }, [anim]);

  const show = useCallback<ShowToast>(
    (message, tone = 'neutral') => {
      seq.current += 1;
      setToast({ id: seq.current, message, tone });
      if (tone === 'error') Haptics.trigger('actionFailed');
      AccessibilityInfo.announceForAccessibility?.(message);
      anim.setValue(0);
      if (theme.reducedMotion) anim.setValue(1);
      else Animated.spring(anim, { toValue: 1, ...motion.springs.gentle, useNativeDriver: false }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(hide, motion.duration.toast);
    },
    [anim, hide, theme.reducedMotion],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <View pointerEvents="box-none" style={{ position: 'absolute', start: 0, end: 0, top: insets.top + spacing.sm, alignItems: 'center', zIndex: zIndex.toast }}>
        {toast ? (
          <Animated.View
            key={toast.id}
            style={{
              width: '100%',
              maxWidth: 480,
              paddingStart: spacing.lg,
              paddingEnd: spacing.lg,
              opacity: anim,
              transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
            }}
          >
            <Toast testID="toast" title={toast.message} tone={toast.tone} dismissLabel={t('common:actions.dismiss')} onDismiss={hide} />
          </Animated.View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
