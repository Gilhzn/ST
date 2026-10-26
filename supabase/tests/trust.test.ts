import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness";
import {
  addParticipant, asService, asUser, at, DAY, expectSt, HOUR, iso, makeGame, makeModerator, makeUser, MIN, profileOf,
  sanctionsOf, T0, uuid,
} from "./fixtures";

let db: Harness;
beforeAll(async () => {
  db = await createHarness();
});
afterEach(() => db.reset());
afterAll(() => db?.close());

/** Issues a yellow card through the real path used by Edge Functions (apply_effects). */
async function card(userId: string, issuedAt: Date, key = uuid()): Promise<string> {
  const effects = [{
    type: "IssueSanction",
    sanction: {
      userId, kind: "yellow_card", reasonCode: "chat_blocks", statementKey: "sanctions.reason.chat_blocks",
      statementParams: {}, startsAt: iso(issuedAt), expiresAt: iso(new Date(issuedAt.getTime() + 30 * DAY)),
      disputeUntil: iso(new Date(issuedAt.getTime() + 48 * HOUR)), decidedBy: "system", gameId: null, causedBy: [],
      dedupeKey: `test:${key}`,
    },
  }];
  await asService(db, `select public.apply_effects($1::jsonb)`, [JSON.stringify(effects)], { now: issuedAt });
  const [r] = await db.query<{ id: string }>(`select id from sanctions where dedupe_key = $1`, [`test:${key}`]);
  return r!.id;
}
const tick = (d: Date) => asService(db, `select public.expire_sanctions()`, [], { now: d });

describe("process_no_shows", () => {
  it("marks approved non-host players without check-in as no-shows with a disputable card, once", async () => {
    const host = await makeUser(db);
    const [ok, ns, req] = [await makeUser(db), await makeUser(db), await makeUser(db)];
    const g = await makeGame(db, host);
    await addParticipant(db, g, ok, "approved", { attendance: "verified" });
    await addParticipant(db, g, ns);
    await addParticipant(db, g, req, "requested");
    // Not yet: closure runs at ends_at + 2h.
    expect((await asService<{ n: number }>(db, `select public.process_no_shows() n`, [], { now: at(3 * HOUR) }))[0]!.n).toBe(0);
    const close = at(90 * MIN + 2 * HOUR);
    expect((await asService<{ n: number }>(db, `select public.process_no_shows() n`, [], { now: close }))[0]!.n).toBe(1);
    expect((await asService<{ n: number }>(db, `select public.process_no_shows() n`, [], { now: close }))[0]!.n).toBe(0);
    const s = await sanctionsOf(db, ns);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "yellow_card", reason_code: "no_show", dedupe_key: `no_show:${g}:${ns}` });
    expect(s[0]!.dispute_until).toEqual(new Date(close.getTime() + 48 * HOUR));
    expect(await sanctionsOf(db, host)).toHaveLength(0);
    expect(await sanctionsOf(db, req)).toHaveLength(0);
    const [{ status }] = await db.query<{ status: string }>(`select status from games where id = $1`, [g]);
    expect(status).toBe("completed");
    const [{ attendance }] = await db.query<{ attendance: string }>(`select attendance from game_participants where game_id = $1 and user_id = $2`, [g, ns]);
    expect(attendance).toBe("no_show_unverified");
    expect((await profileOf(db, ns)).reliability_no_show_count).toBe(1);
  });

  it("job functions are not callable by clients", async () => {
    const u = await makeUser(db);
    for (const fn of ["process_no_shows", "expire_sanctions", "purge_expired_messages", "purge_retained", "purge_retention",
      "settle_deposits", "place_deposit_holds", "recheck_pending_messages", "expire_waitlist_offers"]) {
      await expect(asUser(db, u, `select public.${fn}()`)).rejects.toThrow(/permission denied/);
    }
    await expect(asUser(db, u, `select public.apply_effects('[]'::jsonb)`)).rejects.toThrow(/permission denied/);
    await expect(asUser(db, u, `select public.st_issue_sanction($1, 'yellow_card', 'no_show', '{}', '1 day', null, null, '{}', 'x')`, [u]))
      .rejects.toThrow(/permission denied/);
  });
});

