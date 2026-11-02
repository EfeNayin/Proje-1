// Run with node --test tests/program-preparation.test.cjs. Pure logic, no I/O.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadTs } = require('./support/load-ts.cjs');

const mobileRoot = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(mobileRoot, file), 'utf8');
const { createProgramPreparationStore } = loadTs('src/coaching/programPreparation.ts');
const display = loadTs('src/coaching/offerDisplay.ts');

// Values built inside the vm context are not reference-equal to this realm's, so compare as JSON.
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const apiError = (status, message = `HTTP ${status}`) => Object.assign(new Error(message), { status });
const networkError = () => apiError(0, 'Cannot connect right now. Check your connection and try again.');

const athlete = { username: 'ada', first_name: 'Ada', last_name: null };
const summary = (id, extra = {}) => ({
  id, draft_program_id: `draft-${id}`, name: `Plan ${id}`, athlete, created_at: '2026-10-01T10:00:00Z',
  latest_version: null, latest_status: null, pending_version: null, ...extra,
});
const detail = (id, extra = {}) => ({ ...summary(id), has_unpublished_changes: true, versions: [], ...extra });
const preview = (id, extra = {}) => ({
  lineage_id: id, athlete, version: 1, replaces_version: null, fingerprint: 'fp-1',
  program: { name: 'Plan', notes: null, templates: [] }, ...extra,
});
const published = (version = 1) => ({ id: `offer-${version}`, version, status: 'pending', program: {} });

function fakeApi(overrides = {}) {
  const calls = [];
  const record = (name, impl) => (...args) => { calls.push([name, ...args]); return impl(...args); };
  const api = {
    list: record('list', async () => ({ items: [] })),
    create: record('create', async (_link, _request, input) => detail('new', { name: input.name ?? 'Copy' })),
    get: record('get', async (_link, id) => detail(id)),
    discard: record('discard', async () => undefined),
    preview: record('preview', async (_link, id) => preview(id)),
    publish: record('publish', async (_link, _id, _request, _fingerprint) => published()),
  };
  for (const [name, impl] of Object.entries(overrides)) api[name] = record(name, impl);
  return { api, calls, count: (name) => calls.filter((call) => call[0] === name).length };
}

let counter = 0;
const ids = () => `req-${++counter}`;
const make = (overrides, link = 'link1') => {
  const fake = fakeApi(overrides);
  const store = createProgramPreparationStore(fake.api, ids);
  store.bind('coach1');
  store.bindLink(link);
  return { store, ...fake };
};

test('the list loads, concurrent refreshes share one request and a failed refresh keeps the list', async () => {
  let fail = false;
  const { store, count } = make({
    list: async () => {
      if (fail) throw networkError();
      return { items: [summary('a')] };
    },
  });
  const first = store.refreshList();
  void store.refreshList();
  assert.equal(store.getSnapshot().list.loading, true);
  await first;
  assert.equal(count('list'), 1);
  assert.equal(store.getSnapshot().list.items.length, 1);
  assert.equal(store.getSnapshot().list.loaded, true);
  fail = true;
  await store.refreshList();
  assert.equal(store.getSnapshot().list.items.length, 1);
  assert.match(store.getSnapshot().list.error, /connect/);
});

test('a 404 marks the connection unavailable and nothing more is requested', async () => {
  const { store, count } = make({ list: async () => { throw apiError(404); } });
  await store.refreshList();
  const { list } = store.getSnapshot();
  assert.equal(list.unavailable, true);
  assert.equal(list.items.length, 0);
  await store.refreshList();
  assert.equal(count('list'), 1);
});

test('nothing is requested before a user and a connection are bound', async () => {
  const fake = fakeApi();
  const store = createProgramPreparationStore(fake.api, ids);
  await store.refreshList();
  store.bind('coach1');
  await store.refreshList();
  assert.equal((await store.create({ name: 'x' })).kind, 'stale');
  assert.equal((await store.publishVersion('a', 'fp')).kind, 'stale');
  assert.equal(fake.calls.length, 0);
});

