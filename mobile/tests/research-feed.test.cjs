/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || root] }));
function load(file) {
  const code = ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Set, Promise, Error });
  return loaded.exports;
}
const { createPublicationFeed } = load('src/research/publicationFeed.ts');
const { pubmedLink } = load('src/research/sourceLink.ts');

const pub = (pmid) => ({
  pmid: String(pmid), title: `Paper ${pmid}`, year: 2025, journal: 'J', publication_types: [],
  abstract: null, source_url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
});
const page = (ids, next) => ({ items: ids.map(pub), next_cursor: next, total: 99 });
// Spread into outer-realm arrays/objects: values built inside the vm context have a different prototype.
const ids = (feed) => [...feed.getSnapshot().items.map((item) => item.pmid)];
const plain = (value) => ({ ...value });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('first load fetches page one with no cursor and marks the feed loaded', async () => {
  const cursors = [];
  const feed = createPublicationFeed(async (cursor) => { cursors.push(cursor); return page([1, 2], 'c1'); });
  assert.equal(feed.getSnapshot().loaded, false);
  await feed.ensureLoaded();
  assert.deepEqual(cursors, [null]);
  assert.deepEqual(ids(feed), ['1', '2']);
  assert.equal(feed.getSnapshot().loaded, true);
  assert.equal(feed.getSnapshot().hasMore, true);
  assert.equal(feed.getSnapshot().loading, false);
});

test('empty result is loaded, empty, and has no error', async () => {
  const feed = createPublicationFeed(async () => ({ items: [], next_cursor: null, total: 0 }));
  await feed.ensureLoaded();
  const state = feed.getSnapshot();
  assert.equal(state.loaded, true);
  assert.equal(state.items.length, 0);
  assert.equal(state.error, null);
  assert.equal(state.hasMore, false);
});

test('first-load failure shows the server message and loaded stays false; retry recovers', async () => {
  let fail = true;
  const feed = createPublicationFeed(async () => {
    if (fail) throw new Error('PubMed is unavailable right now. Try again later.');
    return page([1], null);
  });
  await feed.ensureLoaded();
  assert.deepEqual(plain(feed.getSnapshot().error), { kind: 'refresh', message: 'PubMed is unavailable right now. Try again later.' });
  assert.equal(feed.getSnapshot().items.length, 0);
  assert.equal(feed.getSnapshot().loaded, false);
  fail = false;
  await feed.refresh();
  assert.deepEqual(ids(feed), ['1']);
  assert.equal(feed.getSnapshot().error, null);
});

test('non-Error rejection falls back to a generic message', async () => {
  const feed = createPublicationFeed(async () => { throw 'boom'; });
  await feed.refresh();
  assert.equal(feed.getSnapshot().error.kind, 'refresh');
  assert.ok(feed.getSnapshot().error.message.length > 0);
});

test('load more sends the cursor from the previous page and appends', async () => {
  const cursors = [];
  const feed = createPublicationFeed(async (cursor) => {
    cursors.push(cursor);
    if (cursor === null) return page([1, 2], 'c1');
    if (cursor === 'c1') return page([3, 4], 'c2');
    return page([5], null);
  });
  await feed.refresh();
  await feed.loadMore();
  await feed.loadMore();
  await feed.loadMore(); // nothing left
  assert.deepEqual(cursors, [null, 'c1', 'c2']);
  assert.deepEqual(ids(feed), ['1', '2', '3', '4', '5']);
  assert.equal(feed.getSnapshot().hasMore, false);
});

test('repeated load-more presses share one request for the same page', async () => {
  const pending = deferred();
  let moreCalls = 0;
  const feed = createPublicationFeed(async (cursor) => {
    if (cursor === null) return page([1], 'c1');
    moreCalls++;
    return pending.promise;
  });
  await feed.refresh();
  const first = feed.loadMore();
  const second = feed.loadMore();
  const third = feed.loadMore(true);
  assert.equal(moreCalls, 1);
  pending.resolve(page([2], null));
  await Promise.all([first, second, third]);
  assert.deepEqual(ids(feed), ['1', '2']);
});

test('repeated refresh presses share one request', async () => {
  const pending = deferred();
  let calls = 0;
  const feed = createPublicationFeed(() => { calls++; return pending.promise; });
  const a = feed.refresh();
  const b = feed.refresh();
  assert.equal(calls, 1);
  pending.resolve(page([1], null));
  await Promise.all([a, b]);
  assert.deepEqual(ids(feed), ['1']);
});

test('records repeated across pages are shown once, by PMID', async () => {
  const feed = createPublicationFeed(async (cursor) => (cursor === null ? page([1, 2, 2], 'c1') : page([2, 3, 1], null)));
  await feed.refresh();
  assert.deepEqual(ids(feed), ['1', '2']);
  await feed.loadMore();
  assert.deepEqual(ids(feed), ['1', '2', '3']);
});

test('failed next page keeps the list, does not retry itself, and retries the same cursor on request', async () => {
  let fail = true;
  const cursors = [];
  const feed = createPublicationFeed(async (cursor) => {
    cursors.push(cursor);
    if (cursor === null) return page([1, 2], 'c1');
    if (fail) throw new Error('PubMed took too long to respond. Try again.');
    return page([3], null);
  });
  await feed.refresh();
  await feed.loadMore();
  assert.deepEqual(ids(feed), ['1', '2']);
  assert.deepEqual(plain(feed.getSnapshot().error), { kind: 'more', message: 'PubMed took too long to respond. Try again.' });
  assert.equal(feed.getSnapshot().hasMore, true);
  await feed.loadMore(); // end-reached firing again must not loop
  assert.deepEqual(cursors, [null, 'c1']);
  fail = false;
  await feed.loadMore(true);
  assert.deepEqual(cursors, [null, 'c1', 'c1']);
  assert.deepEqual(ids(feed), ['1', '2', '3']);
  assert.equal(feed.getSnapshot().error, null);
});

