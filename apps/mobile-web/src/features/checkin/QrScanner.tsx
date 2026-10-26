/**
 * QR scanning with expo-camera (native; web uses getUserMedia and the browser
 * BarcodeDetector where available). The feed is never mirrored. Callers always
 * offer manual code entry as well (design §13.7).
 */
import { radius, spacing, Text, useTheme } from '@st/ui';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { useT } from '@/i18n';

export function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const { t } = useT();
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [available, setAvailable] = useState<boolean | null>(null);
  const lastCode = useRef<string | null>(null);

  useEffect(() => {
    CameraView.isAvailableAsync()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    if (available && permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [available, permission, requestPermission]);

  if (available === false || (permission && !permission.granted && !permission.canAskAgain)) {
    return (
      <Text variant="callout" color="textSecondary" testID="checkin.qr.cameraUnavailable">
        {t('checkin:permission.camera.denied')}
      </Text>
    );
  }
  if (!permission?.granted) {
    return (
      <Text variant="callout" color="textSecondary">
        {t('checkin:permission.camera.body')}
      </Text>
    );
  }
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ height: 280, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceInverse }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (!data || data === lastCode.current) return;
            lastCode.current = data;
            onCode(data);
          }}
        />
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 40, bottom: 40, start: 40, end: 40, borderWidth: 3, borderColor: colors.accent, borderRadius: radius.md }}
        />
      </View>
      <Text variant="caption" color="textSecondary">
        {t('checkin:qr.hint')}
      </Text>
    </View>
  );
}
