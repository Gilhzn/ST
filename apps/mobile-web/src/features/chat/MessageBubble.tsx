/**
 * One chat bubble (design §13.11): own messages at the end side on primarySubtle,
 * others at the start on surface; author name above the first bubble of a group
 * with a reliability dot; the body is a bidi block (its own base direction);
 * the time is an LTR isolate; a visible ⋯ button (and long press) opens options.
 */
import type { ChatMessage, PublicProfile } from '@st/domain';
import { BidiText, isolate, radius, Row, spacing, Stack, Text, useTheme } from '@st/ui';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ReliabilityDot } from '@/components/ReliabilityBadge';
import { useT } from '@/i18n';
import { formatTime } from '@/lib/format';

export interface Translation {
  text: string;
  shown: boolean;
  loading?: boolean;
}

export function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** True when the message is in another language than the UI (zh-Hans vs zh are the same family). */
export function needsTranslation(lang: string | null, locale: string): boolean {
  if (!lang) return false;
  return lang.split('-')[0]?.toLowerCase() !== locale.split('-')[0]?.toLowerCase();
}

export function MessageBubble({
  message,
  own,
  author,
  showAuthor,
  translation,
  onTranslate,
  onOptions,
}: {
  message: ChatMessage;
  own: boolean;
  author: PublicProfile | null;
  showAuthor: boolean;
  translation?: Translation;
  onTranslate: () => void;
  onOptions: () => void;
}) {
  const { t, locale } = useT();
  const { colors } = useTheme();
  const retracted = message.retractedAt !== null;
  const showTranslated = !!translation?.shown && !retracted;
  const canTranslate = !own && !retracted && needsTranslation(message.lang, locale);
  const name = author?.displayName ?? '—';

  return (
    <View testID={`chat.message.${message.id}`} style={{ alignItems: own ? 'flex-end' : 'flex-start', marginTop: showAuthor ? spacing.md : spacing.xxs }}>
      {showAuthor && !own ? (
        <Row gap="xs" style={{ marginBottom: spacing.xxs, paddingStart: spacing.sm }}>
          <BidiText variant="caption" color="textSecondary">
            {name}
          </BidiText>
          {author ? <ReliabilityDot status={author.reliabilityStatus} score={author.reliabilityScore} /> : null}
        </Row>
      ) : null}
      <Row gap="xs" align="end" style={{ maxWidth: '86%', flexDirection: 'row' }}>
        {own ? <OptionsButton id={message.id} onPress={onOptions} /> : null}
        <Pressable
          onLongPress={onOptions}
          accessibilityRole="text"
          accessibilityHint={t('chat:message.moreOptions')}
          style={{
            flexShrink: 1,
            paddingStart: spacing.md,
            paddingEnd: spacing.md,
            paddingTop: spacing.sm,
            paddingBottom: spacing.sm,
            borderRadius: radius.lg,
            borderBottomEndRadius: own ? radius.xs : radius.lg,
            borderBottomStartRadius: own ? radius.lg : radius.xs,
            backgroundColor: own ? colors.primarySubtle : colors.surface,
            borderWidth: own ? 0 : 1,
            borderColor: colors.border,
          }}
        >
          <Stack gap="xxs">
            {retracted ? (
              <Text variant="callout" color="textTertiary">
                {t('chat:message.retracted')}
              </Text>
            ) : (
              <BidiText
                variant="callout"
                mode="block"
                color={own ? 'onPrimarySubtle' : 'text'}
                testID={`chat.message.${message.id}.body`}
                accessibilityLanguage={showTranslated ? locale : (message.lang ?? undefined)}
              >
                {showTranslated && translation ? translation.text : message.body}
              </BidiText>
            )}
            {showTranslated && message.lang ? (
              <Text variant="caption" color="textTertiary" testID={`chat.message.${message.id}.translated`}>
                {t('chat:translate.translatedFrom', { language: languageName(message.lang, locale) })}
              </Text>
            ) : null}
            <Row gap="xs" style={{ alignSelf: 'flex-end' }}>
              {message.moderation === 'pending' ? (
                <Text variant="caption" color="textTertiary">
                  {t('chat:message.checking')}
                </Text>
              ) : null}
              <Text variant="caption" color="textTertiary" style={{ fontVariant: ['tabular-nums'] }}>
                {isolate(formatTime(message.createdAt, locale), 'ltr')}
              </Text>
            </Row>
          </Stack>
        </Pressable>
        {!own ? <OptionsButton id={message.id} onPress={onOptions} /> : null}
      </Row>
      {canTranslate ? (
        <Pressable
          testID={`chat.message.${message.id}.translate`}
          accessibilityRole="button"
          onPress={onTranslate}
          hitSlop={8}
          style={{ minHeight: 32, justifyContent: 'center', paddingStart: spacing.sm, paddingEnd: spacing.sm }}
        >
          <Text variant="caption" color="primaryText">
            {translation?.loading ? t('common:status.loading') : showTranslated ? t('chat:translate.showOriginal') : t('chat:message.translate')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function OptionsButton({ id, onPress }: { id: string; onPress: () => void }) {
  const { t } = useT();
  return (
    <Pressable
      testID={`chat.message.${id}.options`}
      accessibilityRole="button"
      accessibilityLabel={t('chat:message.moreOptions')}
      onPress={onPress}
      hitSlop={8}
      style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name="dots-horizontal" size={20} color="textTertiary" />
    </Pressable>
  );
}