test('failed refresh keeps the existing list and reports a refresh error', async () => {
  let fail = false;
  const feed = createPublicationFeed(async () => {
    if (fail) throw new Error('down');
    return page([1, 2], 'c1');
  });
  await feed.refresh();
  fail = true;
  await feed.refresh();
  assert.deepEqual(ids(feed), ['1', '2']);
  assert.equal(feed.getSnapshot().error.kind, 'refresh');
  assert.equal(feed.getSnapshot().loading, false);
  await feed.loadMore(); // blocked until the refresh error is resolved
  assert.equal(feed.getSnapshot().loadingMore, false);
});

test('a refresh replaces the list and restarts paging from the first cursor', async () => {
  let version = 1;
  const cursors = [];
  const feed = createPublicationFeed(async (cursor) => {
    cursors.push(cursor);
    if (cursor === null) return version === 1 ? page([1, 2], 'a') : page([9, 1], 'b');
    return page([3], null);
  });
  await feed.refresh();
  await feed.loadMore();
  version = 2;
  await feed.refresh();
  assert.deepEqual(ids(feed), ['9', '1']);
  await feed.loadMore();
  assert.deepEqual(cursors, [null, 'a', null, 'b']);
});

test('leaving the screen (cancel) drops a late first page and a late next page', async () => {
  const first = deferred();
  const feed = createPublicationFeed(() => first.promise);
  const loading = feed.refresh();
  feed.cancel();
  assert.equal(feed.getSnapshot().loading, false);
  first.resolve(page([1], null));
  await loading;
  assert.equal(feed.getSnapshot().items.length, 0);
  assert.equal(feed.getSnapshot().loaded, false);

  const more = deferred();
  const feed2 = createPublicationFeed(async (cursor) => (cursor === null ? page([1], 'c') : more.promise));
  await feed2.refresh();
  const pendingMore = feed2.loadMore();
  feed2.cancel();
  more.resolve(page([2], null));
  await pendingMore;
  assert.deepEqual(ids(feed2), ['1']);
  assert.equal(feed2.getSnapshot().hasMore, true);
  assert.equal(feed2.getSnapshot().loadingMore, false);
});

test('a late failure after cancel does not set an error', async () => {
  const pending = deferred();
  const feed = createPublicationFeed(() => pending.promise);
  const loading = feed.refresh();
  feed.cancel();
  pending.reject(new Error('late'));
  await loading;
  assert.equal(feed.getSnapshot().error, null);
});

test('after cancel the feed can load again and stale answers still cannot overwrite it', async () => {
  const stale = deferred();
  let call = 0;
  const feed = createPublicationFeed(() => (++call === 1 ? stale.promise : Promise.resolve(page([7], null))));
  const first = feed.ensureLoaded();
  feed.cancel();
  await feed.ensureLoaded(); // user came back to the screen
  assert.deepEqual(ids(feed), ['7']);
  stale.resolve(page([1], null));
  await first;
  assert.deepEqual(ids(feed), ['7']);
});

test('ensureLoaded does nothing once loaded, so returning to the screen keeps the list', async () => {
  let calls = 0;
  const feed = createPublicationFeed(async () => { calls++; return page([1], null); });
  await feed.ensureLoaded();
  await feed.ensureLoaded();
  assert.equal(calls, 1);
});

test('a refresh supersedes a pending next page', async () => {
  const more = deferred();
  const feed = createPublicationFeed(async (cursor) => {
    if (cursor === null) return page([1], 'c');
    return more.promise;
  });
  await feed.refresh();
  const pendingMore = feed.loadMore();
  await feed.refresh();
  more.resolve(page([2], null));
  await pendingMore;
  assert.deepEqual(ids(feed), ['1']);
  assert.equal(feed.getSnapshot().hasMore, true);
});

test('subscribers are notified and can unsubscribe', async () => {
  const feed = createPublicationFeed(async () => page([1], null));
  let notifications = 0;
  const unsubscribe = feed.subscribe(() => { notifications++; });
  await feed.refresh();
  assert.ok(notifications > 0);
  const seen = notifications;
  unsubscribe();
  await feed.refresh();
  assert.equal(notifications, seen);
});

test('source link opens only the exact PubMed page of the same PMID', () => {
  assert.equal(pubmedLink(pub(123)), 'https://pubmed.ncbi.nlm.nih.gov/123/');
  const bad = (url) => pubmedLink({ pmid: '123', source_url: url });
  assert.equal(bad('https://pubmed.ncbi.nlm.nih.gov/124/'), null);
  assert.equal(bad('http://pubmed.ncbi.nlm.nih.gov/123/'), null);
  assert.equal(bad('https://evil.example/https://pubmed.ncbi.nlm.nih.gov/123/'), null);
  assert.equal(bad('https://pubmed.ncbi.nlm.nih.gov.evil.example/123/'), null);
  assert.equal(bad('https://pubmed.ncbi.nlm.nih.gov/123/?x=1'), null);
  assert.equal(bad('javascript:alert(1)'), null);
  assert.equal(bad(''), null);
});
