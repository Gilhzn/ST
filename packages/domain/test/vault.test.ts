import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOMAIN_CONFIG,
  addMonthsUtc,
  applyMediaVerdict,
  checkMediaUpload,
  consentBlockers,
  deleteMedia,
  effectiveMediaVisibility,
  expireMedia,
  mediaExpiresAt,
  mediaRejectErrorCode,
  mediaUploadWindow,
  removeMediaTag,
  requestMediaVisibility,
  respondToMediaTag,
  tagMedia,
  untagDeletedAccount,
  untagMe,
  type MediaItem,
  type MediaModerationVerdict,
  type MediaTag,
  type MediaUploadCheckInput,
} from '../src';
import { G1, HOUR_MS, U1, U2, U3, U4 } from './helpers';

const C = DEFAULT_DOMAIN_CONFIG;
const game = { startsAt: '2026-11-01T18:00:00.000Z', endsAt: '2026-11-01T20:00:00.000Z' };
const END = Date.parse(game.endsAt);
const MB = 1024 * 1024;

describe('upload window and limits (VAULT-001/002)', () => {
  const base: MediaUploadCheckInput = { game, verifiedAttendee: true, request: { gameId: G1, kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 5 * MB }, existingCount: 0 };
  const chk = (o: Partial<MediaUploadCheckInput> = {}, now = END) => checkMediaUpload({ ...base, ...o }, C, now);
  const vid = (o: object) => ({ request: { gameId: G1, kind: 'video' as const, mimeType: 'video/mp4', sizeBytes: 100 * MB, durationSeconds: 30, ...o } });
  it('window startsAt … endsAt + 2 h inclusive (AC-VAULT-001)', () => {
    expect(mediaUploadWindow(game)).toEqual({ opensAt: game.startsAt, closesAt: '2026-11-01T22:00:00.000Z' });
    expect(chk({}, Date.parse(game.startsAt) - 1)).toEqual({ ok: false, error: 'window_not_open' });
    expect(chk({}, END + 2 * HOUR_MS)).toEqual({ ok: true, value: { maxBytes: 20 * MB } });
    expect(chk({}, END + 2 * HOUR_MS + 5 * 60_000)).toEqual({ ok: false, error: 'window_closed' });
  });
  it('limits in order', () => {
    expect(chk({ verifiedAttendee: false })).toEqual({ ok: false, error: 'not_verified_attendee' });
    expect(chk({ request: { ...base.request, mimeType: 'image/gif' } })).toEqual({ ok: false, error: 'unsupported_type' });
    expect(chk({ request: { ...base.request, kind: 'audio' as never } })).toEqual({ ok: false, error: 'unsupported_type' });
    expect(chk({ request: { ...base.request, mimeType: 'IMAGE/JPEG', sizeBytes: 20 * MB } }).ok).toBe(true);
    expect(chk({ request: { ...base.request, sizeBytes: 20 * MB + 1 } })).toEqual({ ok: false, error: 'too_large' });
    expect(chk({ request: { ...base.request, sizeBytes: 0 } })).toEqual({ ok: false, error: 'too_large' });
    expect(chk(vid({}))).toEqual({ ok: true, value: { maxBytes: 200 * MB } });
    expect(chk(vid({ durationSeconds: 60 })).ok).toBe(true);
    expect(chk(vid({ durationSeconds: 61 }))).toEqual({ ok: false, error: 'too_long' });
    expect(chk(vid({ durationSeconds: null }))).toEqual({ ok: false, error: 'unsupported_type' });
    expect(chk(vid({ sizeBytes: 201 * MB }))).toEqual({ ok: false, error: 'too_large' });
    expect(chk({ existingCount: 29 }).ok).toBe(true);
    expect(chk({ existingCount: 30 })).toEqual({ ok: false, error: 'user_cap_reached' });
  });
  it('maps reasons to DataPort error codes', () => {
    expect(mediaRejectErrorCode('not_verified_attendee')).toBe('forbidden');
    expect(mediaRejectErrorCode('not_uploader')).toBe('forbidden');
    expect(mediaRejectErrorCode('window_closed')).toBe('outside_window');
    expect(mediaRejectErrorCode('window_not_open')).toBe('outside_window');
    expect(mediaRejectErrorCode('user_cap_reached')).toBe('rate_limited');
    expect(mediaRejectErrorCode('tags_pending')).toBe('conflict');
    expect(mediaRejectErrorCode('not_published')).toBe('conflict');
    expect(mediaRejectErrorCode('too_large')).toBe('validation');
  });
});

