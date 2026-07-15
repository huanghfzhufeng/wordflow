import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRepository, openDatabase, syncSeedData } from '../src/db.js';

function fixtureSeed() {
  return {
    items: [
      {
        seedKey: 'fixture:erase',
        term: 'Erase',
        meaning: '抹掉',
        kind: 'word',
        module: 'iphone-p1',
        source: 'test',
        status: 'S0',
        priority: 100,
        lastReviewedAt: null
      }
    ],
    tracks: [
      { code: 'E0', label: 'iPhone 英文环境', current: 0, target: 4 },
      { code: 'F0', label: '基础解析', current: 3, target: 4 }
    ]
  };
}

test('repository persists additions and applies delayed evidence transitions', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordflow-test-'));
  const db = openDatabase(path.join(dir, 'test.db'));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  syncSeedData(db, fixtureSeed());
  const repository = createRepository(db, { timeZone: 'Asia/Singapore' });

  assert.equal(repository.todayQueue(10)[0].term, 'Erase');
  const added = repository.createItem({
    term: 'Try Again',
    meaning: '重试',
    phonetic: '/traɪ əˈɡen/',
    kind: 'phrase',
    module: 'iphone-p1'
  });
  assert.equal(added.status, 'S0');
  assert.equal(added.phonetic, '/traɪ əˈɡen/');
  assert.throws(() => repository.createItem({
    term: 'invalid',
    meaning: '无效',
    phonetic: 'x'.repeat(121)
  }), /音标过长/);

  const first = repository.reviewItem(added.id, 'good', new Date('2026-07-14T01:00:00.000Z'));
  assert.equal(first.item.status, 'S1');
  const sameDay = repository.reviewItem(added.id, 'good', new Date('2026-07-14T10:00:00.000Z'));
  assert.equal(sameDay.item.status, 'S1');
  const delayed = repository.reviewItem(added.id, 'good', new Date('2026-07-15T01:00:00.000Z'));
  assert.equal(delayed.item.status, 'S2');
  assert.equal(delayed.item.reviewCount, 3);
});
