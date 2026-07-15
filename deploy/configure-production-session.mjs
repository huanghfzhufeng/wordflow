#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

const ledgerPath = process.env.LEDGER_ENV_PATH || '/opt/zhulaicai-ledger/.env';
const wordflowPath = process.env.WORDFLOW_ENV_PATH || '/opt/wordflow/.env';

function readEnv(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const values = {};
  for (const line of lines) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    values[line.slice(0, at)] = line.slice(at + 1);
  }
  return { lines, values };
}

function upsert(env, key, value) {
  const index = env.lines.findIndex((line) => line.startsWith(`${key}=`));
  const next = `${key}=${value}`;
  if (index >= 0) env.lines[index] = next;
  else env.lines.push(next);
  env.values[key] = value;
}

const ledger = readEnv(ledgerPath);
const wordflow = readEnv(wordflowPath);
if (!ledger.values.LEDGER_USERNAME || !ledger.values.LEDGER_PASSWORD) {
  throw new Error('Ledger owner credentials are not configured');
}

upsert(wordflow, 'TRUST_PROXY', 'true');
upsert(wordflow, 'COOKIE_SECURE', 'false');
upsert(wordflow, 'COOKIE_PATH', '/wordflow');
upsert(wordflow, 'SESSION_TTL_DAYS', '90');
upsert(wordflow, 'WORDFLOW_USERNAME', ledger.values.LEDGER_USERNAME);
upsert(wordflow, 'WORDFLOW_PASSWORD', ledger.values.LEDGER_PASSWORD);
upsert(wordflow, 'SESSION_SECRET', wordflow.values.SESSION_SECRET || randomBytes(48).toString('base64url'));

while (wordflow.lines.at(-1) === '') wordflow.lines.pop();
fs.writeFileSync(wordflowPath, `${wordflow.lines.join('\n')}\n`, { mode: 0o600 });
console.log('Wordflow persistent session configured');
