/**
 * Game chat (design v2 §15.7, architecture §5.3). Realtime events are merged by id;
 * sends go through the moderation pipeline. UX:
 * - header: sport badge, game title, day and time; a "messages disappear" info pill.
 * - bubbles grouped by author (avatar + name on the first, tail on the last) with day separators.
 * - nudge: a client blocklist hit raises an inline amber sheet above the composer (Edit /
 *   Send anyway); a server nudge is delivered with a short explanation.
 * - block: nothing is sent, the text stays in the composer, a calm card explains why and
 *   links to the rules; a mute replaces the composer with "Chat paused until …".
 * - translate per message, report (long press or ⋯ → options sheet), block the author.
 * - expired chat: read-only banner.
 */
import {
  DEFAULT_TRUST_CONFIG,
  chatExpiresAt,
  matchBlocklist,
  type ChatMessage,
  type ModerationVerdict,
  type PublicProfile,
  type StError,
  type UserReportCategory,
} from '@st/domain';
import {
  BidiText,
  Button,
  Chip,
  EmptyState,
  Haptics,
  Icon,
  IconButton,
  isolate,
  ListGroup,
  ListItem,
  radius,
  Row,
  Skeleton,
  spacing,
  SportGlyphBadge,
  Stack,
  StatusPill,
  Text,
  TextField,
  useTheme,
} from '@st/ui';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BackButton } from '@/components/Screen';
import { ErrorView, InlineError } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { toStError } from '@/data/errors';
import { useGame } from '@/features/game/useGame';
import { Notice } from '@/features/kit/Notice';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT, type TFunction } from '@/i18n';
import { formatDate, formatDay, formatTime } from '@/lib/format';
import { useSession } from '@/state/session';

import { MessageBubble, type Translation } from './MessageBubble';

