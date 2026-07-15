import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'wordflow_session';
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

function safeEqual(actual, expected) {
  const actualHash = createHash('sha256').update(String(actual ?? '')).digest();
  const expectedHash = createHash('sha256').update(String(expected ?? '')).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const at = part.indexOf('=');
    if (at < 0) return [part.trim(), ''];
    const encoded = part.slice(at + 1).trim();
    try {
      return [part.slice(0, at).trim(), decodeURIComponent(encoded)];
    } catch {
      return [part.slice(0, at).trim(), encoded];
    }
  }).filter(([name]) => name));
}

function normalizedCookiePath(value) {
  if (!value || value === '/') return '/';
  return `/${String(value).replace(/^\/+|\/+$/g, '')}`;
}

export function createAuth(config, { now = () => Date.now() } = {}) {
  const enabled = Boolean(config.authEnabled);
  const cookiePath = normalizedCookiePath(config.cookiePath);
  const ttlMs = Math.max(1, Number(config.sessionTtlDays || 90)) * 24 * 60 * 60 * 1000;
  const failures = new Map();

  function sign(payload) {
    return createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
  }

  function createToken() {
    const payload = Buffer.from(JSON.stringify({
      sub: config.authUsername,
      exp: now() + ttlMs
    })).toString('base64url');
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token) {
    if (!enabled || !token) return false;
    const [payload, signature, extra] = String(token).split('.');
    if (!payload || !signature || extra || !safeEqual(signature, sign(payload))) return false;
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return value.sub === config.authUsername && Number(value.exp) > now();
    } catch {
      return false;
    }
  }

  function cookie(value, { clear = false } = {}) {
    const parts = [
      `${COOKIE_NAME}=${encodeURIComponent(value)}`,
      `Path=${cookiePath}`,
      'HttpOnly',
      'SameSite=Lax'
    ];
    if (clear) {
      parts.push('Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    } else {
      parts.push(`Max-Age=${Math.floor(ttlMs / 1000)}`, `Expires=${new Date(now() + ttlMs).toUTCString()}`);
    }
    if (config.cookieSecure) parts.push('Secure');
    return parts.join('; ');
  }

  function isAuthenticated(req) {
    if (!enabled) return true;
    return verifyToken(parseCookies(req.headers.cookie)[COOKIE_NAME]);
  }

  function requireAuth(req, res, next) {
    if (isAuthenticated(req)) return next();
    return res.status(401).json({ error: '请先登录' });
  }

  function session(req, res) {
    res.json({ authEnabled: enabled, authenticated: isAuthenticated(req) });
  }

  function login(req, res) {
    if (!enabled) return res.json({ authenticated: true, authEnabled: false });
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const current = failures.get(key);
    if (current && current.resetAt > now() && current.count >= MAX_FAILURES) {
      res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now()) / 1000)));
      return res.status(429).json({ error: '尝试次数过多，请稍后再试' });
    }

    const valid = safeEqual(req.body?.username, config.authUsername)
      && safeEqual(req.body?.password, config.authPassword);
    if (!valid) {
      if (failures.size > 1000) {
        for (const [address, failure] of failures) {
          if (failure.resetAt <= now()) failures.delete(address);
        }
      }
      const active = current && current.resetAt > now() ? current : { count: 0, resetAt: now() + FAILURE_WINDOW_MS };
      failures.set(key, { ...active, count: active.count + 1 });
      return res.status(401).json({ error: '账号或密码不正确' });
    }

    failures.delete(key);
    res.setHeader('Set-Cookie', cookie(createToken()));
    return res.json({ authenticated: true, authEnabled: true });
  }

  function logout(_req, res) {
    res.setHeader('Set-Cookie', cookie('', { clear: true }));
    res.json({ authenticated: false, authEnabled: enabled });
  }

  return {
    enabled,
    createToken,
    verifyToken,
    isAuthenticated,
    requireAuth,
    session,
    login,
    logout
  };
}
