/** Phone number entry (design §13.1 step 2). */
import { isStError } from '@st/domain';
import { Button, isolate, Row, spacing, Stack, Text, TextField, useTheme } from '@st/ui';
import { Link, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Screen } from '@/components/Screen';
import { SelectField } from '@/components/SelectField';
import { InlineError } from '@/components/States';
import { useData, useDataMode } from '@/data/DataProvider';
import { useAction } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { COUNTRY_DIAL, countryName, flagEmoji, toE164 } from '@/lib/countries';
import { deviceRegion } from '@/lib/device';

export default function PhoneScreen() {
  const { t, locale } = useT();
  const port = useData();
  const mode = useDataMode();
  const { colors } = useTheme();
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
    if (!phone) return;
    const res = await send.run(phone);
    if (res) router.push({ pathname: '/otp', params: { phone, resendAfter: String(res.resendAfterSeconds) } });
  };

  const validationError = invalid || (send.error && isStError(send.error) && send.error.code === 'validation');

  return (
    <Screen back={false} testID="screen.auth.phone">
      <Stack gap="xl" style={{ paddingTop: spacing.xl }}>
        <Stack gap="sm">
          <Text variant="overline" color="primaryText">
            {t('common:app.name')}
          </Text>
          <Text variant="display">{t('auth:welcome.headline')}</Text>
        </Stack>
        <Stack gap="xs">
          <Text variant="title2">{t('auth:phone.title')}</Text>
          <Text variant="body" color="textSecondary">
            {t('auth:phone.body')}
          </Text>
        </Stack>
        <SelectField
          testID="auth.phone.country"
          label={t('auth:phone.countryLabel')}
          placeholder={t('auth:phone.countrySearch')}
          value={country}
          options={options}
          onChange={setCountry}
        />
        <TextField
          testID="auth.phone.input"
          label={t('auth:phone.numberLabel')}
          value={number}
          onChangeText={(v) => {
            setNumber(v);
            if (invalid) setInvalid(false);
          }}
          inputDirection="ltr"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          start={
            <Text variant="body" color="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>
              {`⁦+${dial}⁩`}
            </Text>
          }
          error={validationError ? t('auth:phone.invalid') : undefined}
          onSubmitEditing={submit}
          returnKeyType="send"
        />
        {send.error && !validationError ? <InlineError error={send.error} /> : null}
        <Button
          testID="auth.phone.submit"
          label={t('auth:phone.sendCode')}
          loading={send.busy}
          loadingLabel={t('auth:phone.sending')}
          onPress={submit}
          fullWidth
          size="lg"
          disabled={!number.trim()}
        />
        <View>
          <Text variant="caption" color="textSecondary">
            {t('auth:phone.consent')}
          </Text>
          <Row gap="lg" style={{ marginTop: spacing.xs }}>
            <Link href="/legal/terms" style={{ color: colors.primaryText, minHeight: 32 }}>
              {t('auth:phone.consentTerms')}
            </Link>
            <Link href="/legal/privacy" style={{ color: colors.primaryText, minHeight: 32 }}>
              {t('auth:phone.consentPrivacy')}
            </Link>
          </Row>
        </View>
        {mode === 'mock' ? (
          <Text variant="caption" color="textTertiary" testID="auth.phone.demoHint">
            {t('auth:demo.hint', { code: '⁦123456⁩' })}
          </Text>
        ) : null}
      </Stack>
    </Screen>
  );
}
