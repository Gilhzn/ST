/**
 * One chat bubble (design v2 §15.7).
 * - Own messages sit at the end on brand fill; others at the start on a raised surface.
 * - Messages from the same author within a few minutes form a group: avatar + name (with a
 *   reliability dot) on the group's first bubble, a 6 dp "tail" corner on its last one.
 * - The body is a bidi block (takes its own base direction); the time is an LTR isolate.
 * - Translate is a small link; the translation shows as a subtle quote under the original.
 * - Long press (or the ⋯ button, the accessible alternative) opens the message options.
 */
import type { ChatMessage, PublicProfile } from '@st/domain';
import { Avatar, BidiText, Haptics, Icon, isolate, radius, Row, spacing, Text, useTheme } from '@st/ui';
import { Pressable, View } from 'react-native';

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

const AVATAR = 32;
const TAIL = 4;
const JOIN = 8;

export function MessageBubble({
  message,
  own,
  author,
  groupStart,
  groupEnd,
  translation,
  onTranslate,
  onOptions,
}: {
  message: ChatMessage;
  own: boolean;
  author: PublicProfile | null;
  groupStart: boolean;
  groupEnd: boolean;
  translation?: Translation;
  onTranslate: () => void;
  onOptions: () => void;
}) {
  const { t, locale } = useT();
  const theme = useTheme();
  const c = theme.colors;
  const retracted = message.retractedAt !== null;
  const showTranslated = !!translation?.shown && !retracted;
  const canTranslate = !own && !retracted && needsTranslation(message.lang, locale);
  const name = author?.displayName ?? '—';
  const time = isolate(formatTime(message.createdAt, locale), 'ltr');
  const fg = own ? 'onPrimary' : 'text';
  const meta = own ? c.onPrimary : c.textTertiary;
  const metaOpacity = own ? 0.78 : 1;

  const bubble = (
    <Pressable
      onLongPress={() => {
        Haptics.selection();
        onOptions();
      }}
      delayLongPress={350}
      accessibilityHint={t('chat:message.moreOptions')}
      style={(st) => ({
        flexShrink: 1,
        paddingStart: spacing.md + 2,
        paddingEnd: spacing.md + 2,
        paddingTop: spacing.sm + 1,
        paddingBottom: spacing.sm,
        borderRadius: radius.lg,
        // Sender side: joined corners inside a group and the tail on its last bubble.
        borderTopStartRadius: !own && !groupStart ? JOIN : radius.lg,
        borderTopEndRadius: own && !groupStart ? JOIN : radius.lg,
        borderBottomStartRadius: !own ? (groupEnd ? TAIL : JOIN) : radius.lg,
        borderBottomEndRadius: own ? (groupEnd ? TAIL : JOIN) : radius.lg,
        backgroundColor: own ? (st.pressed ? c.primaryPressed : c.primary) : st.pressed ? c.surfaceSunken : c.surface,
        ...(own ? null : theme.elevation(1)),
        gap: spacing.xs,
      })}
    >
      {retracted ? (
        <Row gap="xs">
          <Icon name="Prohibit" size={16} color={meta} />
          <Text variant="callout" style={{ color: meta, fontStyle: 'normal' }}>
            {t('chat:message.retracted')}
          </Text>
        </Row>
      ) : (
        <BidiText variant="body" mode="block" color={fg} testID={`chat.message.${message.id}.body`} accessibilityLanguage={message.lang ?? undefined}>
          {message.body}
        </BidiText>
      )}
      {showTranslated && translation ? (
        <View
          testID={`chat.message.${message.id}.translated`}
          style={{ borderStartWidth: 3, borderStartColor: own ? c.onPrimary : c.primary, paddingStart: spacing.sm, paddingTop: 2, paddingBottom: 2, gap: 2 }}
        >
          <BidiText variant="callout" mode="block" color={own ? 'onPrimary' : 'textSecondary'} accessibilityLanguage={locale}>
            {translation.text}
          </BidiText>
          {message.lang ? (
            <Text variant="caption" style={{ color: meta }}>
              {t('chat:translate.translatedFrom', { language: languageName(message.lang, locale) })}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Row gap="xs" style={{ alignSelf: 'flex-end', marginTop: -2 }}>
        {message.moderation === 'pending' ? (
          <Text variant="caption" style={{ color: meta, opacity: metaOpacity }}>
            {t('chat:message.checking')}
          </Text>
        ) : null}
        <Text variant="caption" style={{ color: meta, opacity: metaOpacity, fontVariant: ['tabular-nums'], fontSize: 11 }}>
          {time}
        </Text>
      </Row>
    </Pressable>
  );

  return (
    <View testID={`chat.message.${message.id}`} style={{ marginTop: groupStart ? spacing.md : 3 }}>
      {groupStart && !own ? (
        <Row gap="xs" style={{ marginBottom: spacing.xs, paddingStart: AVATAR + spacing.sm + spacing.xs }}>
          <BidiText variant="caption" weight="semibold" color="textSecondary" numberOfLines={1}>
            {name}
          </BidiText>
          {author ? <ReliabilityDot status={author.reliabilityStatus} score={author.reliabilityScore} /> : null}
        </Row>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: own ? 'flex-end' : 'flex-start', gap: spacing.sm }}>
        {!own ? (
          <View style={{ width: AVATAR, alignSelf: 'flex-start' }}>{groupStart ? <Avatar name={name} uri={author?.avatarUrl} size="sm" decorative /> : null}</View>
        ) : null}
        <View style={{ maxWidth: '78%', flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xxs }}>
          {own ? <OptionsButton id={message.id} onPress={onOptions} /> : null}
          {bubble}
          {!own ? <OptionsButton id={message.id} onPress={onOptions} /> : null}
        </View>
      </View>
      {canTranslate ? (
        <Pressable
          testID={`chat.message.${message.id}.translate`}
          role="button"
          onPress={onTranslate}
          hitSlop={8}
          style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 32, marginStart: AVATAR + spacing.sm + spacing.xs }}
        >
          <Icon name="Translate" size={14} color="primaryText" />
          <Text variant="caption" weight="semibold" color="primaryText">
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
      role="button"
      aria-label={t('chat:message.moreOptions')}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name="DotsThree" size={20} weight="bold" color="textTertiary" />
    </Pressable>
  );
}
