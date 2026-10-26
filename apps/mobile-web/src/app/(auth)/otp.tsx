/** One-time code (design §13.1 step 3): one LTR input, auto-submit, resend countdown. */
import { isStError } from '@st/domain';
import { Button, isolate, Row, spacing, Stack, Text, TextField } from '@st/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

import { Screen } from '@/components/Screen';
import { InlineError } from '@/components/States';
import { useData } from '@/data/DataProvider';
import { useAction } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { formatClock } from '@/lib/format';
import { useSession } from '@/state/session';

export default function OtpScreen() {
  const { t } = useT();
  const port = useData();
  const session = useSession();
  const params = useLocalSearchParams<{ phone?: string; resendAfter?: string }>();
  const phone = typeof params.phone === 'string' ? params.phone : '';
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(() => Number(params.resendAfter ?? 30) || 30);
  const lastSubmitted = useRef('');
  const verify = useAction(async (c: string) => {
    const user = await port.verifyOtp(phone, c);
    await session.refresh();
    return user;
  });
  const resend = useAction(async () => port.sendOtp(phone));

  useEffect(() => {
    if (!phone) router.replace('/phone');
  }, [phone]);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    if (left === 10) AccessibilityInfo.announceForAccessibility?.(t('auth:otp.resendIn', { time: formatClock(left) }));
    return () => clearTimeout(id);
  }, [left, t]);

  useEffect(() => {
    if (left === 0) AccessibilityInfo.announceForAccessibility?.(t('auth:otp.resendReady'));
  }, [left, t]);

  const submit = async (value = code) => {
    if (value.length !== 6 || verify.busy) return;
    lastSubmitted.current = value;
    // On success the session gate moves on (age gate, or the map for returning players).
    await verify.run(value);
  };

  const onChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (verify.error) verify.setError(null);
    if (digits.length === 6 && digits !== lastSubmitted.current) void submit(digits);
  };

  const errorCode = verify.error && isStError(verify.error) ? verify.error.code : null;
  const fieldError =
    errorCode === 'otp_invalid'
      ? t('auth:otp.wrong')
      : errorCode === 'otp_expired'
        ? t('auth:otp.expired')
        : errorCode === 'rate_limited'
          ? t('auth:otp.tooMany', { minutes: 10 })
          : undefined;

  return (
    <Screen testID="screen.auth.otp" backFallback="/phone">
      <Stack gap="xl">
        <Stack gap="xs">
          <Text variant="title1">{t('auth:otp.title')}</Text>
          <Text variant="body" color="textSecondary">
            {t('auth:otp.body', { phone: isolate(phone, 'ltr') })}
          </Text>
        </Stack>
        <TextField
          testID="auth.otp.input"
          label={t('auth:otp.label')}
          value={code}
          onChangeText={onChange}
          inputDirection="ltr"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete={Platform.OS === 'web' ? 'one-time-code' : 'sms-otp'}
          maxLength={6}
          autoFocus
          error={fieldError}
        />
        {verify.error && !fieldError ? <InlineError error={verify.error} /> : null}
        <Button
          testID="auth.otp.submit"
          label={t('common:actions.continue')}
          loading={verify.busy}
          loadingLabel={t('auth:otp.verifying')}
          disabled={code.length !== 6}
          onPress={() => void submit()}
          fullWidth
          size="lg"
        />
        <Row gap="lg" wrap>
          {left > 0 ? (
            <Text variant="callout" color="textSecondary" accessibilityLiveRegion="polite" testID="auth.otp.countdown">
              {t('auth:otp.resendIn', { time: isolate(formatClock(left), 'ltr') })}
            </Text>
          ) : (
            <Button
              testID="auth.otp.resend"
              variant="ghost"
              label={t('auth:otp.resend')}
              loading={resend.busy}
              onPress={async () => {
                const r = await resend.run();
                if (r) {
                  setLeft(r.resendAfterSeconds);
                  setCode('');
                  lastSubmitted.current = '';
                  AccessibilityInfo.announceForAccessibility?.(t('auth:otp.resent'));
                }
              }}
            />
          )}
          <Button testID="auth.otp.change" variant="ghost" label={t('auth:otp.changeNumber')} onPress={() => router.replace('/phone')} />
        </Row>
        {resend.error ? <InlineError error={resend.error} /> : null}
        <Text variant="caption" color="textTertiary" style={{ marginTop: spacing.sm }}>
          {t('auth:phone.consent')}
        </Text>
      </Stack>
    </Screen>
  );
}
