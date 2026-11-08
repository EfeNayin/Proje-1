// Run with node --test tests/apple-revocation.test.cjs.
//
// Regression: in My Expo Go, expo-apple-authentication's addRevokeListener() gave back
// nothing usable, and the cleanup function AuthContext returns from its effect then threw
// "Cannot read property 'remove' of undefined" when React ran it (sign-out, unmount). The
// original try/catch only covered the registration. These tests run the real module with
// the native call replaced by doubles.
/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createWorld } = require('./support/session-world.cjs');

const root = path.resolve(__dirname, '..');
const { subscribeToRevocation } = createWorld().load('social/revocation');

test('a native call that returns undefined gives a cleanup that does nothing and does not throw', () => {
  let registered = 0;
  const cleanup = subscribeToRevocation(() => { registered += 1; return undefined; }, () => undefined);
  assert.equal(registered, 1);
  assert.doesNotThrow(() => cleanup());
  assert.doesNotThrow(() => cleanup());
});

test('null, an object without remove(), and a non-function remove are all safe too', () => {
  for (const value of [null, {}, { remove: 'nope' }, 42]) {
    const cleanup = subscribeToRevocation(() => value, () => undefined);
    assert.doesNotThrow(() => cleanup(), String(value));
  }
});

test('a registration that throws gives a no-op cleanup', () => {
  const cleanup = subscribeToRevocation(() => { throw new Error('native module missing'); }, () => undefined);
  assert.doesNotThrow(() => cleanup());
});

test('a valid subscription keeps the revocation callback and is removed on cleanup', () => {
  let listener = null;
  let removals = 0;
  const subscription = { remove() { removals += 1; } };
  let revoked = 0;
  const cleanup = subscribeToRevocation((l) => { listener = l; return subscription; }, () => { revoked += 1; });

  assert.equal(typeof listener, 'function');
  listener(); // Apple reports a revocation
  assert.equal(revoked, 1);
  assert.equal(removals, 0); // still listening until the owner cleans up

  cleanup();
  assert.equal(removals, 1);
});

test('the cleanup removes the listener once, however many times React runs it', () => {
  let removals = 0;
  const cleanup = subscribeToRevocation(() => ({ remove() { removals += 1; } }), () => undefined);
  cleanup();
  cleanup();
  cleanup();
  assert.equal(removals, 1);
});

test('remove() is called as a method, so a native subscription keeps its this', () => {
  const seen = [];
  const subscription = { id: 7, remove() { seen.push(this.id); } };
  subscribeToRevocation(() => subscription, () => undefined)();
  assert.deepEqual(seen, [7]);
});

test('a remove() that throws does not take the render down', () => {
  const cleanup = subscribeToRevocation(() => ({ remove() { throw new Error('already gone'); } }), () => undefined);
  assert.doesNotThrow(() => cleanup());
});

test('the native wrapper goes through the guarded helper and never calls remove() itself', () => {
  const source = readFileSync(path.join(root, 'src/social/nativeProviders.ts'), 'utf8');
  assert.match(source, /subscribeToRevocation\(/);
  assert.doesNotMatch(source, /\.remove\(\)/);
});
