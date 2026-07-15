import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const authUsername = process.env.WORDFLOW_USERNAME || '';
const authPassword = process.env.WORDFLOW_PASSWORD || '';
const sessionSecret = process.env.SESSION_SECRET || '';

export const config = {
  rootDir,
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 4317),
  dbPath: path.resolve(rootDir, process.env.DB_PATH || 'data/wordflow.db'),
  seedPath: path.resolve(rootDir, process.env.SEED_PATH || 'seed/learning-seed.json'),
  memoryRoot: path.resolve(rootDir, process.env.MEMORY_ROOT || '../全局记忆/notes'),
  timeZone: process.env.LEARNING_TIME_ZONE || 'Asia/Singapore',
  trustProxy: bool(process.env.TRUST_PROXY),
  authEnabled: Boolean(authUsername && authPassword && sessionSecret),
  authUsername,
  authPassword,
  sessionSecret,
  sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 90),
  cookieSecure: bool(process.env.COOKIE_SECURE),
  cookiePath: process.env.COOKIE_PATH || '/'
};
