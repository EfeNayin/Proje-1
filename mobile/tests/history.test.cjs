/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || root] }));
const code = ts.transpileModule(readFileSync(path.join(root, 'src/workout/workoutHistory.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(code, { module: loaded, exports: loaded.exports });
const { createWorkoutHistory } = loaded.exports;
const page = (offset, count, total) => ({
  offset, limit: 20, total,
  items: Array.from({ length: count }, (_, n) => ({ id: String(offset + n) })),
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('loads all 45 workouts in three pages and stops', async () => {
  const offsets = [];
  const history = createWorkoutHistory(async (limit, offset) => {
    assert.equal(limit, 20);
    offsets.push(offset);
    return page(offset, Math.min(limit, 45 - offset), 45);
  });
  await history.refresh();
  await history.loadMore();
  await history.loadMore();
  await history.loadMore();
  assert.deepEqual(offsets, [0, 20, 40]);
  assert.equal(history.getSnapshot().items.length, 45);
  assert.equal(history.getSnapshot().hasMore, false);
});

test('repeated scroll events do not request the same page twice', async () => {
  const pending = deferred();
  let moreCalls = 0;
  const history = createWorkoutHistory(async (_, offset) => {
    if (!offset) return page(0, 20, 40);
    moreCalls++;
    return pending.promise;
  });
  await history.refresh();
  const first = history.loadMore();
  await history.loadMore();
  assert.equal(moreCalls, 1);
  pending.resolve(page(20, 20, 40));
  await first;
  assert.equal(history.getSnapshot().items.length, 40);
});

test('failed next page keeps existing items and retries the same offset explicitly', async () => {
  let fail = true;
  const offsets = [];
  const history = createWorkoutHistory(async (_, offset) => {
    offsets.push(offset);
    if (offset && fail) throw new Error('offline');
    return page(offset, 20, 40);
  });
  await history.refresh();
  await history.loadMore();
  assert.equal(history.getSnapshot().items.length, 20);
  assert.equal(history.getSnapshot().error, 'more');
  await history.loadMore();
  assert.deepEqual(offsets, [0, 20]);
  fail = false;
  await history.loadMore(true);
  assert.deepEqual(offsets, [0, 20, 20]);
  assert.equal(history.getSnapshot().items.length, 40);
  assert.equal(history.getSnapshot().error, null);
});

test('refresh discards a late next-page response and resets the offset', async () => {
  const pending = deferred();
  let moreCalls = 0;
  const history = createWorkoutHistory(async (_, offset) => {
    if (!offset) return page(0, 20, 40);
    moreCalls++;
    return moreCalls === 1 ? pending.promise : page(20, 20, 40);
  });
  await history.refresh();
  const old = history.loadMore();
  await history.refresh();
  pending.resolve(page(20, 20, 40));
  await old;
  assert.equal(history.getSnapshot().items.length, 20);
  await history.loadMore();
  assert.equal(history.getSnapshot().items.length, 40);
});

test('overlapping refreshes accept only the latest result', async () => {
  const oldPage = deferred();
  let calls = 0;
  const history = createWorkoutHistory(async () => ++calls === 1 ? oldPage.promise : page(0, 1, 1));
  const old = history.refresh();
  await history.refresh();
  oldPage.resolve(page(0, 20, 40));
  await old;
  assert.equal(history.getSnapshot().items.length, 1);
  assert.equal(history.getSnapshot().hasMore, false);
});

test('overlapping rows are deduplicated without corrupting the server offset', async () => {
  const offsets = [];
  const history = createWorkoutHistory(async (_, offset) => {
    offsets.push(offset);
    if (offset === 20) return { ...page(20, 20, 41), items: page(19, 20, 41).items };
    return page(offset, offset === 40 ? 1 : 20, 41);
  });
  await history.refresh();
  await history.loadMore();
  assert.equal(history.getSnapshot().items.length, 39);
  await history.loadMore();
  assert.deepEqual(offsets, [0, 20, 40]);
  assert.equal(new Set(history.getSnapshot().items.map((item) => item.id)).size, 40);
});

test('a failed refresh preserves loaded history and blocks stale pagination', async () => {
  let fail = false;
  let calls = 0;
  const history = createWorkoutHistory(async () => {
    calls++;
    if (fail) throw new Error('offline');
    return page(0, 20, 40);
  });
  await history.refresh();
  fail = true;
  await history.refresh();
  await history.loadMore(true);
  assert.equal(calls, 2);
  assert.equal(history.getSnapshot().items.length, 20);
  assert.equal(history.getSnapshot().error, 'refresh');
});

test('empty history is complete and an empty later page cannot loop', async () => {
  const empty = createWorkoutHistory(async () => page(0, 0, 0));
  await empty.refresh();
  assert.equal(empty.getSnapshot().hasMore, false);
  assert.equal(empty.getSnapshot().error, null);
  let calls = 0;
  const history = createWorkoutHistory(async (_, offset) => {
    calls++;
    return offset ? page(offset, 0, 40) : page(0, 20, 40);
  });
  await history.refresh();
  await history.loadMore();
  await history.loadMore();
  assert.equal(calls, 2);
  assert.equal(history.getSnapshot().hasMore, false);
});

test('leaving the screen invalidates its outstanding response', async () => {
  const pending = deferred();
  const history = createWorkoutHistory(async () => pending.promise);
  const request = history.refresh();
  history.cancel();
  pending.resolve(page(0, 20, 40));
  await request;
  assert.equal(history.getSnapshot().items.length, 0);
  assert.equal(history.getSnapshot().loading, false);
});

test('first-load failure exposes retry instead of a successful empty history', async () => {
  const history = createWorkoutHistory(async () => { throw new Error('offline'); });
  await history.refresh();
  assert.equal(history.getSnapshot().error, 'refresh');
  assert.equal(history.getSnapshot().loading, false);
});
