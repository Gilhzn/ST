/**
 * Supabase-backed stores of the Phase 1.5 functions. RPC names and argument
 * names follow the Phase 1.5 migrations (`supabase/migrations/01*.sql`).
 *
 * - `anon`: anon-safe reads (`get_invite_preview`).
 * - `asUser(token)`: RPCs that must run as the caller (`create_upload_intent`).
 * - `admin` (service role): jobs and the writes assigned to Edge Functions
 *   (`finalize_media`, `apply_effects`, `run_rating_period`, notifications).
 */
import { DEFAULT_PHASE15_CONFIG, isSportId, resolvePhase15Config, type Effect, type Phase15Config, type Phase15Effect, type InvitePreview, type MediaStatus, type MediaUploadRequest, type Phase15NotificationKind } from '@st/domain';
import type { MediaProcessStore, MediaRecord } from '#fn/media-process/handler';
import type { MediaUploadStore, UploadIntentRow } from '#fn/media-upload/handler';
import type { InvitePreviewStore } from '#fn/invite-preview/handler';
import type { RatingChange, RatingPeriodStore } from '#fn/rating-period/handler';
import type { SeriesJobsStore } from '#fn/series-jobs/handler';
import { iso } from '#shared/rows';
import type { SupabaseClient } from '#shared/supabase';

type Row = Record<string, unknown>;

export interface Phase15StoreClients {
  admin: SupabaseClient;
  anon: SupabaseClient;
  asUser(accessToken: string): SupabaseClient;
}

export type Phase15Store = MediaUploadStore & MediaProcessStore & InvitePreviewStore & SeriesJobsStore & RatingPeriodStore;

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** `get_invite_preview` JSON → {@link InvitePreview} (defensive: the page never trusts shapes). */
export function rowToInvitePreview(r: Row | null): InvitePreview | null {
  if (!r || typeof r !== 'object' || typeof r['title'] !== 'string' || !isSportId(r['sport'])) return null;
  const weekday = numOrNull(r['weekday']);
  const recurrence = r['recurrence'] === 'weekly' || r['recurrence'] === 'biweekly' ? r['recurrence'] : null;
  return {
    sport: r['sport'],
    title: r['title'],
    startsAt: strOrNull(r['startsAt']),
    timeZone: strOrNull(r['timeZone']),
    recurrence,
    weekday: weekday !== null && Number.isInteger(weekday) && weekday >= 1 && weekday <= 7 ? (weekday as InvitePreview['weekday']) : null,
    localStartTime: strOrNull(r['localStartTime']),
    areaLabel: strOrNull(r['areaLabel']),
    spotsLeft: numOrNull(r['spotsLeft']),
    capacity: num(r['capacity']) || 0,
    womenOnly: r['womenOnly'] === true,
    hostDisplayName: typeof r['hostDisplayName'] === 'string' ? r['hostDisplayName'] : '',
    ogImageUrl: strOrNull(r['ogImageUrl']),
  };
}

export function rowToMediaRecord(r: Row): MediaRecord {
  return {
    id: String(r['id']),
    gameId: String(r['game_id']),
    uploaderId: String(r['uploader_id']),
    kind: r['kind'] === 'video' ? 'video' : 'photo',
    status: String(r['status']) as MediaStatus,
    mimeType: String(r['mime_type']),
    sizeBytes: num(r['size_bytes']),
    durationSeconds: numOrNull(r['duration_seconds']),
    storagePath: String(r['storage_path']),
    createdAt: iso(r['created_at']),
  };
}

