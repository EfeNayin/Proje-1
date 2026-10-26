/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

// Source-level guards for the Maestro smoke-test tooling in e2e/. The flow itself
// needs a simulator; these keep its safety properties from eroding unnoticed.

const flow = () => read('e2e/flows/smoke-workout.yaml');
const scripts = () => readdirSync(path.join(root, 'e2e/scripts')).filter((f) => f.endsWith('.sh'));

test('e2e flow: credentials come from the environment, never from the file', () => {
  const source = flow();
  assert.match(source, /inputText: \$\{E2E_EMAIL\}/);
  assert.match(source, /inputText: \$\{E2E_PASSWORD\}/);
  assert.doesNotMatch(source, /@example\.com|Aa1-|password:\s*\S/i);
});

test('e2e flow: real controls only - no coordinates, sleeps or deep-link navigation into the app', () => {
  const source = flow();
  assert.doesNotMatch(source, /point:|\bsleep\b|repeat:|swipe:/);
  // The only link opened is the Metro URL that loads the app into Expo Go.
  const links = source.match(/openLink:.*/g) ?? [];
  assert.deepEqual(links, ['openLink: ${METRO_URL}']);
});

test('e2e flow: covers the athlete journey with RIR left blank and a duplicate-save guard', () => {
  const source = flow();
  for (const step of ['"Sign in"', '"Start workout"', '"Add exercise"', '"Finish workout"', '"Barbell Bench Press.*"']) {
    assert.ok(source.includes(step), step);
  }
  assert.doesNotMatch(source, /Recorded RIR/);
  assert.match(source, /assertVisible: "1 working sets"/);
  assert.match(source, /assertVisible: "80 kg"/);
});

test('e2e scripts: only the dedicated database and compose project are ever addressed', () => {
  for (const file of scripts()) {
    const source = read(`e2e/scripts/${file}`);
    assert.doesNotMatch(source, /bodytrack_test|proje-1|\bsudo\b|git (add|checkout|reset|clean)/, file);
  }
  const lib = read('e2e/scripts/lib.sh');
  assert.match(lib, /PROJECT="bodytrack-e2e"/);
  assert.match(lib, /DB_NAME="bodytrack_e2e"/);
  assert.match(lib, /verify_identity\(\)/);
  // Cleanup refuses to run before the stack's identity has been proven.
  const down = read('e2e/scripts/down.sh');
  assert.ok(down.indexOf('verify_identity') < down.indexOf('compose down'));
  assert.ok(down.indexOf('verify_identity') < down.indexOf('rm -rf'));
});

test('e2e stack: no host database port, secrets injected per run, no env_file fallback', () => {
  const compose = read('e2e/docker-compose.e2e.yml');
  assert.match(compose, /^name: bodytrack-e2e$/m);
  assert.match(compose, /JWT_SECRET_KEY: \$\{E2E_JWT_SECRET:\?/);
  assert.doesNotMatch(compose, /env_file/);
  const ports = compose.match(/^\s+ports:\n(\s+- .*\n)+/gm) ?? [];
  assert.equal(ports.length, 1, 'only the backend publishes a port');
  assert.match(ports[0], /127\.0\.0\.1:/);
});

test('e2e run: the API endpoint is process-scoped, the committed env files are untouched', () => {
  const up = read('e2e/scripts/up.sh');
  assert.match(up, /EXPO_PUBLIC_API_URL="http:\/\/127\.0\.0\.1:\$API_PORT"/);
  for (const file of scripts()) {
    // The per-run env files live under the run directory, outside the repository.
    const source = read(`e2e/scripts/${file}`).replace(/\$RUN_DIR\/[\w$-]*\.env/g, '');
    assert.doesNotMatch(source, />\s*\S*\.env\b/, file);
  }
});
