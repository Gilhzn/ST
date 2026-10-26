/**
 * Sports with positions and self-assessed level (design v2 §15.13): grouped rows with the
 * sport glyph in its tinted well, positions (primary first) and a five-dot skill meter.
 */
import type { PositionId, Stars, UserSport } from '@st/domain';
import { ListGroup, ListItem, spacing, SportGlyphBadge, Text, useTheme } from '@st/ui';
import { View } from 'react-native';

import { useT } from '@/i18n';
import { formatList } from '@/lib/format';

function SkillDots({ value, color }: { value: number; color: string }) {
  const { colors } = useTheme();
  return (
    <View aria-hidden style={{ flexDirection: 'row', gap: 3 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={{ width: 6, height: 14, borderRadius: 3, backgroundColor: i <= value ? color : colors.surfaceSunken }} />
      ))}
    </View>
  );
}

export function SportsSection({ sports }: { sports: readonly UserSport[] }) {
  const { t, locale } = useT();
  const theme = useTheme();
  return (
    <View testID="profile.sports" style={{ gap: spacing.sm }}>
      {sports.length === 0 ? (
        <>
          <Text variant="overline" color="textTertiary" role="heading" style={{ paddingStart: spacing.lg }}>
            {t('profile:sportsTitle')}
          </Text>
          <Text variant="callout" color="textSecondary" testID="profile.sports.empty" style={{ paddingStart: spacing.lg }}>
            {t('profile:positions.none')}
          </Text>
        </>
      ) : (
        <ListGroup title={t('profile:sportsTitle')}>
          {sports.map((s) => {
            const positions = (s.positions as readonly PositionId[]).map((p) => t(`common:positions.${p}`));
            const skill = t(`auth:profileSetup.skill.${s.selfSkill as Stars}`);
            return (
              <ListItem
                key={s.sport}
                testID={`profile.sport.${s.sport}`}
                aria-label={[t(`common:sports.${s.sport}`), positions.length ? formatList(positions, locale) : null, skill].filter(Boolean).join('. ')}
                leading={<SportGlyphBadge sport={s.sport} size={40} squircle />}
                title={t(`common:sports.${s.sport}`)}
                subtitle={positions.length ? formatList(positions, locale) : t('profile:positions.none')}
                trailing={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <SkillDots value={s.selfSkill} color={theme.sport(s.sport).color} />
                    <Text variant="caption" color="textSecondary" numberOfLines={1}>
                      {skill}
                    </Text>
                  </View>
                }
              />
            );
          })}
        </ListGroup>
      )}
    </View>
  );
}