test('creating prepends the preparation, is double-tap safe and releases the lock', async () => {
  const gate = deferred();
  const { store, count } = make({ create: async () => { await gate.promise; return detail('n1'); } });
  const first = store.create({ name: 'Plan' });
  assert.equal(store.getSnapshot().creating, true);
  assert.equal((await store.create({ name: 'Plan' })).kind, 'ignored');
  gate.resolve();
  const outcome = await first;
  assert.equal(outcome.kind, 'done');
  assert.equal(count('create'), 1);
  assert.equal(store.getSnapshot().creating, false);
  assert.equal(store.getSnapshot().list.items[0].id, 'n1');
});

test('an unconfirmed create repeats the same request id; a refusal or different input starts fresh', async () => {
  let mode = 'network';
  const { store, calls } = make({
    create: async () => {
      if (mode === 'network') throw networkError();
      if (mode === 'refuse') throw apiError(422, 'Name is required');
      return detail('n1');
    },
  });
  const first = await store.create({ name: 'Plan' });
  assert.equal(first.kind, 'unknown');
  const second = await store.create({ name: 'Plan' });
  assert.equal(second.kind, 'unknown');
  assert.equal(calls[0][2], calls[1][2], 'same request id after an unclear failure');
  await store.create({ name: 'Other' });
  assert.notEqual(calls[2][2], calls[0][2], 'different input is a different request');
  mode = 'refuse';
  assert.equal((await store.create({ name: 'Plan' })).kind, 'failed');
  mode = 'ok';
  assert.equal((await store.create({ name: 'Plan' })).kind, 'done');
  assert.notEqual(calls[4][2], calls[0][2], 'a definitive refusal released the old request id');
});

test('creating from a program is keyed by that program', async () => {
  const { store, calls } = make({ create: async () => { throw networkError(); } });
  await store.create({ from_program_id: 'p1' });
  await store.create({ from_program_id: 'p2' });
  await store.create({ from_program_id: 'p1' });
  assert.notEqual(calls[0][2], calls[1][2]);
  assert.equal(calls[0][2], calls[2][2]);
});

test('create on a connection that ended reports it unavailable', async () => {
  const { store } = make({ create: async () => { throw apiError(404); } });
  const outcome = await store.create({ name: 'Plan' });
  assert.equal(outcome.kind, 'unavailable');
  assert.match(outcome.message, /ended/);
});

test('publishing carries the previewed fingerprint, is double-tap safe and clears the preview', async () => {
  const gate = deferred();
  const { store, calls, count } = make({ publish: async () => { await gate.promise; return published(2); } });
  await store.loadPreview('a');
  assert.equal(store.getSnapshot().preview.data.fingerprint, 'fp-1');
  const first = store.publishVersion('a', 'fp-1');
  assert.equal(store.getSnapshot().publishing, true);
  assert.equal((await store.publishVersion('a', 'fp-1')).kind, 'ignored');
  gate.resolve();
  const outcome = await first;
  assert.equal(outcome.kind, 'done');
  assert.equal(count('publish'), 1);
  same(calls.find((call) => call[0] === 'publish').slice(1, 2), ['link1']);
  assert.equal(calls.find((call) => call[0] === 'publish')[4], 'fp-1');
  assert.equal(store.getSnapshot().publishing, false);
  assert.equal(store.getSnapshot().preview.data, null, 'a published preview cannot be confirmed again');
});