describe("escalation ladder (TRUST-022/025)", () => {
  it("counts cards only once their dispute window closed: 2 → 7d ban, 3 → 30d ban, 4 → 30d ban + review, never permanent", async () => {
    const u = await makeUser(db);
    const c1 = await card(u, at(0));
    await card(u, at(1 * DAY));
    await tick(at(1 * DAY + HOUR));
    expect((await sanctionsOf(db, u)).filter((s) => s.kind === "join_ban")).toHaveLength(0);
    // Card 2 matures at day 3 → short ban.
    await tick(at(3 * DAY));
    let bans = (await sanctionsOf(db, u)).filter((s) => s.kind === "join_ban");
    expect(bans.map((b) => b.reason_code)).toEqual(["escalation_two_cards"]);
    expect(bans[0]!.expires_at).toEqual(at(10 * DAY));
    expect(bans[0]!.caused_by).toContain(c1);
    expect((await profileOf(db, u)).join_banned_until).toEqual(at(10 * DAY));
    expect((await profileOf(db, u)).reliability_status).toBe("red");
    // Idempotent re-run.
    await tick(at(3 * DAY));
    expect((await sanctionsOf(db, u)).filter((s) => s.kind === "join_ban")).toHaveLength(2 - 1);

    await card(u, at(4 * DAY));
    await tick(at(6 * DAY));
    bans = (await sanctionsOf(db, u)).filter((s) => s.kind === "join_ban");
    expect(bans.map((b) => b.reason_code)).toEqual(["escalation_two_cards", "escalation_three_cards"]);
    expect((await profileOf(db, u)).join_banned_until).toEqual(at(36 * DAY));

    await card(u, at(7 * DAY));
    await tick(at(9 * DAY));
    const all = await sanctionsOf(db, u);
    expect(all.filter((s) => s.kind === "join_ban").map((b) => b.reason_code))
      .toEqual(["escalation_two_cards", "escalation_three_cards", "escalation_three_cards"]);
    expect(all.some((s) => s.kind === "permanent_ban")).toBe(false);
    const q = await db.query<{ kind: string; priority: string }>(`select kind, priority from review_queue where subject_user_id = $1`, [u]);
    expect(q).toEqual([{ kind: "permanent_ban_candidate", priority: "high" }]);
  });

  it("a disputed card does not count until upheld; join ban withdraws open requests", async () => {
    const u = await makeUser(db);
    const mod = await makeModerator(db);
    const host = await makeUser(db);
    const future = await makeGame(db, host, { startsAt: at(20 * DAY), endsAt: at(20 * DAY + HOUR) });
    await addParticipant(db, future, u, "requested");
    await card(u, at(0));
    const c2 = await card(u, at(DAY));
    const [{ a }] = await asUser<{ a: { id: string; is_dispute: boolean } }>(db, u,
      `select to_jsonb(public.file_appeal($1, 'I was there, GPS failed')) a`, [c2], { now: at(DAY + HOUR) });
    expect(a.is_dispute).toBe(true);
    await tick(at(4 * DAY));
    expect((await sanctionsOf(db, u)).filter((s) => s.kind === "join_ban")).toHaveLength(0);
    const [item] = await db.query<{ id: string; kind: string }>(`select id, kind from review_queue where appeal_id = $1`, [a.id]);
    expect(item!.kind).toBe("sanction_dispute");
    await asUser(db, mod, `select public.moderator_decide($1, 'uphold')`, [item!.id], { now: at(4 * DAY) });
    expect((await sanctionsOf(db, u)).filter((s) => s.kind === "join_ban").map((s) => s.reason_code)).toEqual(["escalation_two_cards"]);
    const [{ status }] = await db.query<{ status: string }>(`select status from game_participants where game_id = $1 and user_id = $2`, [future, u]);
    expect(status).toBe("cancelled");
    const [ap] = await db.query<{ status: string; decided_by: string }>(`select status, decided_by from appeals where id = $1`, [a.id]);
    expect(ap).toEqual({ status: "upheld", decided_by: mod });
  });

  it("overturning a card cascades to the ban it caused and lifts the projection", async () => {
    const u = await makeUser(db);
    const mod = await makeModerator(db);
    const c1 = await card(u, at(0));
    await card(u, at(DAY));
    await tick(at(3 * DAY));
    const [{ a }] = await asUser<{ a: { id: string; is_dispute: boolean } }>(db, u,
      `select to_jsonb(public.file_appeal($1, 'unfair')) a`, [c1], { now: at(3 * DAY) });
    expect(a.is_dispute).toBe(false); // window closed: an appeal (DSA Art. 20)
    const [item] = await db.query<{ id: string; kind: string }>(`select id, kind from review_queue where appeal_id = $1`, [a.id]);
    expect(item!.kind).toBe("appeal");
    await asUser(db, mod, `select public.moderator_decide($1, 'overturn', 'GPS outage')`, [item!.id], { now: at(3 * DAY + HOUR) });
    const s = await sanctionsOf(db, u);
    expect(s.find((x) => x.id === c1)!.status).toBe("overturned");
    expect(s.find((x) => x.kind === "join_ban")!.status).toBe("overturned");
    expect((await profileOf(db, u)).join_banned_until).toBeNull();
    const [n] = await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and kind = 'appeal_decided'`, [u]);
    expect(n!.n).toBe(1);
    const [audit] = await db.query<{ actor_id: string }>(`select actor_id from audit_log where action = 'moderator.decide'`);
    expect(audit!.actor_id).toBe(mod);
  });
});

describe("appeals", () => {
  it("one open appeal per sanction; own sanctions only; 6-month limit; overturned → conflict", async () => {
    const u = await makeUser(db);
    const other = await makeUser(db);
    const c = await card(u, at(0));
    await expectSt(asUser(db, other, `select public.file_appeal($1, 'x')`, [c], { now: at(HOUR) }), "not_found");
    await asUser(db, u, `select public.file_appeal($1, 'x')`, [c], { now: at(HOUR) });
    await expectSt(asUser(db, u, `select public.file_appeal($1, 'again')`, [c], { now: at(2 * HOUR) }), "conflict");
    const c2 = await card(u, at(0));
    await expectSt(asUser(db, u, `select public.file_appeal($1, 'late')`, [c2], { now: at(181 * DAY) }), "dispute_window_closed");
    await expectSt(asUser(db, u, `select public.file_appeal($1, '')`, [c2], { now: at(HOUR) }), "validation");
  });

  it("TRUST-023: an undecided dispute is auto-overturned after 7 days, unless the user exceeded 3 in 90 days", async () => {
    const u = await makeUser(db);
    const cards = [await card(u, at(0)), await card(u, at(0)), await card(u, at(0)), await card(u, at(0))];
    for (const [i, c] of cards.entries()) {
      await asUser(db, u, `select public.file_appeal($1, 'dispute')`, [c], { now: at(HOUR + i * MIN) });
    }
    await tick(at(7 * DAY));
    let s = await sanctionsOf(db, u);
    expect(s.filter((x) => x.status === "overturned")).toHaveLength(0);
    await tick(at(7 * DAY + 2 * HOUR));
    s = await sanctionsOf(db, u);
    const over = s.filter((x) => x.status === "overturned");
    expect(over).toHaveLength(3);
    expect(over.every((x) => x.void_reason === "dispute_timeout")).toBe(true);
    expect(s.find((x) => x.id === cards[3])!.status).toBe("disputed");
    const resolved = await db.query<{ resolution: string }>(`select resolution from review_queue where status = 'resolved'`);
    expect(resolved).toHaveLength(3);
  });
});

describe("toxicity reports (TRUST-041/042/043/048)", () => {
  /** A finished game where `subject` and the reporters were verified attendees. */
  async function scene(opts: { reporterCreated?: Date[]; teams?: (number | null)[]; subjectTeam?: number | null; games?: number } = {}) {
    const host = await makeUser(db);
    const subject = await makeUser(db);
    const created = opts.reporterCreated ?? [at(-100 * DAY), at(-50 * DAY), at(-20 * DAY)];
    const reporters: string[] = [];
    const games: string[] = [];
    for (let i = 0; i < (opts.games ?? 1); i++) {
      const g = await makeGame(db, host, { startsAt: at(-2 * DAY - i * DAY), endsAt: at(-2 * DAY - i * DAY + HOUR) });
      await addParticipant(db, g, subject, "approved", { attendance: "verified", team: opts.subjectTeam ?? 1 });
      games.push(g);
    }
    for (const [i, c] of created.entries()) {
      const r = await makeUser(db, { createdAt: c });
      const g = games[i % games.length]!;
      await addParticipant(db, g, r, "approved", { attendance: "verified", team: opts.teams?.[i] ?? null });
      reporters.push(r);
    }
    return { subject, reporters, games, host };
  }
  const report = (r: string, subject: string, game: string, now = at(0)) =>
    asUser(db, r, `select * from public.report_user($1, 'harassment', $2)`, [subject, game], { now });

  it("3 independent qualifying reporters → 72h visibility restriction + review + notification", async () => {
    const { subject, reporters, games } = await scene({ games: 2 });
    await report(reporters[0]!, subject, games[0]!);
    await report(reporters[1]!, subject, games[1]!);
    expect(await sanctionsOf(db, subject)).toHaveLength(0);
    await report(reporters[2]!, subject, games[0]!);
    const s = await sanctionsOf(db, subject);
    expect(s.map((x) => [x.kind, x.reason_code])).toEqual([["visibility_restriction", "toxicity_reports"]]);
    expect(s[0]!.expires_at).toEqual(at(72 * HOUR));
    expect((await profileOf(db, subject)).visibility_restricted_until).toEqual(at(72 * HOUR));
    const [q] = await db.query<{ kind: string; priority: string; report_ids: string[] }>(`select * from review_queue`);
    expect(q).toMatchObject({ kind: "toxicity_reports", priority: "high" });
    expect(q!.report_ids).toHaveLength(3);
    const [n] = await db.query<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and kind = 'visibility_restricted'`, [subject]);
    expect(n!.n).toBe(1);
    // Restricted user's profile disappears for others, and they cannot request public games.
    expect(await asUser(db, reporters[0]!, `select id from public_profiles where id = $1`, [subject], { now: at(HOUR) })).toHaveLength(0);
    // The reported user can never see who reported them.
    expect(await asUser(db, subject, `select * from user_reports`)).toHaveLength(0);
  });

  it("duplicate reports by one reporter count once; young accounts and non-attendees do not qualify", async () => {
    const { subject, reporters, games } = await scene({ reporterCreated: [at(-100 * DAY), at(-50 * DAY), at(-3 * DAY)] });
    await report(reporters[0]!, subject, games[0]!);
    await expectSt(report(reporters[0]!, subject, games[0]!, at(MIN)), "already_reported");
    await report(reporters[0]!, subject, games[0]!, at(25 * HOUR)).catch(() => undefined);
    await report(reporters[1]!, subject, games[0]!);
    await report(reporters[2]!, subject, games[0]!); // 3-day-old account
    const outsider = await makeUser(db, { createdAt: at(-90 * DAY) });
    await report(outsider, subject, games[0]!); // not in the game
    expect(await sanctionsOf(db, subject)).toHaveLength(0);
    // An outsider in the game but not checked in does not count either.
    const notIn = await makeUser(db, { createdAt: at(-80 * DAY) });
    await addParticipant(db, games[0]!, notIn);
    await report(notIn, subject, games[0]!);
    expect(await sanctionsOf(db, subject)).toHaveLength(0);
  });

  it("collusion: two reporter accounts created within 48h → review only, no restriction, no notification", async () => {
    const { subject, reporters, games } = await scene({ reporterCreated: [at(-100 * DAY), at(-30 * DAY), at(-30 * DAY + 20 * HOUR)], games: 2 });
    for (const [i, r] of reporters.entries()) await report(r, subject, games[i % 2]!);
    expect(await sanctionsOf(db, subject)).toHaveLength(0);
    const q = await db.query<{ kind: string; evidence: Record<string, unknown> }>(`select kind, evidence from review_queue`);
    expect(q.map((x) => x.kind)).toEqual(["collusion_suspected"]);
    expect(q[0]!.evidence.collusionSuspected).toBe(true);
    expect(await db.query(`select 1 from notifications where user_id = $1`, [subject])).toHaveLength(0);
  });

  it("collusion: all reporters from the opposing team of a single game → review only", async () => {
    const { subject, reporters, games } = await scene({ teams: [0, 0, 0], subjectTeam: 1 });
    for (const r of reporters) await report(r, subject, games[0]!);
    expect(await sanctionsOf(db, subject)).toHaveLength(0);
    expect((await db.query<{ kind: string }>(`select kind from review_queue`)).map((x) => x.kind)).toEqual(["collusion_suspected"]);
  });

  it("14-day protection after an overturned restriction: new reports go to review only", async () => {
    const { subject, reporters, games, host } = await scene({ games: 2 });
    const mod = await makeModerator(db);
    for (const [i, r] of reporters.entries()) await report(r, subject, games[i % 2]!);
    const [item] = await db.query<{ id: string }>(`select id from review_queue where kind = 'toxicity_reports'`);
    await asUser(db, mod, `select public.moderator_decide($1, 'lift_restriction')`, [item!.id], { now: at(HOUR) });
    expect((await profileOf(db, subject)).visibility_restricted_until).toBeNull();
    const outcomes = await db.query<{ outcome: string }>(`select distinct outcome from user_reports`);
    expect(outcomes).toEqual([{ outcome: "unfounded" }]);
    // Three new qualifying reporters within 14 days.
    const g3 = await makeGame(db, host, { startsAt: at(DAY), endsAt: at(DAY + HOUR) });
    await addParticipant(db, g3, subject, "approved", { attendance: "verified" });
    for (let i = 0; i < 3; i++) {
      const r = await makeUser(db, { createdAt: at(-(200 + i * 10) * DAY) });
      await addParticipant(db, g3, r, "approved", { attendance: "verified" });
      await report(r, subject, g3, at(2 * DAY));
    }
    const s = await sanctionsOf(db, subject);
    expect(s.filter((x) => x.status !== "overturned")).toHaveLength(0);
    const open = await db.query<{ evidence: { protected: boolean } }>(`select evidence from review_queue where status = 'open'`);
    expect(open.map((o) => o.evidence.protected)).toEqual([true]);
  });

  it("reporters with poor accuracy (< 30% after 5 decided reports) do not qualify", async () => {
    const { subject, reporters, games } = await scene({ games: 2 });
    const someone = await makeUser(db);
    for (let i = 0; i < 5; i++) {
      await db.query(`insert into user_reports (reporter_id, target_user_id, category, outcome, created_at) values ($1, $2, 'spam', 'unfounded', $3)`,
        [reporters[0], someone, iso(at(-40 * DAY))]);
    }
    for (const [i, r] of reporters.entries()) await report(r, subject, games[i % 2]!);
    expect(await sanctionsOf(db, subject)).toHaveLength(0);
  });

  it("validates input and rate limits", async () => {
    const { subject, reporters, games } = await scene();
    await expectSt(asUser(db, reporters[0]!, `select public.report_user($1, 'spam')`, [reporters[0]]), "validation");
    await expectSt(asUser(db, reporters[0]!, `select public.report_user($1, 'spam')`, [uuid()]), "not_found");
    const others = [];
    for (let i = 0; i < 10; i++) others.push(await makeUser(db));
    for (const o of others) await asUser(db, reporters[1]!, `select public.report_user($1, 'spam')`, [o], { now: at(0) });
    await expectSt(asUser(db, reporters[1]!, `select public.report_user($1, 'spam', $2)`, [subject, games[0]], { now: at(MIN) }), "rate_limited");
  });
});

