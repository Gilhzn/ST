/**
 * Game chat (design §13.11, architecture §5.3). Realtime events are merged by id;
 * sends go through the moderation pipeline. UX:
 * - nudge: a client blocklist hit shows an inline card before sending (Edit / Send
 *   anyway); a server nudge is delivered with an explanation.
 * - block: nothing is sent, the text stays in the composer, the reason is shown with
 *   a link to the rules; a mute replaces the composer with "Chat paused until …".
 * - translate per message, report message (kept 90 days), block the author.
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
import { BidiText, Button, Card, isolate, radius, Row, sizing, spacing, Stack, Text, TextField, useTheme } from '@st/ui';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChoiceChip } from '@/components/ChoiceChip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icon } from '@/components/Icon';
import { BackButton } from '@/components/Screen';
import { Banner, ErrorView, InlineError, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { useData } from '@/data/DataProvider';
import { toStError } from '@/data/errors';
import { useGame } from '@/features/game/useGame';
import { useAction, useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useT } from '@/i18n';
import { formatTime } from '@/lib/format';
import { useSession } from '@/state/session';

import { MessageBubble, type Translation } from './MessageBubble';

const REPORT_CATEGORIES: UserReportCategory[] = ['harassment', 'violence', 'unsportsmanlike', 'spam', 'other'];

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
      <Frame title={t('chat:title')}>
        <View style={{ padding: spacing.lg }}>
          <Skeleton rows={4} height={56} />
        </View>
      </Frame>
    );
  }
  if (!g || history.error) {
    return (
      <Frame title={t('chat:title')}>
        <ErrorView error={game.error ?? history.error} onRetry={() => void history.reload()} />
      </Frame>
    );
  }

  const expiresAt = chatExpiresAt(g, DEFAULT_TRUST_CONFIG);
  const expired = now >= Date.parse(expiresAt);
  const muted = !!mutedUntil && Date.parse(mutedUntil) > now;
  const hours = DEFAULT_TRUST_CONFIG.chatTtlHoursAfterEnd;

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
      return;
    } finally {
      setSending(false);
    }
    setNudge(false);
    if (res.mutedUntil) setMutedUntil(res.mutedUntil);
    if (res.verdict.decision === 'block' || !res.message) {
      setBlocked(res.verdict); // the text stays in the composer
      return;
    }
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
      title={t('chat:title')}
      subtitle={g.title}
      chip={
        <Text variant="caption" color="infoText" testID="chat.infoChip" accessibilityHint={t('chat:infoDetail', { hours, days: DEFAULT_TRUST_CONFIG.moderationRetentionDays })}>
          {t('chat:infoChip', { hours })}
        </Text>
      }
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {expired ? (
          <View style={{ padding: spacing.lg }}>
            <Banner testID="chat.expired" text={t('chat:expired')} />
          </View>
        ) : null}
        <FlatList
          testID="chat.list"
          inverted={visible.length > 0}
          data={visible}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingStart: spacing.lg, paddingEnd: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl }} testID="chat.empty">
              <Text variant="body" color="textSecondary" align="center">
                {t('chat:empty', { hours })}
              </Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const older = visible[index + 1];
            return (
              <MessageBubble
                message={item}
                own={item.senderId === meId}
                author={people.get(item.senderId) ?? null}
                showAuthor={!older || older.senderId !== item.senderId}
                translation={translations[item.id]}
                onTranslate={() => void translate(item)}
                onOptions={() => setMenuFor(item)}
              />
            );
          }}
        />

        {!expired ? (
          <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, padding: spacing.md, gap: spacing.sm }}>
            {muted ? (
              <Row gap="sm" testID="chat.muted" accessibilityLiveRegion="polite">
                <Icon name="timer-sand" />
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
                  <Card outlined testID="chat.nudge" style={{ borderColor: theme.colors.warning }}>
                    <Stack gap="sm" accessibilityLiveRegion="polite">
                      <Text variant="bodyStrong">{t('chat:moderation.nudge.title')}</Text>
                      <Text variant="callout" color="textSecondary">
                        {t('chat:moderation.nudge.body')}
                      </Text>
                      <Row gap="sm" wrap>
                        <Button testID="chat.nudge.edit" variant="secondary" size="sm" label={t('chat:moderation.nudge.edit')} onPress={() => setNudge(false)} />
                        <Button testID="chat.nudge.sendAnyway" variant="ghost" size="sm" label={t('chat:moderation.nudge.sendAnyway')} onPress={() => void doSend(text.trim())} />
                      </Row>
                    </Stack>
                  </Card>
                ) : null}
                {blocked ? (
                  <Card outlined testID="chat.block" style={{ borderColor: theme.colors.danger }}>
                    <Stack gap="xs" accessibilityLiveRegion="assertive">
                      <Text variant="callout" color="dangerText">
                        {blockReason}
                      </Text>
                      <Pressable accessibilityRole="link" onPress={() => router.push('/legal/terms')} style={{ minHeight: 32, justifyContent: 'center' }}>
                        <Text variant="caption" color="primaryText">
                          {t('chat:moderation.block.rulesLink')}
                        </Text>
                      </Pressable>
                    </Stack>
                  </Card>
                ) : null}
                {serverNudge ? (
                  <Text variant="caption" color="warningText" testID="chat.nudge.server" accessibilityLiveRegion="polite">
                    {t(`chat:${serverNudge}`)}
                  </Text>
                ) : null}
                <InlineError error={sendError} />
                <Row gap="sm" align="end">
                  <View style={{ flex: 1 }}>
                    <TextField
                      testID="chat.input"
                      label={t('chat:composer.placeholder')}
                      placeholder={t('chat:composer.placeholder')}
                      value={text}
                      onChangeText={(v) => {
                        setText(v);
                        if (nudge) setNudge(false);
                      }}
                      inputDirection="auto"
                      multiline
                      maxLength={1000}
                      onSubmitEditing={onSend}
                      blurOnSubmit={false}
                      containerStyle={{ gap: 0 }}
                    />
                  </View>
                  <Pressable
                    testID="chat.send"
                    accessibilityRole="button"
                    accessibilityLabel={t('chat:composer.send')}
                    aria-disabled={!text.trim() || sending}
                    disabled={!text.trim() || sending}
                    onPress={onSend}
                    style={({ pressed }) => ({
                      width: sizing.touchTarget,
                      height: sizing.touchTarget,
                      borderRadius: radius.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: !text.trim() ? theme.colors.disabledBg : pressed ? theme.colors.primaryPressed : theme.colors.primary,
                    })}
                  >
                    <Icon name="send" color={text.trim() ? 'onPrimary' : 'disabledText'} directional />
                  </Pressable>
                </Row>
              </>
            )}
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {/* Message options (also the accessible alternative to long press). */}
      <Modal visible={!!menuFor} transparent animationType="fade" onRequestClose={() => setMenuFor(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common:actions.close')} onPress={() => setMenuFor(null)} style={{ flex: 1, backgroundColor: theme.colors.scrim, justifyContent: 'flex-end' }}>
          <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.colors.surfaceRaised, borderTopStartRadius: radius.xl, borderTopEndRadius: radius.xl }}>
            <Stack padding="lg" gap="xs" testID="chat.menu">
              {menuFor && menuFor.senderId !== meId ? (
                <>
                  <MenuItem testID={`chat.message.${menuFor.id}.menuTranslate`} icon="translate" label={t('chat:message.translate')} onPress={() => { const m = menuFor; setMenuFor(null); void translate(m); }} />
                  <MenuItem testID={`chat.message.${menuFor.id}.report`} icon="flag-outline" label={t('chat:message.report')} onPress={() => { setReportFor(menuFor); setMenuFor(null); }} />
                  <MenuItem
                    testID={`chat.message.${menuFor.id}.block`}
                    icon="account-cancel"
                    label={t('chat:message.block', { name: isolate(menuAuthor) })}
                    onPress={() => {
                      setBlockTarget({ id: menuFor.senderId, name: menuAuthor });
                      setMenuFor(null);
                    }}
                  />
                </>
              ) : null}
              <MenuItem icon="close" label={t('common:actions.close')} onPress={() => setMenuFor(null)} />
            </Stack>
          </SafeAreaView>
        </Pressable>
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
          setHidden((h) => new Set(h).add(blockTarget.id));
          toast(t('chat:block.done', { name: isolate(blockTarget.name) }));
          setBlockTarget(null);
        }}
      />
    </Frame>
  );
}

