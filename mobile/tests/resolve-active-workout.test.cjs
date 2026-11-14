/* global __dirname */
// Unit tests for src/workout/resolveActiveWorkout.ts — the reconciliation
// between the device-local "active workout" pointer and the server's record
// for whoever is CURRENTLY signed in. Added for Adım 20
// (PROJE_1_CODEX_INCELEME.md, Bölüm 8 madde H3): the pointer is a device
// key, not an account key, so a stale one left by a workout finished
// elsewhere, deleted, or belonging to a PREVIOUS account signed in on this
// same device, must not be taken at face value.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', { paths: [process.env.BODYTRACK_DEPENDENCIES || root] }));
const code = ts.transpileModule(
  readFileSync(path.join(root, 'src/workout/resolveActiveWorkout.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
vm.runInNewContext(code, { module: loaded, exports: loaded.exports });
const { resolveActiveWorkoutId } = loaded.exports;

/** A fake ownership-scoped API: `owner` is who is "signed in" for this
 * fixture, and workouts are keyed by id with their own owner. Fetching a
 * workout you don't own throws, exactly like the real 404. */
function fixture({ owner, workouts, serverActive = null }) {
  const state = { stored: null, setCalls: 0, clearCalls: 0 };
  const deps = {
    getActiveWorkout: async () => state.stored,
    setActiveWorkout: async (id) => {
      state.setCalls += 1;
      state.stored = id;
    },
    clearActiveWorkout: async () => {
      state.clearCalls += 1;
      state.stored = null;
    },
    getWorkout: async (id) => {
      const workout = workouts[id];
      if (!workout || workout.owner !== owner) throw new Error('not found');
      return { id: workout.id, finished_at: workout.finished_at };
    },
    getServerActiveWorkout: async () => {
      if (!serverActive || serverActive.owner !== owner) return null;
      return { id: serverActive.id, finished_at: serverActive.finished_at };
    },
  };
  return { deps, state };
}

test('no local pointer, nothing active on the server: resolves to null', async () => {
  const { deps, state } = fixture({ owner: 'alice', workouts: {} });

  const result = await resolveActiveWorkoutId(deps);

  assert.equal(result, null);
  assert.equal(state.setCalls, 0);
  assert.equal(state.clearCalls, 0);
});

test('no local pointer, server has one for this account: adopts and stores it', async () => {
  const { deps, state } = fixture({
    owner: 'alice',
    workouts: {},
    serverActive: { id: 'w1', owner: 'alice', finished_at: null },
  });

  const result = await resolveActiveWorkoutId(deps);

  assert.equal(result, 'w1');
  assert.equal(state.stored, 'w1');
  assert.equal(state.setCalls, 1);
});

test('a valid, unfinished local pointer is kept as-is', async () => {
  const { deps, state } = fixture({
    owner: 'alice',
    workouts: { w1: { id: 'w1', owner: 'alice', finished_at: null } },
  });
  state.stored = 'w1';

  const result = await resolveActiveWorkoutId(deps);

  assert.equal(result, 'w1');
  assert.equal(state.clearCalls, 0);
  assert.equal(state.setCalls, 0);
});

test('a local pointer to a now-finished workout is cleared and resolves to null', async () => {
  const { deps, state } = fixture({
    owner: 'alice',
    workouts: { w1: { id: 'w1', owner: 'alice', finished_at: '2026-09-13T00:00:00Z' } },
  });
  state.stored = 'w1';

  const result = await resolveActiveWorkoutId(deps);

  assert.equal(result, null);
  assert.equal(state.clearCalls, 1);
});

test(
  'a pointer left by a DIFFERENT account on this device is cleared, and the ' +
    "CURRENT account's own server-side active workout is picked up instead",
  async () => {
    // bob signed out of this device without finishing his workout w1; alice
    // signed in next, and has her own w2 in progress (started elsewhere).
    const { deps, state } = fixture({
      owner: 'alice',
      workouts: {
        w1: { id: 'w1', owner: 'bob', finished_at: null },
        w2: { id: 'w2', owner: 'alice', finished_at: null },
      },
      serverActive: { id: 'w2', owner: 'alice', finished_at: null },
    });
    state.stored = 'w1'; // bob's stale device pointer

    const result = await resolveActiveWorkoutId(deps);

    assert.equal(result, 'w2', "must resolve to alice's own active workout, not bob's");
    assert.equal(state.stored, 'w2');
    assert.equal(state.clearCalls, 1, "bob's dead pointer must be cleared");
    assert.equal(state.setCalls, 1, "alice's own pointer must be adopted");
  },
);

test('a pointer left by a different account, and the current account has nothing active: resolves to null', async () => {
  const { deps, state } = fixture({
    owner: 'alice',
    workouts: { w1: { id: 'w1', owner: 'bob', finished_at: null } },
    serverActive: null,
  });
  state.stored = 'w1';

  const result = await resolveActiveWorkoutId(deps);

  assert.equal(result, null);
  assert.equal(state.clearCalls, 1);
  assert.equal(state.stored, null);
});

test('a pointer to a workout deleted entirely behaves the same as an ownership mismatch', async () => {
  const { deps, state } = fixture({ owner: 'alice', workouts: {} });
  state.stored = 'deleted-workout-id';

  const result = await resolveActiveWorkoutId(deps);

  assert.equal(result, null);
  assert.equal(state.clearCalls, 1);
});

test('a network failure while resolving from the server is swallowed, not thrown', async () => {
  const deps = {
    getActiveWorkout: async () => null,
    setActiveWorkout: async () => {},
    clearActiveWorkout: async () => {},
    getWorkout: async () => {
      throw new Error('unused');
    },
    getServerActiveWorkout: async () => {
      throw new Error('offline');
    },
  };

  const result = await resolveActiveWorkoutId(deps);

  assert.equal(result, null);
});

test('failed local cleanup never reopens a server-confirmed finished session or fails the home screen', async () => {
  const { deps, state } = fixture({ owner: 'alice',
    workouts: { w1: { id: 'w1', owner: 'alice', finished_at: '2026-09-24T12:00:00Z' } } });
  state.stored = 'w1';
  deps.clearActiveWorkout = async () => { throw new Error('Storage unavailable'); };
  assert.equal(await resolveActiveWorkoutId(deps), null);
});

test('failed stale-pointer cleanup still checks the current account on the server', async () => {
  const { deps, state } = fixture({ owner: 'alice', workouts: {},
    serverActive: { id: 'w2', owner: 'alice', finished_at: null } });
  state.stored = 'deleted';
  deps.clearActiveWorkout = async () => { throw new Error('Storage unavailable'); };
  assert.equal(await resolveActiveWorkoutId(deps), 'w2');
});
