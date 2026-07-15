import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadSeedData } from '../src/seed-source.js';

test('bundled seed keeps a standalone clone runnable without workspace memory', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordflow-seed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const seedPath = path.join(dir, 'learning-seed.json');
  const fixture = {
    generatedAt: '2026-07-15T00:00:00.000Z',
    items: [{ seedKey: 'item:test', term: 'test', meaning: '测试', status: 'S0' }],
    tracks: []
  };
  fs.writeFileSync(seedPath, JSON.stringify(fixture));

  const result = loadSeedData({ memoryRoot: path.join(dir, 'missing'), seedPath });
  assert.equal(result.source, 'bundled-seed');
  assert.deepEqual(result.data, fixture);
});

test('bundled curriculum contains only formal items with Chinese meanings', () => {
  const seedPath = path.resolve('seed/learning-seed.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  assert.equal(seed.items.filter((item) => !item.meaning.trim()).length, 0);
  assert.equal(seed.items.filter((item) => !/^S[0-3]$/.test(item.status)).length, 0);
});