test('an unconfirmed publish repeats the same request id; a new fingerprint is a new decision', async () => {
  let mode = 'network';
  const { store, calls } = make({
    publish: async () => {
      if (mode === 'network') throw networkError();
      if (mode === 'server') throw apiError(500);
      return published();
    },
  });
  assert.equal((await store.publishVersion('a', 'fp-1')).kind, 'unknown');
  mode = 'server';
  assert.equal((await store.publishVersion('a', 'fp-1')).kind, 'unknown');
  assert.equal(calls[0][3], calls[1][3], 'same request id after an unclear failure');
  await store.publishVersion('a', 'fp-2');
  assert.notEqual(calls[2][3], calls[0][3]);
  mode = 'ok';
  assert.equal((await store.publishVersion('a', 'fp-1')).kind, 'done');
  assert.equal(calls[3][3], calls[0][3], 'the confirmed content keeps its request until it settles');
  mode = 'network';
  await store.publishVersion('a', 'fp-1');
  assert.notEqual(calls[4][3], calls[0][3], 'a settled publish does not reuse its request id');
});

test('412 means nothing was published; refusals and a gone connection are reported as such', async () => {
  let status = 412;
  const { store, calls } = make({ publish: async () => { throw apiError(status, 'The program changed.'); } });
  const changed = await store.publishVersion('a', 'fp-1');
  assert.equal(changed.kind, 'changed');
  assert.match(changed.message, /changed/);
  await store.publishVersion('a', 'fp-1');
  assert.notEqual(calls[0][3], calls[1][3], 'a changed preview releases the old request id');
  status = 422;
  assert.equal((await store.publishVersion('a', 'fp-9')).kind, 'failed');
  status = 404;
  assert.equal((await store.publishVersion('a', 'fp-9')).kind, 'unavailable');
});

test('loadPreview marks a replaced preview as changed and handles 404', async () => {
  let status = null;
  const { store } = make({
    preview: async (_link, id) => {
      if (status) throw apiError(status);
      return preview(id, { version: 2, replaces_version: 1 });
    },
  });
  await store.loadPreview('a', true);
  const { preview: shown } = store.getSnapshot();
  assert.equal(shown.changed, true);
  assert.equal(shown.data.version, 2);
  assert.equal(shown.data.replaces_version, 1);
  status = 404;
  await store.loadPreview('a');
  assert.equal(store.getSnapshot().preview.unavailable, true);
  assert.equal(store.getSnapshot().preview.data, null);
});

test('a late preview for a preparation that was left is ignored', async () => {
  const gate = deferred();
  const { store } = make({ preview: async () => { await gate.promise; return preview('a'); } });
  const loading = store.loadPreview('a');
  store.closeDetail();
  gate.resolve();
  await loading;
  assert.equal(store.getSnapshot().preview.data, null);
  assert.equal(store.getSnapshot().preview.lineageId, null);
});

test('loading a preparation keeps what is shown on a failed reload and clears it on 404', async () => {
  let mode = 'ok';
  const { store } = make({
    get: async (_link, id) => {
      if (mode === 'network') throw networkError();
      if (mode === 'gone') throw apiError(404);
      return detail(id, { name: 'Loaded' });
    },
  });
  await store.refreshList();
  await store.loadDetail('a');
  assert.equal(store.getSnapshot().detail.data.name, 'Loaded');
  mode = 'network';
  await store.loadDetail('a');
  assert.equal(store.getSnapshot().detail.data.name, 'Loaded');
  assert.match(store.getSnapshot().detail.error, /connect/);
  mode = 'gone';
  await store.loadDetail('a');
  assert.equal(store.getSnapshot().detail.unavailable, true);
  assert.equal(store.getSnapshot().detail.data, null);
});

test('discarding removes the preparation; a failure keeps it; 404 reports unavailable', async () => {
  let mode = 'fail';
  const { store, count } = make({
    list: async () => ({ items: [summary('a'), summary('b')] }),
    discard: async () => {
      if (mode === 'fail') throw apiError(409, 'Already published');
      if (mode === 'gone') throw apiError(404);
    },
  });
  await store.refreshList();
  assert.equal((await store.discard('a')).kind, 'failed');
  assert.equal(store.getSnapshot().list.items.length, 2);
  mode = 'ok';
  assert.equal((await store.discard('a')).kind, 'done');
  same(store.getSnapshot().list.items.map((item) => item.id), ['b']);
  mode = 'gone';
  assert.equal((await store.discard('b')).kind, 'unavailable');
  assert.ok(count('list') >= 2, 'a 404 refreshes the list');
});

