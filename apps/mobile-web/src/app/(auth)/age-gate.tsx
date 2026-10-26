/**
 * Age gate 18+ (design v2 §15.1): a calm illustration, month/year side by side, a privacy note,
 * one primary Continue; a respectful stop screen (no blame, clear next step) with a 24 h soft lock.
 */
import { MIN_AGE_YEARS } from '@st/domain';
import { Button, EmptyState, Icon, Illustration, radius, spacing, Text, useTheme } from '@st/ui';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Screen } from '@/components/Screen';
import { SelectField } from '@/components/SelectField';
import { useT } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { setBirth } from '@/state/onboardingDraft';
import { getPref, PrefKeys, setPref } from '@/state/prefs';
import { useSession } from '@/state/session';

const LOCK_MS = 24 * 60 * 60 * 1000;

/** Whole months since the first day of the birth month (birth day unknown by design). */
function ageInMonths(year: number, month: number, now: Date): number {
  return (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month);
}

export default function AgeGateScreen() {
  const { t, locale } = useT();
  const session = useSession();
  const { colors } = useTheme();
  const [month, setMonth] = useState<string | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    getPref<number>(PrefKeys.ageGateLockedUntil).then((until) => setBlocked(!!until && until > Date.now()));
  }, []);

  const months = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
    return Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: fmt.format(new Date(Date.UTC(2020, i, 1))) }));
  }, [locale]);
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return Array.from({ length: 101 }, (_, i) => {
      const y = now - i;
      return { value: String(y), label: formatNumber(y, locale, { useGrouping: false }) };
    });
  }, [locale]);

  const submit = async () => {
    if (!month || !year) return;
    const y = Number(year);
    const m = Number(month);
    if (ageInMonths(y, m, new Date()) < MIN_AGE_YEARS * 12) {
      setBirth(null);
      await setPref(PrefKeys.ageGateLockedUntil, Date.now() + LOCK_MS);
      setBlocked(true);
      return;
    }
    setBirth({ birthYear: y, birthMonth: m });
    router.push('/onboarding');
  };

  if (blocked === null) return null;

  if (blocked) {
    return (
      <Screen back={false} testID="screen.auth.ageBlocked" contentStyle={{ flexGrow: 1, justifyContent: 'center', paddingTop: spacing.xxxl }}>
        <View testID="auth.age.blocked" aria-live="polite">
          <EmptyState
            tone="restricted"
            illustration="ageGate"
            title={t('auth:ageGate.under18.title')}
            body={t('auth:ageGate.under18.body')}
            actionLabel={t('auth:ageGate.under18.close')}
            actionIcon="SignOut"
            onAction={() => void session.signOut()}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      back={false}
      testID="screen.auth.age"
      footer={<Button testID="auth.age.submit" label={t('auth:ageGate.continue')} iconEnd="ArrowRight" onPress={submit} disabled={!month || !year} fullWidth size="lg" />}
      contentStyle={{ gap: spacing.xl, paddingTop: spacing.xl }}
    >
      <View style={{ alignItems: 'center', gap: spacing.lg }}>
        <Illustration name="ageGate" size={136} />
        <View style={{ gap: spacing.sm, alignItems: 'center' }}>
          <Text variant="title1" align="center" role="heading" aria-level={1}>
            {t('auth:ageGate.title')}
          </Text>
          <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 360 }}>
            {t('auth:ageGate.body')}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 3 }}>
          <SelectField
            testID="auth.age.month"
            label={t('auth:ageGate.monthLabel')}
            placeholder={t('auth:ageGate.monthPlaceholder')}
            value={month}
            options={months}
            onChange={setMonth}
          />
        </View>
        <View style={{ flex: 2 }}>
          <SelectField
            testID="auth.age.year"
            label={t('auth:ageGate.yearLabel')}
            placeholder={t('auth:ageGate.yearPlaceholder')}
            value={year}
            options={years}
            onChange={setYear}
          />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceSunken }}>
        <Icon name="ShieldCheck" size={20} weight="duotone" color="successText" />
        <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
          {t('auth:ageGate.privacyNote')}
        </Text>
      </View>
    </Screen>
  );
}