const REPORT_CATEGORIES: UserReportCategory[] = ['harassment', 'violence', 'unsportsmanlike', 'spam', 'other'];
/** Messages from one author within this gap form a visual group. */
const GROUP_GAP_MS = 5 * 60_000;

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string, now: number, t: TFunction, locale: string): string {
  const start = (ms: number) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const diff = Math.round((start(now) - start(Date.parse(iso))) / 86_400_000);
  if (diff === 0) return t('chat:day.today');
  if (diff === 1) return t('chat:day.yesterday');
  return formatDate(iso, locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "Today" / "Yesterday" (capitalized catalog strings), else the localized relative day or date. */
function headerDay(iso: string, now: number, t: TFunction, locale: string): string {
  const label = dayLabel(iso, now, t, locale);
  return label === t('chat:day.today') || label === t('chat:day.yesterday') ? label : formatDay(iso, locale, now);
}

export function ChatScreen({ gameId }: { gameId: string }) {
  const { t, locale } = useT();
  const theme = useTheme();
  const port = useData();
  const toast = useToast();
  const session = useSession();
  const now = useNow(30_000);
  const meId = session.user?.id ?? '';
  const { game, participants } = useGame(gameId);
  const history = useAsync(() => port.listMessages(gameId, { limit: 100 }), [port, gameId]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [nudge, setNudge] = useState(false);
  const [blocked, setBlocked] = useState<ModerationVerdict | null>(null);
  const [serverNudge, setServerNudge] = useState<string | null>(null);
  const [mutedUntil, setMutedUntil] = useState<string | null>(session.profile?.chatMutedUntil ?? null);
  const [translations, setTranslations] = useState<Record<string, Translation>>({});
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [reportFor, setReportFor] = useState<ChatMessage | null>(null);
  const [blockTarget, setBlockTarget] = useState<{ id: string; name: string } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<StError | null>(null);
  const block = useAction(async (userId: string) => port.blockUser(userId));

  const merge = useCallback((incoming: readonly ChatMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  useEffect(() => {
    if (history.data) merge(history.data);
  }, [history.data, merge]);

  useEffect(
    () =>
      port.subscribeChat(gameId, (e) => {
        if (e.type === 'message') merge([e.message]);
        else setMessages((prev) => prev.map((m) => (m.id === e.messageId ? { ...m, retractedAt: e.at } : m)));
      }),
    [port, gameId, merge],
  );

  const people = useMemo(() => new Map<string, PublicProfile>((participants.data ?? []).map((p) => [p.userId, p.profile])), [participants.data]);
  const visible = messages.filter((m) => !hidden.has(m.senderId));

  const g = game.data;
  if ((game.loading && !g) || (history.loading && !history.data)) {
    return (
      <Frame>
        <ChatSkeleton />
      </Frame>
    );
  }
  if (!g || history.error) {
    return (
      <Frame>
        <ErrorView error={game.error ?? history.error} onRetry={() => void history.reload()} />
      </Frame>
    );
  }

  const expiresAt = chatExpiresAt(g, DEFAULT_TRUST_CONFIG);
  const expired = now >= Date.parse(expiresAt);
  const muted = !!mutedUntil && Date.parse(mutedUntil) > now;
  const hours = DEFAULT_TRUST_CONFIG.chatTtlHoursAfterEnd;
  const canSend = !!text.trim() && !sending;

  const doSend = async (body: string) => {
    setSending(true);
    setSendError(null);
    let res: Awaited<ReturnType<typeof port.sendMessage>>;
    try {
      res = await port.sendMessage(gameId, body, Crypto.randomUUID());
    } catch (e) {
      const err = toStError(e);
      if (err.code === 'chat_muted') {
        const profile = await port.getMyProfile().catch(() => null);
        setMutedUntil(profile?.chatMutedUntil ?? new Date(Date.now() + 3600_000).toISOString());
      } else setSendError(err);
      Haptics.trigger('actionFailed');
      return;
    } finally {
      setSending(false);
    }
    setNudge(false);
    if (res.mutedUntil) setMutedUntil(res.mutedUntil);
    if (res.verdict.decision === 'block' || !res.message) {
      Haptics.warning();
      setBlocked(res.verdict); // the text stays in the composer
      return;
    }
    Haptics.light();
    setBlocked(null);
    setServerNudge(res.verdict.decision === 'nudge' ? res.verdict.reasonKey : null);
    merge([res.message]);
    setText('');
  };

  const onSend = () => {
    const body = text.trim();
    if (!body || sending) return;
    setBlocked(null);
    // Client blocklist: instant, untrusted feedback before the server decides.
    if (!nudge && matchBlocklist(body, locale).matched) {
      Haptics.warning();
      setNudge(true);
      return;
    }
    void doSend(body);
  };

  const translate = async (m: ChatMessage) => {
    const current = translations[m.id];
    if (current && !current.loading) {
      setTranslations((p) => ({ ...p, [m.id]: { ...current, shown: !current.shown } }));
      return;
    }
    setTranslations((p) => ({ ...p, [m.id]: { text: '', shown: false, loading: true } }));
    try {
      const tr = await port.translateMessage(m.id, locale);
      setTranslations((p) => ({ ...p, [m.id]: { text: tr.text, shown: true } }));
    } catch {
      setTranslations((p) => {
        const next = { ...p };
        delete next[m.id];
        return next;
      });
      toast(t('chat:translate.failed'), 'error');
    }
  };

  const blockReason = blocked?.reasonKey ? t(`chat:${blocked.reasonKey}`) : t('chat:moderation.block.title');
  const menuAuthor = menuFor ? (people.get(menuFor.senderId)?.displayName ?? '—') : '';

  return (
    <Frame
      header={
        <Row gap="md" style={{ flex: 1 }}>
          <SportGlyphBadge sport={g.sport} size={36} variant="solid" squircle />
          <Stack gap="xxs" style={{ flex: 1 }}>
            <BidiText variant="headline" numberOfLines={1} role="heading">
              {g.title}
            </BidiText>
            <Row gap="xs">
              <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                {headerDay(g.startsAt, now, t, locale)}
              </Text>
              <Text variant="footnote" color="textTertiary" aria-hidden>
                ·
              </Text>
              <Text variant="footnote" color="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>
                {isolate(formatTime(g.startsAt, locale), 'ltr')}
              </Text>
            </Row>
          </Stack>
        </Row>
      }
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs, paddingStart: spacing.lg, paddingEnd: spacing.lg }}>
          <View testID="chat.infoChip" accessible aria-label={t('chat:infoDetail', { hours, days: DEFAULT_TRUST_CONFIG.moderationRetentionDays })}>
            <StatusPill tone="info" icon="Timer" label={t('chat:infoChip', { hours })} />
          </View>
        </View>
        {expired ? (
          <View style={{ paddingStart: spacing.lg, paddingEnd: spacing.lg, paddingTop: spacing.sm }}>
            <Notice testID="chat.expired" tone="neutral" icon="ChatSlash" text={t('chat:expired')} />
          </View>
        ) : null}
        <FlatList
          testID="chat.list"
          inverted={visible.length > 0}
          data={visible}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingStart: spacing.md, paddingEnd: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.md, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: 'center' }} testID="chat.empty">
              <EmptyState illustration="noChat" title={t('chat:title')} body={t('chat:empty', { hours })} />
            </View>
          }
          renderItem={({ item, index }) => {
            const older = visible[index + 1];
            const newer = visible[index - 1];
            const newDay = !older || dayKey(older.createdAt) !== dayKey(item.createdAt);
            const groupStart = newDay || !older || older.senderId !== item.senderId || Date.parse(item.createdAt) - Date.parse(older.createdAt) > GROUP_GAP_MS;
            const groupEnd =
              !newer || newer.senderId !== item.senderId || dayKey(newer.createdAt) !== dayKey(item.createdAt) || Date.parse(newer.createdAt) - Date.parse(item.createdAt) > GROUP_GAP_MS;
            return (
              <View>
                {newDay ? <DaySeparator label={dayLabel(item.createdAt, now, t, locale)} /> : null}
                <MessageBubble
                  message={item}
                  own={item.senderId === meId}
                  author={people.get(item.senderId) ?? null}
                  groupStart={groupStart}
                  groupEnd={groupEnd}
                  translation={translations[item.id]}
                  onTranslate={() => void translate(item)}
                  onOptions={() => setMenuFor(item)}
                />
              </View>
            );
          }}
        />

        {!expired ? (
          <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
            {muted ? (
              <Row gap="md" testID="chat.muted" aria-live="polite" style={{ padding: spacing.lg }}>
                <View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.warningSubtle }}>
                  <Icon name="Hourglass" size={20} weight="fill" color="warningText" />
                </View>
                <Text variant="callout" style={{ flex: 1 }}>
                  {t('chat:moderation.muted', { time: isolate(formatTime(mutedUntil as string, locale), 'ltr') })}
                </Text>
                <Button
                  testID="chat.muted.why"
                  variant="ghost"
                  size="sm"
                  label={t('chat:moderation.mutedWhy')}
                  onPress={async () => {
                    const list = await port.listMySanctions().catch(() => []);
                    const s = list.find((x) => x.kind === 'chat_mute' && (x.status === 'active' || x.status === 'disputed'));
                    if (s) router.push(`/sanctions/${s.id}`);
                  }}
                />
              </Row>
            ) : (
              <>
                {nudge ? (
                  <View
                    testID="chat.nudge"
                    aria-live="polite"
                    style={{ gap: spacing.md, padding: spacing.lg, backgroundColor: theme.colors.warningSubtle, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}
                  >
                    <Row gap="md" align="start">
                      <View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface }}>
                        <Icon name="HandWaving" size={20} weight="fill" color="warningText" />
                      </View>
                      <Stack gap="xxs" style={{ flex: 1 }}>
                        <Text variant="headline" color="warningText">
                          {t('chat:moderation.nudge.title')}
                        </Text>
                        <Text variant="callout">{t('chat:moderation.nudge.body')}</Text>
                      </Stack>
                    </Row>
                    <Row gap="sm" style={{ paddingStart: 36 + spacing.md }}>
                      <Button testID="chat.nudge.edit" variant="outline" size="sm" icon="PencilSimple" label={t('chat:moderation.nudge.edit')} onPress={() => setNudge(false)} />
                      <Button testID="chat.nudge.sendAnyway" variant="ghost" size="sm" label={t('chat:moderation.nudge.sendAnyway')} onPress={() => void doSend(text.trim())} />
                    </Row>
                  </View>
                ) : null}
                <View style={{ padding: spacing.md, gap: spacing.sm }}>
                  {blocked ? (
                    <View
                      testID="chat.block"
                      aria-live="assertive"
                      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: theme.colors.surfaceSunken }}
                    >
                      <View aria-hidden style={{ width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.dangerSubtle }}>
                        <Icon name="ShieldWarning" size={20} weight="fill" color="dangerText" />
                      </View>
                      <Stack gap="xxs" style={{ flex: 1 }}>
                        <Text variant="callout">{blockReason}</Text>
                        <Pressable role="link" onPress={() => router.push('/legal/terms')} hitSlop={8} style={{ minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                          <Text variant="footnote" weight="semibold" color="primaryText">
                            {t('chat:moderation.block.rulesLink')}
                          </Text>
                          <Icon name="ArrowSquareOut" size={14} color="primaryText" />
                        </Pressable>
                      </Stack>
                    </View>
                  ) : null}
                  {serverNudge ? (
                    <Row gap="xs" testID="chat.nudge.server" aria-live="polite" align="start">
                      <Icon name="Info" size={16} weight="fill" color="warningText" />
                      <Text variant="footnote" color="warningText" style={{ flex: 1 }}>
                        {t(`chat:${serverNudge}`)}
                      </Text>
                    </Row>
                  ) : null}
                  <InlineError error={sendError} />
                  <Row gap="sm" align="end">
                    <View
                      style={{
                        flex: 1,
                        minHeight: 44,
                        justifyContent: 'center',
                        borderRadius: 22,
                        backgroundColor: theme.colors.surfaceSunken,
                        borderWidth: 1,
                        borderColor: nudge ? theme.colors.warning : 'transparent',
                        paddingStart: spacing.lg,
                        paddingEnd: spacing.lg,
                      }}
                    >
                      <TextInput
                        testID="chat.input"
                        aria-label={t('chat:composer.placeholder')}
                        placeholder={t('chat:composer.placeholder')}
                        placeholderTextColor={theme.colors.textTertiary}
                        value={text}
                        onChangeText={(v) => {
                          setText(v);
                          if (nudge) setNudge(false);
                        }}
                        multiline
                        numberOfLines={1}
                        maxLength={1000}
                        onSubmitEditing={onSend}
                        blurOnSubmit={false}
                        style={{
                          minHeight: 24,
                          maxHeight: 120,
                          paddingTop: 10,
                          paddingBottom: 10,
                          fontSize: 16,
                          lineHeight: 22,
                          color: theme.colors.text,
                          fontFamily: theme.fontFamily('regular'),
                          textAlign: 'auto',
                          ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', dir: 'auto' } as object) : null),
                        }}
                      />
                    </View>
                    <IconButton
                      testID="chat.send"
                      icon="PaperPlaneRight"
                      weight="fill"
                      variant="filled"
                      size="md"
                      label={t('chat:composer.send')}
                      disabled={!canSend}
                      onPress={onSend}
                    />
                  </Row>
                </View>
              </>
            )}
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {/* Message options (also the accessible alternative to long press). */}
      <Modal visible={!!menuFor} transparent animationType="fade" onRequestClose={() => setMenuFor(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable role="button" aria-label={t('common:actions.close')} onPress={() => setMenuFor(null)} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim }} />
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.colors.background, borderTopStartRadius: radius.xl, borderTopEndRadius: radius.xl, ...theme.elevation(3) }}>
            <Stack padding="lg" gap="lg" testID="chat.menu" style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
              <View aria-hidden style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: theme.colors.textTertiary, opacity: 0.4 }} />
              {menuFor && menuFor.body ? (
                <View style={{ paddingStart: spacing.md, borderStartWidth: 3, borderStartColor: theme.colors.primary }}>
                  <Text variant="caption" weight="semibold" color="textSecondary">
                    {menuAuthor}
                  </Text>
                  <BidiText variant="callout" mode="block" numberOfLines={2} color="textSecondary">
                    {menuFor.body}
                  </BidiText>
                </View>
              ) : null}
              {menuFor && menuFor.senderId !== meId ? (
                <ListGroup>
                  <ListItem testID={`chat.message.${menuFor.id}.menuTranslate`} icon="Translate" iconTone="info" title={t('chat:message.translate')} chevron={false} onPress={() => { const m = menuFor; setMenuFor(null); void translate(m); }} />
                  <ListItem testID={`chat.message.${menuFor.id}.report`} icon="Flag" iconTone="warning" title={t('chat:message.report')} chevron={false} onPress={() => { setReportFor(menuFor); setMenuFor(null); }} />
                  <ListItem
                    testID={`chat.message.${menuFor.id}.block`}
                    icon="UserMinus"
                    destructive
                    chevron={false}
                    title={t('chat:message.block', { name: isolate(menuAuthor) })}
                    onPress={() => {
                      setBlockTarget({ id: menuFor.senderId, name: menuAuthor });
                      setMenuFor(null);
                    }}
                  />
                </ListGroup>
              ) : null}
              <Button variant="outline" size="lg" fullWidth label={t('common:actions.close')} onPress={() => setMenuFor(null)} />
            </Stack>
          </SafeAreaView>
        </View>
      </Modal>

      {reportFor ? (
        <ReportDialog
          message={reportFor}
          onClose={() => setReportFor(null)}
          onReported={() => {
            const m = reportFor;
            setReportFor(null);
            toast(t('chat:report.thanks', { days: DEFAULT_TRUST_CONFIG.moderationRetentionDays }));
            setBlockTarget({ id: m.senderId, name: people.get(m.senderId)?.displayName ?? '—' });
          }}
        />
      ) : null}

      <ConfirmDialog
        testID="chat.blockDialog"
        visible={!!blockTarget}
        title={t('chat:block.title', { name: isolate(blockTarget?.name ?? '') })}
        body={t('chat:block.body')}
        confirmLabel={t('chat:block.confirm', { name: isolate(blockTarget?.name ?? '') })}
        cancelLabel={t('common:actions.notNow')}
        destructive
        busy={block.busy}
        onCancel={() => setBlockTarget(null)}
        onConfirm={async () => {
          if (!blockTarget) return;
          await block.run(blockTarget.id);
          Haptics.trigger('destructiveConfirm');
          setHidden((h) => new Set(h).add(blockTarget.id));
          toast(t('chat:block.done', { name: isolate(blockTarget.name) }));
          setBlockTarget(null);
        }}
      />
    </Frame>
  );
}

