#!/usr/bin/env node
import fs from 'node:fs';

const envPath = process.env.WORDFLOW_ENV_PATH || '/opt/wordflow/.env';
const baseUrl = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:4317';

function readEnv(filePath) {
  return Object.fromEntries(fs.readFileSync(filePath, 'utf8').split(/\r?\n/).map((line) => {
    const at = line.indexOf('=');
    if (!line || line.startsWith('#') || at < 0) return null;
    return [line.slice(0, at), line.slice(at + 1)];
  }).filter(Boolean));
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const env = readEnv(envPath);
if (!env.WORDFLOW_USERNAME || !env.WORDFLOW_PASSWORD) throw new Error('Wordflow credentials are missing');

const anonymousSession = await request('/api/auth/session');
if (anonymousSession.response.status !== 200
  || anonymousSession.body.authEnabled !== true
  || anonymousSession.body.authenticated !== false) {
  throw new Error('Anonymous session contract failed');
}

const anonymousProgress = await request('/api/progress');
if (anonymousProgress.response.status !== 401) throw new Error('Protected API did not return 401');

const login = await request('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: env.WORDFLOW_USERNAME, password: env.WORDFLOW_PASSWORD })
});
const setCookie = login.response.headers.get('set-cookie') || '';
if (login.response.status !== 200
  || !setCookie.includes('Max-Age=7776000')
  || !setCookie.includes('Path=/wordflow')
  || !setCookie.includes('HttpOnly')) {
  throw new Error('Persistent login cookie contract failed');
}

const cookie = setCookie.split(';', 1)[0];
const progress = await request('/api/progress', { headers: { Cookie: cookie } });
if (progress.response.status !== 200 || !progress.body.counts) throw new Error('Authenticated API contract failed');

const logout = await request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
if (logout.response.status !== 200 || !String(logout.response.headers.get('set-cookie')).includes('Max-Age=0')) {
  throw new Error('Logout contract failed');
}

console.log(JSON.stringify({
  session: anonymousSession.response.status,
  protectedApi: anonymousProgress.response.status,
  login: login.response.status,
  authenticatedApi: progress.response.status,
  logout: logout.response.status,
  totalReviews: progress.body.totalReviews,
  remembered: (progress.body.counts.S2 || 0) + (progress.body.counts.S3 || 0)
}));