function Frame({ title, subtitle, chip, children }: { title: string; subtitle?: string; chip?: ReactNode; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.background }} testID="screen.game.chat">
      <Row gap="sm" style={{ minHeight: 56, paddingStart: spacing.sm, paddingEnd: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <BackButton />
        <Stack gap="xxs" style={{ flex: 1 }}>
          <Text variant="title3" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <BidiText variant="caption" color="textSecondary" numberOfLines={1}>
              {subtitle}
            </BidiText>
          ) : null}
        </Stack>
        {chip ? <View style={{ maxWidth: 180, padding: spacing.xs, borderRadius: radius.md, backgroundColor: colors.infoSubtle }}>{chip}</View> : null}
      </Row>
      <View style={{ flex: 1, width: '100%', maxWidth: 820, alignSelf: 'center' }}>{children}</View>
    </SafeAreaView>
  );
}

function MenuItem({ icon, label, onPress, testID }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingStart: spacing.sm, borderRadius: radius.md, backgroundColor: pressed ? colors.surfaceSunken : 'transparent' })}
    >
      <Icon name={icon} />
      <Text variant="body">{label}</Text>
    </Pressable>
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
      <Stack gap="sm">
        <Text variant="label">{t('chat:report.reasonsTitle')}</Text>
        <Row gap="sm" wrap accessibilityRole="radiogroup">
          {REPORT_CATEGORIES.map((c) => (
            <ChoiceChip key={c} testID={`chat.report.category.${c}`} selectionRole="radio" label={t(`chat:report.category.${c}`)} selected={category === c} onToggle={() => setCategory(c)} />
          ))}
        </Row>
        <TextField testID="chat.report.note" label={t('chat:report.detailsLabel')} value={note} onChangeText={setNote} maxLength={500} multiline />
        <InlineError error={report.error} />
      </Stack>
    </ConfirmDialog>
  );
}