describe("permanent ban: humans only", () => {
  it("CHECK rejects a system-decided or expiring permanent ban, even for the service role", async () => {
    const u = await makeUser(db);
    const ins = (decidedBy: string, expires: string | null) =>
      asService(db, `insert into sanctions (user_id, kind, reason_code, statement_key, starts_at, expires_at, decided_by, dedupe_key)
                     values ($1, 'permanent_ban', 'moderator_decision', 'sanctions.reason.moderator_decision', now(), $2, $3::public.sanction_decider, $4)`,
        [u, expires, decidedBy, uuid()]);
    await expect(ins("system", null)).rejects.toThrow(/sanctions_permanent_ban_by_moderator/);
    await expect(ins("moderator", iso(at(DAY)))).rejects.toThrow(/sanctions_permanent_ban_by_moderator/);
    await expect(asService(db, `insert into sanctions (user_id, kind, reason_code, statement_key, starts_at, expires_at, dedupe_key)
      values ($1, 'join_ban', 'no_show', 'sanctions.reason.no_show', now(), null, 'k')`, [u])).rejects.toThrow(/sanctions_temporary_have_expiry/);
    await expect(asService(db, `insert into sanctions (user_id, kind, reason_code, statement_key, starts_at, expires_at, dedupe_key)
      values ($1, 'join_ban', 'no_show', 'sanctions.reason.late_cancel', now(), now() + interval '1 day', 'k')`, [u])).rejects.toThrow(/sanctions_statement_key/);
  });

  it("apply_effects refuses permanent_ban; moderator_decide issues it and the user is account_banned", async () => {
    const u = await makeUser(db);
    const mod = await makeModerator(db);
    const fx = [{ type: "IssueSanction", sanction: { userId: u, kind: "permanent_ban", reasonCode: "moderator_decision", expiresAt: null, decidedBy: "moderator", dedupeKey: "pb" } }];
    await expectSt(asService(db, `select public.apply_effects($1::jsonb)`, [JSON.stringify(fx)]), "forbidden");
    const [rq] = await db.query<{ id: string }>(
      `insert into review_queue (kind, subject_user_id, due_by, dedupe_key) values ('permanent_ban_candidate', $1, now(), 'r1') returning id`, [u]);
    await asUser(db, mod, `select public.moderator_decide($1, 'permanent_ban', 'repeated violence')`, [rq!.id], { now: at(0) });
    const s = await sanctionsOf(db, u);
    expect(s.map((x) => x.kind)).toEqual(["permanent_ban"]);
    expect((await profileOf(db, u)).permanently_banned).toBe(true);
    const host = await makeUser(db);
    const g = await makeGame(db, host);
    await expectSt(asUser(db, u, `select public.request_join($1)`, [g], { now: at(-DAY) }), "account_banned");
  });
});