export function createPhase15Store({ admin, anon, asUser }: Phase15StoreClients): Phase15Store {
  return {
    // ----- media-upload ------------------------------------------------------
    async createUploadIntent(accessToken: string, req: MediaUploadRequest): Promise<UploadIntentRow> {
      const r = await asUser(accessToken).rpc<Row>('create_upload_intent', {
        p_game_id: req.gameId,
        p_kind: req.kind,
        p_mime_type: req.mimeType,
        p_size_bytes: req.sizeBytes,
        p_duration_seconds: req.durationSeconds ?? null,
      });
      return {
        mediaId: String(r['mediaId'] ?? r['media_id']),
        storagePath: String(r['storagePath'] ?? r['storage_path']),
        maxBytes: num(r['maxBytes'] ?? r['max_bytes']),
        expiresAt: iso(r['expiresAt'] ?? r['expires_at']),
      };
    },

    // ----- media-process -----------------------------------------------------
    async loadMedia(mediaId) {
      const rows = await admin.select<Row>('media_items', {
        columns: 'id,game_id,uploader_id,kind,status,mime_type,size_bytes,duration_seconds,storage_path,created_at',
        filters: [['id', 'eq', mediaId]],
        limit: 1,
      });
      return rows[0] ? rowToMediaRecord(rows[0]) : null;
    },
    async finalizeMedia(input) {
      const status = await admin.rpc<unknown>('finalize_media', {
        p_media_id: input.mediaId,
        p_status: input.status,
        p_verdict: input.verdict,
        p_published_path: input.publishedPath,
        p_thumbnail_path: input.thumbnailPath,
        p_mime_type: input.mimeType,
        p_size_bytes: input.sizeBytes,
        p_duration_seconds: input.durationSeconds,
        p_playback_ref: input.playbackRef,
      });
      const s = typeof status === 'string' ? status : status && typeof status === 'object' ? (status as Row)['status'] : null;
      return (typeof s === 'string' ? s : input.status) as MediaStatus;
    },
    async applyEffects(effects: readonly (Effect | Phase15Effect)[]) {
      if (effects.length > 0) await admin.rpc('apply_effects', { p_effects: effects });
    },

    // ----- invite-preview ----------------------------------------------------
    async getInvitePreview(token) {
      return rowToInvitePreview(await anon.rpc<Row | null>('get_invite_preview', { p_token: token }));
    },

    // ----- series-jobs -------------------------------------------------------
    async generateOccurrences() {
      return num(await admin.rpc('generate_occurrences')) || 0;
    },
    async alwaysInAutojoin() {
      return num(await admin.rpc('always_in_autojoin')) || 0;
    },
    async notificationIdsSince(kinds: readonly Phase15NotificationKind[], since, limit) {
      const rows = await admin.select<Row>('notifications', {
        columns: 'id',
        filters: [['kind', 'in', kinds], ['created_at', 'gte', since]],
        order: { column: 'created_at', ascending: true },
        limit,
      });
      return rows.map((r) => String(r['id']));
    },

    // ----- rating-period -----------------------------------------------------
    async runRatingPeriod() {
      return num(await admin.rpc('run_rating_period')) || 0;
    },
    async recentRatingChanges(processedSince) {
      const periods = await admin.select<Row>('rating_periods', {
        columns: 'period',
        filters: [['processed_at', 'gte', processedSince]],
        order: { column: 'period', ascending: true },
        limit: 16,
      });
      if (periods.length === 0) return [];
      const updates = await admin.select<Row>('rating_updates', {
        columns: 'user_id,sport,format_family,period,r_before,r_after,frozen',
        filters: [['period', 'in', periods.map((p) => String(p['period']))]],
        order: { column: 'period', ascending: true },
        limit: 50_000,
      });
      if (updates.length === 0) return [];
      const userIds = [...new Set(updates.map((u) => String(u['user_id'])))];
      const ratings = new Map<string, Row>();
      const reliability = new Map<string, number | null>();
      for (let i = 0; i < userIds.length; i += 200) {
        const ids = userIds.slice(i, i + 200);
        const [sr, pr] = await Promise.all([
          admin.select<Row>('skill_ratings', { columns: 'user_id,sport,format_family,games,rd', filters: [['user_id', 'in', ids]] }),
          admin.select<Row>('profiles', { columns: 'id,reliability_score', filters: [['id', 'in', ids]] }),
        ]);
        for (const r of sr) ratings.set(`${String(r['user_id'])}|${String(r['sport'])}|${String(r['format_family'])}`, r);
        for (const p of pr) reliability.set(String(p['id']), numOrNull(p['reliability_score']));
      }
      const out: RatingChange[] = [];
      for (const u of updates) {
        const sport = u['sport'];
        if (!isSportId(sport)) continue;
        const key = `${String(u['user_id'])}|${sport}|${String(u['format_family'])}`;
        const current = ratings.get(key);
        out.push({
          userId: String(u['user_id']),
          sport,
          formatFamily: String(u['format_family']) as RatingChange['formatFamily'],
          period: String(u['period']),
          rBefore: num(u['r_before']),
          rAfter: num(u['r_after']),
          frozen: u['frozen'] === true,
          games: current ? num(current['games']) : 0,
          rd: current ? num(current['rd']) : Number.POSITIVE_INFINITY,
          reliability: reliability.get(String(u['user_id'])) ?? null,
        });
      }
      return out;
    },
    async loadPhase15Config() {
      const raw = await admin.rpc<unknown>('phase15_config_json');
      const numeric: Partial<Phase15Config> = {};
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw as Row)) {
          if (k in DEFAULT_PHASE15_CONFIG && typeof v === 'number' && Number.isFinite(v)) (numeric as Record<string, number>)[k] = v;
        }
      }
      return resolvePhase15Config(numeric);
    },
    async notifyMany(rows) {
      if (rows.length === 0) return [];
      const inserted = await admin.insert<Row>(
        'notifications',
        rows.map((n) => ({ user_id: n.userId, kind: n.kind, params: n.params, game_id: null, dedupe_key: n.dedupeKey })),
        { onConflict: 'dedupe_key', ignoreDuplicates: true },
      );
      return inserted.map((r) => String(r['id']));
    },
  };
}
