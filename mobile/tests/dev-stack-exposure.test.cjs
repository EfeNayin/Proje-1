/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

// Source-level guard for the development Docker Compose file (repo root). It checks
// what that file asks Docker to publish; the listeners that result were checked by
// hand (see PROJE_1_CODEX_INCELEME.md, Adım 61). It looks only at the backend and
// Redis services, and never at PostgreSQL's ports.
const compose = readFileSync(path.resolve(__dirname, '../../docker-compose.yml'), 'utf8')
  .replace(/\r\n/g, '\n');

function service(name) {
  const match = compose.match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\n)+)`, 'm'));
  assert.ok(match, `service ${name} not found`);
  return match[1];
}

function publishedPorts(block) {
  const list = block.match(/^    ports:\n((?:      - .*\n)+)/m);
  return list ? [...list[1].matchAll(/- "?([^"\n]+)"?/g)].map((m) => m[1].trim()) : [];
}

test('dev compose: the backend is published on loopback only', () => {
  assert.deepEqual(publishedPorts(service('backend')), ['127.0.0.1:8000:8000']);
});

test('dev compose: Redis is not published on the host at all', () => {
  // The backend reaches it as redis:6379 on the compose network; it has no password.
  assert.deepEqual(publishedPorts(service('redis')), []);
});

test('dev compose: the backend still gets its settings from backend/.env and keeps its volume mount', () => {
  const backend = service('backend');
  assert.match(backend, /env_file:\n\s+- \.\/backend\/\.env/);
  assert.match(backend, /- \.\/backend:\/app/);
  assert.doesNotMatch(compose, /JWT_SECRET/, 'no signing key may be written into the compose file');
});
