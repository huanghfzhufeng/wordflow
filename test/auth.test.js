import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createApp } from '../src/app.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function repositoryStub() {
  return {
    progress: () => ({ totalReviews: 1, counts: { S1: 1 } }),
    todayQueue: () => [],
    listItems: () => ({ items: [], total: 0 })
  };
}

async function startServer(t) {
  const app = createApp({
    config: {
      rootDir,
      trustProxy: false,
      authEnabled: true,
      authUsername: 'zeke',
      authPassword: 'correct-password',
      sessionSecret: 'test-secret-that-is-long-enough',
      sessionTtlDays: 90,
      cookieSecure: false,
      cookiePath: '/wordflow'
    },
    db: null,
    repository: repositoryStub()
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('persistent app session replaces repeated proxy authentication', async (t) => {
  const baseUrl = await startServer(t);

  const anonymous = await fetch(`${baseUrl}/api/progress`);
  assert.equal(anonymous.status, 401);

  const malformed = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: 'wordflow_session=%E0%A4%A' }
  });
  assert.deepEqual(await malformed.json(), { authEnabled: true, authenticated: false });

  const rejected = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'zeke', password: 'wrong' })
  });
  assert.equal(rejected.status, 401);

  const accepted = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'zeke', password: 'correct-password' })
  });
  assert.equal(accepted.status, 200);
  const setCookie = accepted.headers.get('set-cookie');
  assert.match(setCookie, /wordflow_session=/);
  assert.match(setCookie, /Max-Age=7776000/);
  assert.match(setCookie, /Path=\/wordflow/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);

  const cookie = setCookie.split(';', 1)[0];
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(session.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await session.json(), { authEnabled: true, authenticated: true });

  const authorized = await fetch(`${baseUrl}/api/progress`, { headers: { Cookie: cookie } });
  assert.equal(authorized.status, 200);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});