test('sign-out, another user or another connection voids everything still in flight', async () => {
  for (const change of [
    (store) => store.reset(),
    (store) => store.bind('someone-else'),
    (store) => store.bindLink('link2'),
  ]) {
    const gate = deferred();
    const { store } = make({
      list: async () => { await gate.promise; return { items: [summary('a')] }; },
      create: async () => { await gate.promise; return detail('n'); },
      publish: async () => { await gate.promise; return published(); },
    });
    const listing = store.refreshList();
    const creating = store.create({ name: 'Plan' });
    const publishing = store.publishVersion('a', 'fp-1');
    change(store);
    gate.resolve();
    await listing;
    assert.equal((await creating).kind, 'stale');
    assert.equal((await publishing).kind, 'stale');
    assert.equal(store.getSnapshot().list.items.length, 0);
    assert.equal(store.getSnapshot().creating, false);
    assert.equal(store.getSnapshot().publishing, false);
  }
});

test('after a reset the next account starts with fresh request ids and an empty state', async () => {
  const { store, calls } = make({ create: async () => { throw networkError(); } });
  await store.create({ name: 'Plan' });
  store.reset();
  store.bind('coach2');
  store.bindLink('link1');
  await store.create({ name: 'Plan' });
  assert.notEqual(calls[0][2], calls[1][2]);
  assert.equal(store.getSnapshot().userId, 'coach2');
});

test('subscribers are told about changes and can unsubscribe', async () => {
  const { store } = make();
  let notified = 0;
  const off = store.subscribe(() => { notified += 1; });
  await store.refreshList();
  assert.ok(notified > 0);
  off();
  const before = notified;
  await store.refreshList();
  assert.equal(notified, before);
});

// ── Display helpers ───────────────────────────────────────────────────────

test('status wording: athlete, coach and preparation views', () => {
  assert.equal(display.offerStatusLabel('pending'), 'Waiting');
  assert.equal(display.offerStatusLabel('accepted'), 'Added');
  assert.equal(display.offerStatusLabel('declined'), 'Declined');
  assert.equal(display.offerStatusLabel('superseded'), 'Replaced');
  assert.equal(display.coachStatusLabel('pending'), 'Waiting for answer');
  assert.equal(display.coachStatusLabel('accepted'), 'Accepted');
  assert.equal(display.coachStatusLabel('superseded'), 'Replaced by a newer version');
  // Nothing on the coach side claims the athlete follows or finished the program.
  for (const status of ['pending', 'accepted', 'declined', 'superseded']) {
    assert.doesNotMatch(display.coachStatusLabel(status), /follow|active|complet|finish/i);
  }
  assert.equal(display.versionLabel(3), 'Version 3');
  assert.equal(display.versionLabel(null), null);
  assert.equal(display.lineageStatusText(null, null), 'Draft · not published yet');
  assert.equal(display.lineageStatusText(2, 'accepted'), 'Version 2 · Accepted');
  for (const status of ['pending', 'accepted', 'declined', 'superseded']) {
    assert.ok(display.OFFER_STATUS_ICON[status], `icon for ${status}`);
  }
});

test('acceptance text states what accepting will do', () => {
  const inactive = display.acceptanceText(
    { kind: 'inactive_copy', replaces_version: null, replaces_program_name: null, keeps_active_program_name: 'Mine' },
    'Cora',
  );
  assert.match(inactive[0], /switched off/);
  assert.match(inactive[0], /“Mine”/);
  assert.match(inactive.join(' '), /Personal edits.*not carried/);
  const none = display.acceptanceText(
    { kind: 'inactive_copy', replaces_version: null, replaces_program_name: null, keeps_active_program_name: null },
    'Cora',
  );
  assert.match(none[0], /You choose when to activate/);
  const replaces = display.acceptanceText(
    { kind: 'replaces_active_copy', replaces_version: 1, replaces_program_name: 'Plan v1', keeps_active_program_name: null },
    'Cora',
  );
  assert.match(replaces[0], /version 1/);
  assert.match(replaces[0], /new copy becomes your active program/);
  assert.match(replaces[0], /not deleted/);
  assert.match(display.acceptedNotice({ activated: true, version: 2 }), /now your active program/);
  assert.match(display.acceptedNotice({ activated: false, version: 2 }), /not active/);
  assert.match(display.acceptedNotice({ activated: null, version: null }), /not active/);
});