describe("apply_effects", () => {
  it("applies effects in order and is idempotent on replay", async () => {
    const u = await makeUser(db);
    const host = await makeUser(db);
    const g = await makeGame(db, host);
    await addParticipant(db, g, u);
    const until = iso(at(DAY));
    const fx = [
      { type: "IssueSanction", sanction: { userId: u, kind: "chat_mute", reasonCode: "chat_blocks", statementKey: "sanctions.reason.chat_blocks",
        statementParams: { hours: 24 }, startsAt: iso(at(0)), expiresAt: until, disputeUntil: null, decidedBy: "system", gameId: g, causedBy: [], dedupeKey: `chat_mute:${u}:1` } },
      { type: "MuteChat", userId: u, until },
      { type: "Notify", userId: u, kind: "chat_muted", params: { hours: 24 }, gameId: g, sanctionDedupeKey: `chat_mute:${u}:1` },
      { type: "EnqueueReview", item: { kind: "chat_recheck", priority: "low", subjectUserId: u, venueId: null, gameId: g, sanctionId: null, appealId: null,
        reportIds: [], evidence: { blocks: 3 }, dueBy: iso(at(DAY)), dedupeKey: `chat_recheck:${u}:1` } },
      { type: "SetAttendance", gameId: g, userId: u, attendance: "excused" },
      { type: "Audit", action: "chat.blocked", subjectUserId: u, data: { n: 3 } },
    ];
    const run = () => asService<{ r: { applied: number } }>(db, `select public.apply_effects($1::jsonb) r`, [JSON.stringify(fx)], { now: at(0) });
    expect((await run())[0]!.r.applied).toBe(6);
    await run();
    expect(await sanctionsOf(db, u)).toHaveLength(1);
    expect((await profileOf(db, u)).chat_muted_until).toEqual(at(DAY));
    const notes = await db.query<{ sanction_id: string | null }>(`select sanction_id from notifications where user_id = $1`, [u]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.sanction_id).not.toBeNull();
    expect(await db.query(`select 1 from review_queue`)).toHaveLength(1);
    await expectSt(asService(db, `select public.apply_effects('[{"type":"Nope"}]'::jsonb)`), "validation");
    await expectSt(asService(db, `select public.apply_effects('{}'::jsonb)`), "validation");
  });

  it("expire_sanctions expires and clears projections", async () => {
    const u = await makeUser(db);
    const fx = [{ type: "IssueSanction", sanction: { userId: u, kind: "chat_mute", reasonCode: "chat_blocks", statementParams: {},
      startsAt: iso(at(0)), expiresAt: iso(at(DAY)), disputeUntil: null, decidedBy: "system", gameId: null, causedBy: [], dedupeKey: "m1" } }];
    await asService(db, `select public.apply_effects($1::jsonb)`, [JSON.stringify(fx)], { now: at(0) });
    expect((await profileOf(db, u)).chat_muted_until).toEqual(at(DAY));
    expect((await asService<{ n: number }>(db, `select public.expire_sanctions() n`, [], { now: at(DAY + MIN) }))[0]!.n).toBe(1);
    expect((await sanctionsOf(db, u))[0]!.status).toBe("expired");
    expect((await profileOf(db, u)).chat_muted_until).toBeNull();
  });
});