function DaySeparator({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View role="heading" aria-level={2} style={{ alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xs }}>
      <View style={{ paddingStart: spacing.md, paddingEnd: spacing.md, paddingTop: 3, paddingBottom: 3, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken }}>
        <Text variant="caption" weight="semibold" color="textSecondary">
          {label}
        </Text>
      </View>
    </View>
  );
}

function Frame({ header, children }: { header?: ReactNode; children: ReactNode }) {
  const { t } = useT();
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.background }} testID="screen.game.chat">
      <Row gap="xs" style={{ minHeight: 64, paddingStart: spacing.sm, paddingEnd: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <BackButton />
        {header ?? (
          <Text variant="headline" role="heading" style={{ flex: 1 }}>
            {t('chat:title')}
          </Text>
        )}
      </Row>
      <View style={{ flex: 1, width: '100%', maxWidth: 820, alignSelf: 'center' }}>{children}</View>
    </SafeAreaView>
  );
}

function ChatSkeleton() {
  return (
    <View aria-busy testID="state.loading" style={{ padding: spacing.lg, gap: spacing.md, flex: 1, justifyContent: 'flex-end' }}>
      {[180, 240, 140].map((w, i) => (
        <Row key={i} gap="sm" align="end">
          <Skeleton width={32} height={32} radius={16} />
          <Skeleton width={w} height={44} radius={radius.lg} />
        </Row>
      ))}
      <View style={{ alignItems: 'flex-end' }}>
        <Skeleton width={200} height={44} radius={radius.lg} />
      </View>
    </View>
  );
}

