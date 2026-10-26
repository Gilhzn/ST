/**
 * Phone number entry (design v2 §15.1): the night-stadium `AuthHero` brand moment, then a calm
 * panel — title, helper, a country picker row (flag + name + dial code), the phone field with the
 * dial prefix, one primary "Send code", legal links and the demo hint.
 */
import { isStError } from '@st/domain';
import { AuthHero, Button, Haptics, isolate, spacing, StatusPill, Text, TextField, useTheme } from '@st/ui';
import { Link, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen } from '@/components/Screen';
import { SelectField } from '@/components/SelectField';
import { InlineError } from '@/components/States';
import { useData, useDataMode } from '@/data/DataProvider';
import { useAction } from '@/hooks/useAsync';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useT } from '@/i18n';
import { COUNTRY_DIAL, countryName, flagEmoji, toE164 } from '@/lib/countries';
import { deviceRegion } from '@/lib/device';

export default function PhoneScreen() {
  const { t, locale } = useT();
  const port = useData();
  const mode = useDataMode();
  const theme = useTheme();
  const linkStyle = { color: theme.colors.primaryText, minHeight: 32, fontFamily: theme.fontFamily('semibold'), fontSize: 15 };
  const insets = useSafeAreaInsets();
  const { height } = useBreakpoint();
  const [country, setCountry] = useState(() => {
    const r = deviceRegion();
    return r && COUNTRY_DIAL[r] ? r : 'IL';
  });
  const [number, setNumber] = useState('');
  const [invalid, setInvalid] = useState(false);
  const send = useAction(async (phone: string) => port.sendOtp(phone));

  const options = useMemo(
    () =>
      Object.keys(COUNTRY_DIAL)
        .map((code) => ({ code, name: countryName(code, locale) }))
        .sort((a, b) => a.name.localeCompare(b.name, locale))
        .map(({ code, name }) => ({ value: code, label: `${flagEmoji(code)} ${name} (${isolate(`+${COUNTRY_DIAL[code]}`, 'ltr')})` })),
    [locale],
  );
  const dial = COUNTRY_DIAL[country] ?? '972';

  const submit = async () => {
    const phone = toE164(dial, number);
    setInvalid(!phone);
    if (!phone) {
      Haptics.trigger('actionFailed');
      return;
    }
    const res = await send.run(phone);
    if (res) router.push({ pathname: '/otp', params: { phone, resendAfter: String(res.resendAfterSeconds) } });
  };

  const validationError = invalid || (send.error && isStError(send.error) && send.error.code === 'validation');
  const heroHeight = Math.max(260, Math.min(360, Math.round(height * 0.4)));

  return (
    <Screen
      back={false}
      testID="screen.auth.phone"
      hero={<AuthHero title={t('auth:welcome.headline')} subtitle={t('auth:welcome.subtitle')} topInset={insets.top} height={heroHeight} />}
      contentStyle={{ paddingTop: spacing.xl, gap: spacing.xl, paddingBottom: insets.bottom }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text variant="title2" role="heading" aria-level={1}>
          {t('auth:phone.title')}
        </Text>
        <Text variant="callout" color="textSecondary">
          {t('auth:phone.body')}
        </Text>
      </View>

      <View style={{ gap: spacing.lg }}>
        <SelectField
          testID="auth.phone.country"
          label={t('auth:phone.countryLabel')}
          placeholder={t('auth:phone.countrySearch')}
          value={country}
          options={options}
          onChange={setCountry}
          start={
            <Text variant="title3" aria-hidden style={{ lineHeight: 28 }}>
              {flagEmoji(country)}
            </Text>
          }
          display={countryName(country, locale)}
          trailingText={isolate(`+${dial}`, 'ltr')}
        />
        <TextField
          testID="auth.phone.input"
          label={t('auth:phone.numberLabel')}
          value={number}
          onChangeText={(v) => {
            setNumber(v);
            if (invalid) setInvalid(false);
          }}
          icon="Phone"
          inputDirection="ltr"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          start={
            <Text variant="body" weight="medium" color="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>
              {isolate(`+${dial}`, 'ltr')}
            </Text>
          }
          error={validationError ? t('auth:phone.invalid') : undefined}
          onSubmitEditing={submit}
          returnKeyType="send"
        />
      </View>

      {send.error && !validationError ? <InlineError error={send.error} /> : null}

      <View style={{ gap: spacing.lg }}>
        <Button
          testID="auth.phone.submit"
          label={t('auth:phone.sendCode')}
          iconEnd="ArrowRight"
          loading={send.busy}
          loadingLabel={t('auth:phone.sending')}
          onPress={submit}
          fullWidth
          size="lg"
          disabled={!number.trim()}
        />
        <Text variant="footnote" color="textTertiary" align="center">
          {t('auth:phone.consent')}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: spacing.xl }}>
          <Link href="/legal/terms" style={linkStyle}>
            {t('auth:phone.consentTerms')}
          </Link>
          <Link href="/legal/privacy" style={linkStyle}>
            {t('auth:phone.consentPrivacy')}
          </Link>
        </View>
        {mode === 'mock' ? (
          <View testID="auth.phone.demoHint" style={{ alignItems: 'center' }}>
            <StatusPill tone="info" icon="Sparkle" size="md" label={t('auth:demo.hint', { code: isolate('123456', 'ltr') })} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