describe("reliability", () => {
  it("(verified + 3) / (commitments + 3) over 90 days, late cancel weighs 0.5, < 3 commitments is new", async () => {
    const u = await makeUser(db);
    const host = await makeUser(db);
    for (let i = 0; i < 4; i++) {
      const g = await makeGame(db, host, { startsAt: at(-(i + 2) * DAY), endsAt: at(-(i + 2) * DAY + HOUR) });
      await addParticipant(db, g, u, "approved", { attendance: i < 3 ? "verified" : "no_show_unverified" });
    }
    const old = await makeGame(db, host, { startsAt: at(-100 * DAY), endsAt: at(-100 * DAY + HOUR) });
    await addParticipant(db, old, u, "approved", { attendance: "no_show_unverified" });
    const g5 = await makeGame(db, host, { startsAt: at(-DAY), endsAt: at(-DAY + HOUR) });
    await addParticipant(db, g5, u, "cancelled");
    await db.query(`update game_participants set late_cancel = true, cancelled_at = $3 where game_id = $1 and user_id = $2`, [g5, u, iso(at(-DAY - HOUR))]);
    const [{ r }] = await asService<{ r: Record<string, unknown> }>(db, `select public.st_recompute_reliability($1) r`, [u], { now: at(0) });
    // verified 3, no-show 1, late 1 → (3+3)/(3+1+0.5+3) = 0.8
    expect(r).toMatchObject({ verifiedCount: 3, noShowCount: 1, lateCancelCount: 1, commitmentCount: 5, status: "yellow" });
    expect(r.score).toBeCloseTo(0.8, 5);
    const [{ snap }] = await db.query<{ snap: Record<string, unknown> }>(
      `select public.st_reliability_snapshot(2, 0, 0, false, false, public.st_config(), now()) snap`);
    expect(snap).toMatchObject({ status: "new", score: null });
    expect(T0).toBeTruthy();
  });
});