function ReportDialog({ message, onClose, onReported }: { message: ChatMessage; onClose: () => void; onReported: () => void }) {
  const { t } = useT();
  const port = useData();
  const [category, setCategory] = useState<UserReportCategory | null>(null);
  const [note, setNote] = useState('');
  const report = useAction(async () =>
    port.reportUser({ targetUserId: message.senderId, category: category as UserReportCategory, gameId: message.gameId, messageId: message.id, note: note.trim() || null }),
  );
  return (
    <ConfirmDialog
      testID="chat.report"
      visible
      title={t('chat:report.title')}
      confirmLabel={t('chat:report.submit')}
      cancelLabel={t('common:actions.cancel')}
      busy={report.busy}
      onCancel={onClose}
      onConfirm={async () => {
        if (!category) return;
        if (await report.run()) onReported();
      }}
    >
      <Stack gap="md">
        <Text variant="label" color="textSecondary">
          {t('chat:report.reasonsTitle')}
        </Text>
        <Row gap="sm" wrap role="radiogroup" aria-label={t('chat:report.reasonsTitle')}>
          {REPORT_CATEGORIES.map((c) => (
            <Chip key={c} testID={`chat.report.category.${c}`} selectionRole="radio" label={t(`chat:report.category.${c}`)} selected={category === c} onToggle={() => setCategory(c)} />
          ))}
        </Row>
        <TextField testID="chat.report.note" label={t('chat:report.detailsLabel')} value={note} onChangeText={setNote} maxLength={500} multiline inputDirection="auto" />
        <InlineError error={report.error} />
      </Stack>
    </ConfirmDialog>
  );
}
