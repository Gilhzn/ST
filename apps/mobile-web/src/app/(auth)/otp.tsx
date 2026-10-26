/**
 * One-time code (design v2 §15.1): LargeHeader with back, "Sent to +972 …" (LTR isolate) and a
 * Change link, six boxed cells over one input (auto-advance, paste, SMS autofill), auto-submit at
 * six digits, a resend countdown that turns into "Resend code". Haptics: light on submit, error
 * on a wrong code.
 */
import { isStError } from '@st/domain';
import { Button, Haptics, Icon, isolate, spacing, Text, useTheme } from '@st/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { OtpCells } from '@/components/OtpCells';
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
  const { colors } = useTheme();
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

  useEffect(() => {
    if (verify.error) Haptics.trigger('actionFailed');
  }, [verify.error]);

  const submit = async (value = code) => {
    if (value.length !== 6 || verify.busy) return;
    lastSubmitted.current = value;
    Haptics.light();
    // On success the session gate moves on (age gate, or the map for returning players).
    await verify.run(value);
  };

  const onChange = (digits: string) => {
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
    <Screen
      testID="screen.auth.otp"
      backFallback="/phone"
      large
      title={t('auth:otp.title')}
      subtitle={t('auth:otp.body', { phone: isolate(phone, 'ltr') })}
      footer={
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
      }
    >
      <View style={{ gap: spacing.md, paddingTop: spacing.sm }}>
        <OtpCells testID="auth.otp.input" label={t('auth:otp.label')} value={code} onChange={onChange} error={Boolean(fieldError)} autoFocus />
        {fieldError ? (
          <View aria-live="polite" style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xs, alignItems: 'flex-start' }}>
            <Icon name="WarningCircle" size={16} weight="bold" color="dangerText" />
            <Text variant="footnote" color="dangerText" style={{ flexShrink: 1 }}>
              {fieldError}
            </Text>
          </View>
        ) : null}
      </View>
      {verify.error && !fieldError ? <InlineError error={verify.error} /> : null}

      <View style={{ alignItems: 'center', gap: spacing.xs }}>
        {left > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 48 }}>
            <Icon name="ClockCountdown" size={18} color="textTertiary" />
            <Text variant="callout" color="textSecondary" aria-live="polite" testID="auth.otp.countdown" style={{ fontVariant: ['tabular-nums'] }}>
              {t('auth:otp.resendIn', { time: isolate(formatClock(left), 'ltr') })}
            </Text>
          </View>
        ) : (
          <Button
            testID="auth.otp.resend"
            variant="ghost"
            icon="ArrowClockwise"
            label={t('auth:otp.resend')}
            style={{ alignSelf: 'center' }}
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
        <Button testID="auth.otp.change" variant="ghost" icon="PencilSimple" label={t('auth:otp.changeNumber')} style={{ alignSelf: 'center' }} onPress={() => router.replace('/phone')} />
      </View>
      {resend.error ? <InlineError error={resend.error} /> : null}
      <View style={{ height: 1, backgroundColor: colors.border, marginTop: spacing.sm }} aria-hidden />
      <Text variant="footnote" color="textTertiary" align="center">
        {t('auth:phone.consent')}
      </Text>
    </Screen>
  );
}
