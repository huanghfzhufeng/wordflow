import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildSeedData } from '../src/sync-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../全局记忆/notes');

test('workspace learning files merge into one evidence-aware seed', () => {
  const seed = buildSeedData(root);
  assert.ok(seed.items.length >= 400);
  assert.equal(seed.tracks.length, 6);
  assert.equal(seed.items.filter((item) => item.module === 'iphone-p0').length, 12);
  assert.equal(seed.items.filter((item) => item.module === 'iphone-p1').length, 24);

  const general = seed.items.find((item) => item.term === 'General');
  assert.equal(general.meaning, '通用');
  assert.equal(general.status, 'S1');
  assert.equal(general.module, 'iphone-p0');

  const erase = seed.items.find((item) => item.term === 'Erase');
  assert.equal(erase.status, 'S0');
  assert.ok(erase.priority > general.priority);
});
