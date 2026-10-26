import { describe, expect, it } from 'vitest';
import { FakeProvider } from '@st/payments';
import { body, fakeAuth, memoryLogger, mutableClock, post, uuid } from '../_test/helpers';
import { PaymentsDb } from '../_test/payments-db';
import { handle, type DeleteAccountDeps } from './handler';

const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const USER = uuid(10);

async function setup() {
  const clock = mutableClock(NOW);
  const db = new PaymentsDb(clock.now);
  const fake = new FakeProvider({ now: clock.now });
  const { customerId } = await fake.createCustomer({ userId: USER, idempotencyKey: 'c' });
  const si = await fake.createSetup({ customerId, methodTypes: ['card'], idempotencyKey: 's', metadata: { paymentId: 'p', userId: USER, gameId: 'g', step: 'setup' } });
  fake.completeSetup(si.ref);
  db.customers.set(`${USER}:fake`, customerId);
  const hold = async (key: string) => (await fake.createDepositHold({ customerId, amount: { amountMinor: 500, currency: 'EUR' }, mode: 'hold', paymentMethodId: 'pm_card_visa', methodTypes: ['card'], idempotencyKey: key, metadata: { paymentId: key, userId: USER, gameId: 'g', step: 'hold' } })).ref;
  const futureRef = await hold('h1');
  const pastRef = await hold('h2');
  const row = (n: number, gameId: string, ref: string) => ({
    id: uuid(9000 + n), userId: USER, gameId, amountMinor: 500, currency: 'EUR', provider: 'fake' as const, providerRef: ref, status: 'requires_capture' as const, depositState: 'held' as const,
    step: 'hold' as const, paymentMethodId: 'pm_card_visa', securedAt: null, settlementRequested: null, holdRequestedAt: null, idempotencyKey: `deposit:${gameId}:${USER}:setup`, createdAt: new Date(NOW).toISOString(),
  });
  db.payments.push(row(1, uuid(1), futureRef), row(2, uuid(2), pastRef));
  db.games.set(uuid(1), { id: uuid(1), title: 'future', hostId: uuid(3), startsAt: '2026-11-13T18:00:00.000Z', endsAt: '2026-11-13T20:00:00.000Z', status: 'scheduled', depositMinor: 500, currency: 'EUR', depositForfeitTo: 'pot' });
  db.games.set(uuid(2), { id: uuid(2), title: 'past', hostId: uuid(3), startsAt: '2026-11-11T18:00:00.000Z', endsAt: '2026-11-11T20:00:00.000Z', status: 'completed', depositMinor: 500, currency: 'EUR', depositForfeitTo: 'pot' });
  const deps: DeleteAccountDeps = { auth: fakeAuth({ tok: USER }), store: db, providers: { fake }, clock, log: memoryLogger(), cors: { allowedOrigins: [] } };
  return { db, fake, deps, futureRef, pastRef, customerId };
}

describe('delete-account', () => {
  it('releases future deposits only, runs delete_my_account as the user, detaches methods, deletes auth last', async () => {
    const { db, fake, deps, futureRef, pastRef, customerId } = await setup();
    const res = await handle(post('delete-account', {}, { token: 'tok' }), deps);
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ deleted: true, pendingCleanup: [] });
    expect(fake.intents.get(futureRef)?.status).toBe('canceled');
    expect(fake.intents.get(pastRef)?.status).toBe('requires_capture'); // past no-show deposits keep their rules
    expect(db.deletedAccounts).toEqual(['tok']);
    expect(fake.customers.get(customerId)?.paymentMethods.size).toBe(0);
    expect(db.deletedAuth).toEqual([USER]);
  });

  it('PSP failures do not block deletion and are audited', async () => {
    const { db, fake, deps } = await setup();
    fake.failNext('releaseDeposit');
    const r = await body<{ pendingCleanup: string[] }>(await handle(post('delete-account', {}, { token: 'tok' }), deps));
    expect(r.pendingCleanup).toEqual([`deposit:${uuid(9001)}`]);
    expect(db.effects).toEqual([expect.objectContaining({ type: 'Audit', action: 'account.psp_cleanup_pending' })]);
    expect(db.deletedAuth).toEqual([USER]);
  });

  it('requires the user token', async () => {
    const { deps } = await setup();
    expect((await handle(post('delete-account', {}), deps)).status).toBe(401);
  });
});
