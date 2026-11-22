// Run with node --test tests/program-offers.test.cjs. Pure logic, no I/O.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const mobileRoot = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', {
  paths: [process.env.BODYTRACK_DEPENDENCIES || mobileRoot],
}));

function load(file, modules = {}) {
  const code = ts.transpileModule(readFileSync(path.join(mobileRoot, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module_ = { exports: {} };
  vm.runInNewContext(code, {
    module: module_, exports: module_.exports, Error, Set, Map, Math, Number, Date, Promise, String,
    require: (name) => { if (!(name in modules)) throw new Error(`unexpected import ${name}`); return modules[name]; },
  });
  return module_.exports;
}

const { createProgramOffersStore } = load('src/coaching/programOffers.ts');
const display = load('src/coaching/offerDisplay.ts');

// Values built inside the vm context are not reference-equal to this realm's, so compare as JSON.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const apiError = (status, message) => Object.assign(new Error(message), { status });
const networkError = () => apiError(0, 'Cannot connect right now. Check your connection and try again.');

const coach = { username: 'coach', first_name: 'Cora', last_name: null };
const program = (name = 'Upper Lower') => ({
  name, notes: null,
  templates: [{ name: 'Upper', day_order: 0, notes: null, exercises: [] }],
});
const summary = (id, extra = {}) => ({
  id, status: 'pending', program_name: `P${id}`, template_count: 1, exercise_count: 2,
  sent_at: '2026-10-01T10:00:00Z', responded_at: null, coach, program_id: null, ...extra,
});
const detail = (id, extra = {}) => ({ ...summary(id, extra), program: program(`P${id}`) });
const sentSummary = (id, extra = {}) => ({
  id, status: 'pending', program_name: `S${id}`, template_count: 1, exercise_count: 2,
  sent_at: '2026-10-01T10:00:00Z', responded_at: null, ...extra,
});
const page = (items, total = items.length) => ({ items, total, limit: 2, offset: 0 });

function fakeApi(overrides = {}) {
  const calls = [];
  const record = (name, impl) => (...args) => { calls.push([name, ...args]); return impl(...args); };
  const api = {
    listReceived: record('listReceived', async () => page([])),
    getReceived: record('getReceived', async (id) => detail(id)),
    accept: record('accept', async (id) => detail(id, { status: 'accepted', program_id: `copy-${id}` })),
    decline: record('decline', async (id) => detail(id, { status: 'declined' })),
    listSent: record('listSent', async () => page([])),
    send: record('send', async (_link, _request, programId, _fingerprint) => ({
      ...sentSummary(`o-${programId}`), program: program(),
    })),
  };
  for (const [name, impl] of Object.entries(overrides)) api[name] = record(name, impl);
  return { api, calls, count: (name) => calls.filter((call) => call[0] === name).length };
}

let counter = 0;
const ids = () => `req-${++counter}`;
const make = (overrides, pageSize = 2) => {
  const fake = fakeApi(overrides);
  const store = createProgramOffersStore(fake.api, ids, pageSize);
  store.bind('athlete1');
  return { store, ...fake };
};
const received = (store) => store.getSnapshot().received;

test('first load, an empty inbox and a failed refresh that keeps what is shown', async () => {
  let fail = false;
  const { store } = make({
    listReceived: async () => {
      if (fail) throw networkError();
      return page([summary('a')]);
    },
  });
  const first = store.refreshReceived();
  assert.equal(received(store).loading, true);
  await first;
  assert.equal(received(store).loaded, true);
  same(received(store).items.map((item) => item.id), ['a']);

  fail = true;
  await store.refreshReceived();
  assert.match(received(store).error, /connect/);
  same(received(store).items.map((item) => item.id), ['a']);

  const empty = make();
  await empty.store.refreshReceived();
  assert.equal(received(empty.store).loaded, true);
  assert.equal(received(empty.store).items.length, 0);
});

test('concurrent refreshes share one request', async () => {
  const gate = deferred();
  const { store, count } = make({ listReceived: () => gate.promise });
  const one = store.refreshReceived();
  const two = store.refreshReceived();
  gate.resolve(page([summary('a')]));
  await Promise.all([one, two]);
  assert.equal(count('listReceived'), 1);
});

test('paging appends by rows received, skips repeats and stops on an empty page', async () => {
  const pages = [
    page([summary('a'), summary('b')], 5),
    page([summary('b'), summary('c')], 5),
    page([], 5),
  ];
  const { store, calls } = make({ listReceived: async () => pages.shift() });
  await store.refreshReceived();
  await store.loadMoreReceived();
  same(received(store).items.map((item) => item.id), ['a', 'b', 'c']);
  assert.equal(calls[1][2], 2); // offset = rows received so far
  await store.loadMoreReceived();
  assert.equal(received(store).total, 3); // an empty page ends paging
  await store.loadMoreReceived();
  assert.equal(calls.length, 3);
});

test('a failed next page can be retried, and a late one after a refresh is dropped', async () => {
  let n = 0;
  const slowPage = deferred();
  const freshPage = deferred();
  const { store } = make({
    listReceived: async () => {
      n += 1;
      if (n === 1) return page([summary('a'), summary('b')], 4);
      if (n === 2) throw networkError();
      if (n === 3) return slowPage.promise;
      return freshPage.promise;
    },
  });
  await store.refreshReceived();
  await store.loadMoreReceived();
  assert.match(received(store).moreError, /connect/);
  const slow = store.loadMoreReceived(); // third call: held open
  assert.equal(received(store).loadingMore, true);
  const restart = store.refreshReceived(); // starts a newer first page
  slowPage.resolve(page([summary('c'), summary('d')], 4));
  await slow;
  // The older next page must not land on top of the list being refreshed.
  same(received(store).items.map((item) => item.id), ['a', 'b']);
  freshPage.resolve(page([summary('z')], 1));
  await restart;
  same(received(store).items.map((item) => item.id), ['z']);
});

test('opening an offer loads it; a 404 clears it and removes it from the list', async () => {
  let gone = false;
  const { store } = make({
    listReceived: async () => page([summary('a'), summary('b')]),
    getReceived: async (id) => {
      if (gone) throw apiError(404, 'Offer not found.');
      return detail(id);
    },
  });
  await store.refreshReceived();
  await store.loadDetail('a');
  assert.equal(store.getSnapshot().detail.data.id, 'a');
  store.closeDetail();
  assert.equal(store.getSnapshot().detail.data, null);

  gone = true;
  await store.loadDetail('a');
  const state = store.getSnapshot();
  assert.equal(state.detail.unavailable, true);
  assert.equal(state.detail.data, null);
  same(state.received.items.map((item) => item.id), ['b']);
  assert.equal(state.received.total, 1);
});

test('a failed reload of the same offer keeps it; another offer starts clean', async () => {
  let fail = false;
  const { store } = make({
    getReceived: async (id) => {
      if (fail) throw networkError();
      return detail(id);
    },
  });
  await store.loadDetail('a');
  fail = true;
  await store.loadDetail('a');
  assert.equal(store.getSnapshot().detail.data.id, 'a');
  assert.match(store.getSnapshot().detail.error, /connect/);
  await store.loadDetail('b');
  assert.equal(store.getSnapshot().detail.data, null);
});

test('a late answer for an offer that was left changes nothing', async () => {
  const slow = deferred();
  const { store } = make({
    getReceived: (id) => (id === 'a' ? slow.promise : Promise.resolve(detail(id))),
  });
  const first = store.loadDetail('a');
  await store.loadDetail('b');
  slow.resolve(detail('a'));
  await first;
  assert.equal(store.getSnapshot().detail.offerId, 'b');
  assert.equal(store.getSnapshot().detail.data.id, 'b');
});

test('accepting twice at once makes one request', async () => {
  const gate = deferred();
  const { store, count } = make({
    listReceived: async () => page([summary('a')]),
    accept: () => gate.promise,
  });
  await store.refreshReceived();
  const first = store.accept('a');
  assert.equal(store.getSnapshot().responding, 'a');
  const second = await store.accept('a');
  assert.equal(second.kind, 'ignored');
  gate.resolve(detail('a', { status: 'accepted', program_id: 'copy' }));
  const done = await first;
  assert.equal(done.kind, 'done');
  assert.equal(count('accept'), 1);
  assert.equal(store.getSnapshot().responding, null);
});

test('nothing changes before the server answers, then the offer shows its own copy', async () => {
  const gate = deferred();
  const { store } = make({
    listReceived: async () => page([summary('a')]),
    accept: () => gate.promise,
  });
  await store.refreshReceived();
  await store.loadDetail('a');
  const running = store.accept('a');
  assert.equal(received(store).items[0].status, 'pending');
  gate.resolve(detail('a', { status: 'accepted', program_id: 'copy-1' }));
  await running;
  assert.equal(received(store).items[0].status, 'accepted');
  assert.equal(received(store).items[0].program_id, 'copy-1');
  assert.equal(store.getSnapshot().detail.data.program_id, 'copy-1');
  assert.equal('program' in received(store).items[0], false);
});

test('a different offer cannot be answered while one is running', async () => {
  const gate = deferred();
  const { store, count } = make({ accept: () => gate.promise, decline: async (id) => detail(id) });
  const first = store.accept('a');
  assert.equal((await store.decline('b')).kind, 'ignored');
  gate.resolve(detail('a', { status: 'accepted' }));
  await first;
  assert.equal(count('decline'), 0);
});

test('a 404 on accept means it is gone: dropped, not retried, not re-read', async () => {
  const { store, count } = make({
    listReceived: async () => page([summary('a')]),
    accept: async () => { throw apiError(404, 'Offer not found.'); },
  });
  await store.refreshReceived();
  const outcome = await store.accept('a');
  assert.equal(outcome.kind, 'unavailable');
  assert.equal(received(store).items.length, 0);
  assert.equal(count('getReceived'), 0);
});

test('a refusal such as unavailable exercises is a plain failure and nothing is re-read', async () => {
  const { store, count } = make({
    listReceived: async () => page([summary('a')]),
    accept: async () => { throw apiError(409, 'This program uses exercises that are no longer available: X.'); },
  });
  await store.refreshReceived();
  const outcome = await store.accept('a');
  assert.equal(outcome.kind, 'failed');
  assert.match(outcome.message, /no longer available/);
  assert.equal(received(store).items[0].status, 'pending');
  assert.equal(count('getReceived'), 0);
  assert.equal(store.getSnapshot().responding, null);
});

test('a lost accept response is settled by reading the offer back', async () => {
  const { store } = make({
    listReceived: async () => page([summary('a')]),
    accept: async () => { throw networkError(); },
    getReceived: async (id) => detail(id, { status: 'accepted', program_id: 'copy-9' }),
  });
  await store.refreshReceived();
  const outcome = await store.accept('a');
  assert.equal(outcome.kind, 'done');
  assert.equal(outcome.offer.program_id, 'copy-9');
  assert.equal(received(store).items[0].status, 'accepted');
});

test('a lost accept that did not happen is a failure you can repeat', async () => {
  const { store } = make({
    accept: async () => { throw networkError(); },
    getReceived: async (id) => detail(id, { status: 'pending' }),
  });
  const outcome = await store.accept('a');
  assert.equal(outcome.kind, 'failed');
  assert.match(outcome.message, /try again/i);
});

test('a lost accept that cannot be read back is reported as unknown, not as a failure', async () => {
  const { store } = make({
    accept: async () => { throw networkError(); },
    getReceived: async () => { throw networkError(); },
  });
  assert.equal((await store.accept('a')).kind, 'unknown');
  assert.equal(store.getSnapshot().responding, null);
});

test('a lost accept whose read-back says the connection ended drops the offer', async () => {
  const { store } = make({
    listReceived: async () => page([summary('a')]),
    accept: async () => { throw networkError(); },
    getReceived: async () => { throw apiError(404, 'Offer not found.'); },
  });
  await store.refreshReceived();
  assert.equal((await store.accept('a')).kind, 'unavailable');
  assert.equal(received(store).items.length, 0);
});

test('declining works, and a lost decline is settled by reading back', async () => {
  const ok = make({ listReceived: async () => page([summary('a')]) });
  await ok.store.refreshReceived();
  assert.equal((await ok.store.decline('a')).kind, 'done');
  assert.equal(received(ok.store).items[0].status, 'declined');

  const lost = make({
    decline: async () => { throw networkError(); },
    getReceived: async (id) => detail(id, { status: 'declined' }),
  });
  assert.equal((await lost.store.decline('a')).kind, 'done');

  const raced = make({
    decline: async () => { throw networkError(); },
    getReceived: async (id) => detail(id, { status: 'accepted', program_id: 'c' }),
  });
  const outcome = await raced.store.decline('a');
  assert.equal(outcome.kind, 'failed');
  assert.match(outcome.message, /already accepted/);
});

test('sign-out voids every request still in flight', async () => {
  const list = deferred();
  const open = deferred();
  const answer = deferred();
  const { store } = make({
    listReceived: () => list.promise,
    getReceived: () => open.promise,
    accept: () => answer.promise,
  });
  const loading = store.refreshReceived();
  const opening = store.loadDetail('a');
  const accepting = store.accept('a');
  store.reset();
  list.resolve(page([summary('a')]));
  open.resolve(detail('a'));
  answer.resolve(detail('a', { status: 'accepted', program_id: 'copy' }));
  await loading;
  await opening;
  assert.equal((await accepting).kind, 'stale');
  const state = store.getSnapshot();
  assert.equal(state.userId, null);
  assert.equal(state.received.items.length, 0);
  assert.equal(state.detail.data, null);
  assert.equal(state.responding, null);
});

test('switching account drops the previous account’s offers and ignores their late answers', async () => {
  const gate = deferred();
  const { store } = make({ listReceived: () => gate.promise });
  const loading = store.refreshReceived();
  store.bind('athlete2');
  gate.resolve(page([summary('theirs')]));
  await loading;
  assert.equal(store.getSnapshot().userId, 'athlete2');
  assert.equal(received(store).items.length, 0);
  store.bind('athlete2'); // same user: nothing is dropped
  assert.equal(store.getSnapshot().userId, 'athlete2');
});

test('nothing is requested while no user is bound', async () => {
  const fake = fakeApi();
  const store = createProgramOffersStore(fake.api, ids);
  await store.refreshReceived();
  await store.loadDetail('a');
  assert.equal((await store.accept('a')).kind, 'stale');
  assert.equal((await store.send('l', 'p', 'fp1')).kind, 'stale');
  assert.equal(fake.calls.length, 0);
});

test('sending prepends the offer to this connection’s sent list', async () => {
  const { store } = make({ listSent: async () => page([sentSummary('old')], 1) });
  store.bindSent('link1');
  await store.refreshSent();
  const outcome = await store.send('link1', 'prog1', 'fp1');
  assert.equal(outcome.kind, 'done');
  same(store.getSnapshot().sent.items.map((item) => item.id), ['o-prog1', 'old']);
  assert.equal('program' in store.getSnapshot().sent.items[0], false);
});

test('a second tap while sending is ignored', async () => {
  const gate = deferred();
  const { store, count } = make({ send: () => gate.promise });
  const first = store.send('link1', 'prog1', 'fp1');
  assert.equal(store.getSnapshot().sending, true);
  const second = store.send('link1', 'prog1', 'fp1');
  gate.resolve({ ...sentSummary('x'), program: program() });
  assert.equal((await second).kind, 'ignored');
  await first;
  assert.equal(count('send'), 1);
  assert.equal(store.getSnapshot().sending, false);
});

test('an unclear send is repeated with the same request id, a settled one starts fresh', async () => {
  let fail = true;
  const seen = [];
  const { store } = make({
    send: async (_link, requestId, programId) => {
      seen.push(requestId);
      if (fail) throw networkError();
      return { ...sentSummary(`o-${programId}`), program: program() };
    },
  });
  const lost = await store.send('link1', 'prog1', 'fp1');
  assert.equal(lost.kind, 'unknown');
  assert.match(lost.message, /not be sent twice/);
  fail = false;
  assert.equal((await store.send('link1', 'prog1', 'fp1')).kind, 'done');
  assert.equal(seen[0], seen[1]); // the retry asked for the same offer
  await store.send('link1', 'prog1', 'fp1');
  assert.notEqual(seen[2], seen[1]); // a new send after success is a new request
});

test('a refused send starts fresh next time; another program has its own request id', async () => {
  const seen = [];
  const { store } = make({
    send: async (_link, requestId, programId) => {
      seen.push([programId, requestId]);
      if (programId === 'dup') throw apiError(409, 'This program is already waiting for the athlete’s answer.');
      throw networkError();
    },
  });
  const refused = await store.send('link1', 'dup', 'fp1');
  assert.equal(refused.kind, 'failed');
  assert.match(refused.message, /already waiting/);
  await store.send('link1', 'dup', 'fp1');
  assert.notEqual(seen[0][1], seen[1][1]);
  await store.send('link1', 'a', 'fp1');
  await store.send('link1', 'b', 'fp1');
  await store.send('link1', 'a', 'fp1');
  assert.notEqual(seen[2][1], seen[3][1]);
  assert.equal(seen[2][1], seen[4][1]);
});

test('a send to a connection that ended is unavailable', async () => {
  const { store } = make({ send: async () => { throw apiError(404, 'Connection not found.'); } });
  assert.equal((await store.send('link1', 'p', 'fp1')).kind, 'unavailable');
});

test('the sent list belongs to one connection and a late answer for another is dropped', async () => {
  const slow = deferred();
  const { store } = make({
    listSent: (link) => (link === 'link1' ? slow.promise : Promise.resolve(page([sentSummary('b')]))),
  });
  store.bindSent('link1');
  const first = store.refreshSent();
  store.bindSent('link2');
  await store.refreshSent();
  slow.resolve(page([sentSummary('a')]));
  await first;
  assert.equal(store.getSnapshot().sent.linkId, 'link2');
  same(store.getSnapshot().sent.items.map((item) => item.id), ['b']);
});

test('a sent list that returns 404 shows nothing and is not requested again', async () => {
  const { store, count } = make({ listSent: async () => { throw apiError(404, 'Connection not found.'); } });
  store.bindSent('link1');
  await store.refreshSent();
  assert.equal(store.getSnapshot().sent.unavailable, true);
  await store.refreshSent();
  assert.equal(count('listSent'), 1);
});

test('sign-out while a send is in flight leaves no trace', async () => {
  const gate = deferred();
  const { store } = make({ send: () => gate.promise });
  store.bindSent('link1');
  const sending = store.send('link1', 'p', 'fp1');
  store.reset();
  gate.resolve({ ...sentSummary('x'), program: program() });
  assert.equal((await sending).kind, 'stale');
  assert.equal(store.getSnapshot().sent.items.length, 0);
  assert.equal(store.getSnapshot().sending, false);
});

test('prescriptions read as the coach set them', () => {
  const p = display.prescriptionText;
  assert.equal(p({ target_sets: 4, target_reps_min: 6, target_reps_max: 8, target_rir: 0, target_rpe: null }),
    '4 sets · 6–8 reps · RIR 0');
  assert.equal(p({ target_sets: 1, target_reps_min: 8, target_reps_max: 8, target_rir: null, target_rpe: '8.5' }),
    '1 set · 8 reps · RPE 8.5');
  assert.equal(p({ target_sets: 3, target_reps_min: 5, target_reps_max: null, target_rir: 2, target_rpe: '8.0' }),
    '3 sets · at least 5 reps · RIR 2 · RPE 8');
  assert.equal(p({ target_sets: 3, target_reps_min: null, target_reps_max: null, target_rir: null, target_rpe: null }),
    '3 sets');
  assert.equal(display.repsText(null, 12), 'up to 12 reps');
});

test('counts and status words read plainly', () => {
  assert.equal(display.exerciseCount({ name: 'P', notes: null, templates: [
    { name: 'A', day_order: 0, notes: null, exercises: [{}, {}] },
    { name: 'B', day_order: 1, notes: null, exercises: [{}] },
  ] }), 3);
  assert.equal(display.summaryText(1, 1), '1 day · 1 exercise');
  assert.equal(display.summaryText(3, 12), '3 days · 12 exercises');
  assert.equal(display.offerStatusLabel('pending'), 'Waiting');
  assert.equal(display.offerStatusLabel('accepted'), 'Added');
  assert.equal(display.offerStatusLabel('declined'), 'Declined');
});

test('the confirmation carries the previewed fingerprint to the backend', async () => {
  const { store, calls } = make();
  await store.send('link1', 'prog1', 'fp-shown');
  assert.equal(calls.at(-1)[4], 'fp-shown');
});

test('a program that changed after the preview is reported as changed, not as a failure', async () => {
  const { store } = make({
    send: async () => { throw apiError(412, 'This program changed after you reviewed it.'); },
  });
  store.bindSent('link1');
  const outcome = await store.send('link1', 'prog1', 'old');
  assert.equal(outcome.kind, 'changed');
  assert.match(outcome.message, /reviewed/);
  assert.equal(store.getSnapshot().sent.items.length, 0);
  assert.equal(store.getSnapshot().sending, false);
});

test('content that was reviewed again is a new confirmation with its own request id', async () => {
  const seen = [];
  let stale = true;
  const { store } = make({
    send: async (_link, requestId, programId, fingerprint) => {
      seen.push([requestId, fingerprint]);
      if (stale && fingerprint === 'old') throw apiError(412, 'changed');
      if (fingerprint === 'new' && seen.length === 2) throw networkError();
      return { ...sentSummary(`o-${programId}`), program: program() };
    },
  });
  assert.equal((await store.send('link1', 'prog1', 'old')).kind, 'changed');
  // The coach reviews the new version and confirms; the reply is lost.
  assert.equal((await store.send('link1', 'prog1', 'new')).kind, 'unknown');
  assert.notEqual(seen[0][0], seen[1][0]);
  // Retrying the same confirmed content repeats the same operation...
  assert.equal((await store.send('link1', 'prog1', 'new')).kind, 'done');
  assert.equal(seen[1][0], seen[2][0]);
  // ...but nothing is replayed once it succeeded: a later confirmation is new again.
  await store.send('link1', 'prog1', 'new');
  assert.notEqual(seen[3][0], seen[2][0]);
  stale = false;
});

test('an unclear send of old content does not lend its request id to newly reviewed content', async () => {
  const seen = [];
  const { store } = make({
    send: async (_link, requestId, programId, fingerprint) => {
      seen.push([requestId, fingerprint]);
      if (fingerprint === 'old') throw networkError();
      return { ...sentSummary(`o-${programId}`), program: program() };
    },
  });
  assert.equal((await store.send('link1', 'prog1', 'old')).kind, 'unknown');
  assert.equal((await store.send('link1', 'prog1', 'new')).kind, 'done');
  assert.notEqual(seen[0][0], seen[1][0]);
});
