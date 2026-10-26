/**
 * Transient, non-blocking messages (design: surfaceInverse, z toast 60).
 * Announced politely to screen readers; never the only place an error is shown.
 */
import { Text, useTheme, zIndex, spacing, radius } from '@st/ui';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ToastItem {
  id: number;
  message: string;
  tone: 'neutral' | 'error';
}

const ToastContext = createContext<(message: string, tone?: ToastItem['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  const show = useCallback((message: string, tone: ToastItem['tone'] = 'neutral') => {
    seq.current += 1;
    setToast({ id: seq.current, message, tone });
    AccessibilityInfo.announceForAccessibility?.(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', start: 0, end: 0, bottom: insets.bottom + 88, alignItems: 'center', zIndex: zIndex.toast }}
      >
        {toast ? (
          <View
            key={toast.id}
            testID="toast"
            accessibilityLiveRegion="polite"
            accessibilityRole={toast.tone === 'error' ? 'alert' : 'text'}
            style={{
              maxWidth: 480,
              marginStart: spacing.lg,
              marginEnd: spacing.lg,
              paddingStart: spacing.lg,
              paddingEnd: spacing.lg,
              paddingTop: spacing.md,
              paddingBottom: spacing.md,
              borderRadius: radius.md,
              backgroundColor: theme.colors.surfaceInverse,
              boxShadow: '0px 4px 12px rgba(0,0,0,0.25)',
            }}
          >
            <Text variant="callout" color="textInverse">
              {toast.message}
            </Text>
          </View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