// ── Screens: source-level guards (no renderer in this suite) ──────────────

test('the new routes are registered and reachable from the athlete screen', () => {
  const layout = read('app/(app)/_layout.tsx');
  for (const route of [
    'coaching/athlete/[linkId]/programs/index',
    'coaching/athlete/[linkId]/programs/[lineageId]/index',
    'coaching/athlete/[linkId]/programs/[lineageId]/publish',
    'coaching/athlete/[linkId]/programs/[lineageId]/version/[version]',
  ]) {
    assert.ok(layout.includes(`name="${route}"`), route);
  }
  const athlete = read('app/(app)/coaching/athlete/[linkId]/index.tsx');
  assert.match(athlete, /Program management/);
  assert.match(athlete, /\/programs`\)/);
});

test('the preparation store is cleared at sign-out', () => {
  const auth = read('src/auth/AuthContext.tsx');
  assert.match(auth, /programPreparationStore\.reset\(\)/);
});

test('every preparation screen is keyed by account and shows the recipient', () => {
  const base = 'app/(app)/coaching/athlete/[linkId]/programs';
  for (const file of [`${base}/index.tsx`, `${base}/[lineageId]/index.tsx`, `${base}/[lineageId]/publish.tsx`]) {
    const source = read(file);
    assert.match(source, /key=\{`\$\{user\?\.id \?\? "signed-out"\}:/, `${file} keyed by account`);
    assert.match(source, /RecipientBanner|name\b/, file);
  }
  assert.match(read(`${base}/[lineageId]/publish.tsx`), /RecipientBanner/);
  assert.match(read(`${base}/[lineageId]/index.tsx`), /RecipientBanner/);
});

test('publishing needs the previewed fingerprint and an explicit press', () => {
  const source = read('app/(app)/coaching/athlete/[linkId]/programs/[lineageId]/publish.tsx');
  assert.match(source, /publishVersion\(lineageId, preview\.fingerprint\)/);
  assert.match(source, /Publish version \$\{preview\.version\} to \$\{athlete\}/);
  assert.match(source, /disabled=\{blocked\}/);
  // Loading the preview never publishes.
  assert.doesNotMatch(source, /useFocusEffect[\s\S]{0,400}publishVersion/);
});

test('a prepared draft cannot be activated or deleted from the editor', () => {
  const program = read('app/(app)/program/[id].tsx');
  assert.match(program, /!program\.is_active && !preparedFor/);
  assert.match(program, /onDelete=\{preparedFor \? undefined : handleDelete\}/);
  assert.match(program, /RecipientBanner/);
  assert.match(read('app/(app)/program/template/[id].tsx'), /template\.prepared_for/);
});

test('received program screens use the shared status icons and show the acceptance effect', () => {
  for (const file of ['app/(app)/coaching/program-offer/[offerId].tsx', 'app/(app)/coaching/programs-received.tsx']) {
    const source = read(file);
    assert.match(source, /OFFER_STATUS_ICON/);
    assert.doesNotMatch(source, /const STATUS_ICON/);
  }
  const offer = read('app/(app)/coaching/program-offer/[offerId].tsx');
  assert.match(offer, /acceptanceText\(offer\.acceptance/);
  assert.match(offer, /acceptedNotice\(outcome\.offer\)/);
  assert.match(offer, /status === "superseded"/);
  assert.match(read('app/(app)/coaching/athlete/[linkId]/send-program.tsx'), /coachStatusLabel/);
});