describe('retention (VAULT-007)', () => {
  it('12 calendar months; Pro until subscription end + 90 days', () => {
    expect(mediaExpiresAt('2026-01-31T10:00:00.000Z')).toBe('2027-01-31T10:00:00.000Z');
    expect(new Date(addMonthsUtc(Date.parse('2027-01-31T00:00:00.000Z'), 1)).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(mediaExpiresAt('2026-01-01T00:00:00.000Z', C, '2027-06-01T00:00:00.000Z')).toBe('2027-08-30T00:00:00.000Z');
    expect(mediaExpiresAt('2026-01-01T00:00:00.000Z', C, '2026-02-01T00:00:00.000Z')).toBe('2027-01-01T00:00:00.000Z');
  });
});

const item = (o: Partial<MediaItem> = {}): MediaItem => ({
  id: 'm1',
  gameId: G1,
  venueId: 'v1',
  uploaderId: U1,
  kind: 'photo',
  status: 'published',
  visibility: 'participants',
  publicOptIn: false,
  mimeType: 'image/jpeg',
  sizeBytes: MB,
  durationSeconds: null,
  storagePath: 'media/m1.jpg',
  createdAt: game.endsAt,
  publishedAt: game.endsAt,
  expiresAt: '2027-11-01T20:00:00.000Z',
  removedAt: null,
  ...o,
});
const tag = (userId: string, status: MediaTag['status'], vetoPublic = false): MediaTag => ({
  mediaId: 'm1', userId, taggedBy: U1, status, vetoPublic, createdAt: game.endsAt, decidedAt: null,
});

describe('consent tagging and visibility (VAULT-004/005)', () => {
  const T = END + HOUR_MS;
  it('AC-VAULT-004: 3 tags, 2 accepted → stays participants until the third accepts', () => {
    const tags = [tag(U2, 'accepted'), tag(U3, 'accepted'), tag(U4, 'requested')];
    const r = requestMediaVisibility(item(), tags, 'venue_public', U1, T);
    expect(r.ok && r.value.item).toMatchObject({ publicOptIn: true, visibility: 'participants' });
    expect(r.ok && r.value.pendingUserIds).toEqual([U4]);
    expect(r.ok && r.value.effects).toEqual([]);
    const acc = respondToMediaTag(r.ok ? r.value.item : item(), tags, U4, true, T);
    expect(acc.ok && acc.value.item.visibility).toBe('venue_public');
    expect(acc.ok && acc.value.effects.map((e) => e.type)).toEqual(['SetMediaTagStatus', 'SetMediaVisibility']);
  });
  it('AC-VAULT-005 / uploader untag path / declines veto', () => {
    const opted = item({ publicOptIn: true });
    const untagged = removeMediaTag(opted, [tag(U2, 'accepted'), tag(U3, 'requested')], U1, U3, T);
    expect(untagged.ok && untagged.value.item.visibility).toBe('venue_public');
    const declined = respondToMediaTag(opted, [tag(U3, 'requested')], U3, false, T);
    expect(declined.ok && declined.value.tags[0]).toMatchObject({ status: 'declined', vetoPublic: true });
    const stillBlocked = removeMediaTag(opted, declined.ok ? declined.value.tags : [], U1, U3, T);
    expect(stillBlocked.ok && stillBlocked.value.item.visibility).toBe('participants');
    expect(consentBlockers([tag(U2, 'removed', true), tag(U3, 'removed'), tag(U4, 'declined')])).toEqual([U2, U4]);
    expect(effectiveMediaVisibility({ publicOptIn: true, status: 'processing' }, [])).toBe('participants');
  });
  it('tagged user untags with remove-from-public: leaves venue_public for good', () => {
    const pub = item({ publicOptIn: true, visibility: 'venue_public' });
    const r = untagMe(pub, [tag(U2, 'accepted')], U2, true, T);
    expect(r.ok && r.value.item.visibility).toBe('participants');
    expect(r.ok && r.value.effects.map((e) => e.type)).toEqual(['SetMediaTagStatus', 'SetMediaVisibility']);
    const keep = untagMe(pub, [tag(U2, 'accepted')], U2, false, T);
    expect(keep.ok && keep.value.item.visibility).toBe('venue_public');
    expect(untagMe(pub, [tag(U2, 'removed')], U2, true, T)).toEqual({ ok: false, error: 'not_found' });
    expect(untagMe(pub, [], U2, true, T)).toEqual({ ok: false, error: 'not_found' });
  });
  it('visibility rejections and opt-out', () => {
    expect(requestMediaVisibility(item(), [], 'venue_public', U2, T)).toEqual({ ok: false, error: 'not_uploader' });
    expect(requestMediaVisibility(item({ status: 'blocked' }), [], 'venue_public', U1, T)).toEqual({ ok: false, error: 'not_published' });
    const out = requestMediaVisibility(item({ publicOptIn: true, visibility: 'venue_public' }), [], 'participants', U1, T);
    expect(out.ok && out.value).toMatchObject({ pendingUserIds: [], item: { visibility: 'participants', publicOptIn: false } });
  });
  it('tagging rules', () => {
    const ctx = { participantIds: [U1, U2, U3, U4], blocks: [{ blockerId: U4, blockedId: U1 }] };
    const r = tagMedia(item({ publicOptIn: true, visibility: 'venue_public' }), [tag(U3, 'removed', true)], [U3, U2], U1, ctx, T);
    expect(r.ok && r.value.tags.map((t) => [t.userId, t.status, t.vetoPublic])).toEqual([[U2, 'requested', false], [U3, 'requested', true]]);
    expect(r.ok && r.value.effects.map((e) => e.type)).toEqual(['SetMediaTagStatus', 'Notify15', 'SetMediaTagStatus', 'Notify15', 'SetMediaVisibility']);
    expect(tagMedia(item(), [], [U2], U2, ctx, T)).toEqual({ ok: false, error: 'forbidden' });
    expect(tagMedia(item({ status: 'removed' }), [], [U2], U1, ctx, T)).toEqual({ ok: false, error: 'conflict' });
    expect(tagMedia(item(), [], [], U1, ctx, T)).toEqual({ ok: false, error: 'validation' });
    expect(tagMedia(item(), [], [U2, U2], U1, ctx, T)).toEqual({ ok: false, error: 'validation' });
    expect(tagMedia(item(), [], [U1], U1, ctx, T)).toEqual({ ok: false, error: 'validation' });
    expect(tagMedia(item(), [], ['stranger'], U1, ctx, T)).toEqual({ ok: false, error: 'forbidden' });
    expect(tagMedia(item(), [], [U4], U1, ctx, T)).toEqual({ ok: false, error: 'blocked' });
    expect(tagMedia(item(), [tag(U2, 'declined')], [U2], U1, ctx, T)).toEqual({ ok: false, error: 'conflict' });
    expect(respondToMediaTag(item(), [tag(U2, 'accepted')], U2, true, T)).toEqual({ ok: false, error: 'not_found' });
    expect(removeMediaTag(item(), [tag(U2, 'accepted')], U2, U2, T)).toEqual({ ok: false, error: 'forbidden' });
    expect(removeMediaTag(item(), [], U1, U2, T)).toEqual({ ok: false, error: 'not_found' });
  });
  it('account deletion untags with a veto', () => {
    const effects = untagDeletedAccount(
      U2,
      [
        { item: item({ id: 'm1', publicOptIn: true, visibility: 'venue_public' }), tags: [tag(U2, 'accepted')] },
        { item: item({ id: 'm2' }), tags: [] },
        { item: item({ id: 'm3' }), tags: [{ ...tag(U2, 'removed', true), mediaId: 'm3' }] },
      ],
      T,
    );
    expect(effects.map((e) => e.type)).toEqual(['SetMediaTagStatus', 'SetMediaVisibility']);
  });
});

describe('pre-publication verdicts (VAULT-003)', () => {
  const v = (decision: MediaModerationVerdict['decision']): MediaModerationVerdict => ({
    decision, categories: [], exifStripped: true, csamHashMatch: decision === 'csam', source: decision === 'csam' ? 'hash' : 'vision', reasonKey: null,
  });
  const T = END + HOUR_MS;
  it('publish → published at the allowed visibility', () => {
    const r = applyMediaVerdict(item({ status: 'processing', publicOptIn: true, publishedAt: null }), [], v('publish'), T);
    expect(r.item).toMatchObject({ status: 'published', visibility: 'venue_public', publishedAt: new Date(T).toISOString() });
    expect(r.effects.map((e) => e.type)).toEqual(['SetMediaStatus', 'SetMediaVisibility']);
  });
  it('block → blocked + notice', () => {
    const r = applyMediaVerdict(item({ status: 'processing' }), [], v('block'), T);
    expect(r.item.status).toBe('blocked');
    expect(r.effects.map((e) => e.type)).toEqual(['SetMediaStatus', 'Notify15']);
    expect(r.effects[1]).toMatchObject({ kind: 'media_blocked', params: { reasonKey: 'media.blocked.policy' } });
  });
  it('AC-VAULT-003: CSAM → never published, evidence preserved, account restricted, P0 review, no notice', () => {
    const r = applyMediaVerdict(item({ status: 'processing' }), [], v('csam'), T);
    expect(r.item.status).toBe('blocked');
    expect(r.effects.map((e) => e.type)).toEqual(['SetMediaStatus', 'PreserveMediaEvidence', 'RestrictAccountPendingReview', 'EnqueueReview', 'Audit']);
    expect(r.effects[3]).toMatchObject({ item: { kind: 'media_csam', priority: 'high', subjectUserId: U1, dueBy: new Date(T + HOUR_MS).toISOString(), dedupeKey: 'media_csam:m1' } });
  });
  it('ignores non-processing items', () => {
    expect(applyMediaVerdict(item(), [], v('csam'), T).effects).toEqual([]);
  });
});

describe('deletion and expiry', () => {
  it('uploader or moderator deletes; blocked evidence is never deleted', () => {
    const r = deleteMedia(item(), U1, false, END);
    expect(r.ok && r.value.effects.map((e) => e.type)).toEqual(['SetMediaStatus', 'DeleteMediaObject']);
    expect(deleteMedia(item(), U2, false, END)).toEqual({ ok: false, error: 'forbidden' });
    expect(deleteMedia(item(), U2, true, END).ok).toBe(true);
    expect(deleteMedia(item({ status: 'removed' }), U1, false, END)).toEqual({ ok: false, error: 'not_found' });
    const b = deleteMedia(item({ status: 'blocked' }), U2, true, END);
    expect(b.ok && b.value.effects.map((e) => e.type)).toEqual(['SetMediaStatus']);
  });
  it('expiry sweep', () => {
    const now = Date.parse('2027-11-01T20:00:00.000Z');
    const effects = expireMedia(
      [item({ id: 'a' }), item({ id: 'b', expiresAt: '2027-12-01T00:00:00.000Z' }), item({ id: 'c', status: 'removed' }), item({ id: 'd', status: 'blocked' }), item({ id: 'e', expiresAt: '2027-10-01T00:00:00.000Z' }), item({ id: 'f', expiresAt: '2027-10-01T00:00:00.000Z' })],
      now,
    );
    expect(effects.filter((e) => e.type === 'SetMediaStatus').map((e) => e.type === 'SetMediaStatus' && e.mediaId)).toEqual(['e', 'f', 'a']);
  });
});
