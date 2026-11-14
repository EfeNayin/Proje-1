/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || root] }));
const code = ts.transpileModule(readFileSync(path.join(root, 'src/diagnosis/loader.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Error });
const { createDiagnosisLoader } = loaded.exports;
const result = (weeks, label = 'data') => ({ period_weeks: weeks, label, findings: [], has_enough_data: true });

function setup() {
  const pending = [];
  const states = [];
  const loader = createDiagnosisLoader((weeks) => new Promise((resolve, reject) => {
    pending.push({ weeks, resolve, reject });
  }), state => states.push(state));
  return { loader, pending, states };
}

test('a late four-week response cannot overwrite the latest twelve-week response', async () => {
  const { loader, pending, states } = setup();
  const first = loader.load(4);
  const last = loader.load(12);
  pending[1].resolve(result(12)); await last;
  const updates = states.length;
  pending[0].resolve(result(4)); await first;
  assert.equal(loader.getSnapshot().result.period_weeks, 12);
  assert.equal(states.length, updates);
});

test('an old failure cannot hide the newer loading indicator or show an error', async () => {
  const { loader, pending } = setup();
  const first = loader.load(4);
  const last = loader.load(8);
  pending[0].reject(new Error('old failure')); await first;
  assert.equal(loader.getSnapshot().loading, true);
  assert.equal(loader.getSnapshot().error, null);
  pending[1].resolve(result(8)); await last;
  assert.equal(loader.getSnapshot().loading, false);
});

test('four to eight to four accepts only the newest four-week request', async () => {
  const { loader, pending } = setup();
  const a = loader.load(4); const b = loader.load(8); const c = loader.load(4);
  pending[2].resolve(result(4, 'new')); await c;
  pending[0].resolve(result(4, 'old')); pending[1].resolve(result(8));
  await Promise.all([a, b]);
  assert.equal(loader.getSnapshot().result.label, 'new');
});

test('refresh failure keeps the previous result and a successful retry clears the error', async () => {
  const { loader, pending } = setup();
  const first = loader.load(4); pending[0].resolve(result(4, 'old')); await first;
  const refresh = loader.load(4, true);
  assert.equal(loader.getSnapshot().refreshing, true);
  assert.equal(loader.getSnapshot().loading, false);
  pending[1].reject(new Error('offline')); await refresh;
  assert.equal(loader.getSnapshot().result.label, 'old');
  assert.equal(loader.getSnapshot().error, 'offline');
  assert.equal(loader.getSnapshot().refreshing, false);
  const retry = loader.load(4, true); pending[2].resolve(result(4, 'new')); await retry;
  assert.equal(loader.getSnapshot().result.label, 'new');
  assert.equal(loader.getSnapshot().error, null);
});

test('changing period clears old results and ignores an outstanding refresh', async () => {
  const { loader, pending } = setup();
  const first = loader.load(4); pending[0].resolve(result(4)); await first;
  const refresh = loader.load(4, true);
  loader.invalidate();
  const next = loader.load(8);
  assert.equal(loader.getSnapshot().result, null);
  pending[1].reject(new Error('old refresh')); await refresh;
  assert.equal(loader.getSnapshot().error, null);
  assert.equal(loader.getSnapshot().loading, true);
  pending[2].resolve(result(8)); await next;
});

for (const reject of [false, true]) {
  test(`blur ignores late ${reject ? 'failure' : 'success'} and refocus can load again`, async () => {
    const { loader, pending, states } = setup();
    const first = loader.load(4); loader.invalidate();
    const updates = states.length;
    if (reject) pending[0].reject(new Error('late'));
    else pending[0].resolve(result(4));
    await first;
    assert.equal(states.length, updates);
    const next = loader.load(4); pending[1].resolve(result(4, 'refocused')); await next;
    assert.equal(loader.getSnapshot().result.label, 'refocused');
  });
}

test('refresh during initial load becomes the owner of the result and indicators', async () => {
  const { loader, pending } = setup();
  const first = loader.load(4); const refresh = loader.load(4, true);
  pending[0].resolve(result(4, 'old')); await first;
  assert.equal(loader.getSnapshot().loading, true);
  pending[1].resolve(result(4, 'refreshed')); await refresh;
  assert.equal(loader.getSnapshot().result.label, 'refreshed');
  assert.equal(loader.getSnapshot().loading, false);
  assert.equal(loader.getSnapshot().refreshing, false);
});

test('a response with the wrong period is shown as a retryable error', async () => {
  const { loader, pending } = setup();
  const request = loader.load(4); pending[0].resolve(result(12)); await request;
  assert.equal(loader.getSnapshot().result, null);
  assert.equal(loader.getSnapshot().loading, false);
  assert.match(loader.getSnapshot().error, /different period/);
});
