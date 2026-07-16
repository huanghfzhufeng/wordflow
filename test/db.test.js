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
    module: 'iphone-p1',
    components: [
      { text: 'try', meaning: '尝试', role: 'word' },
      { text: 'again', meaning: '再次', role: 'word' }
    ]
  });
  assert.equal(added.status, 'S0');
  assert.equal(added.phonetic, '/traɪ əˈɡen/');
  assert.equal(added.components.length, 2);
  assert.throws(() => repository.createItem({
    term: 'invalid',
    meaning: '无效',
    phonetic: 'x'.repeat(121)
  }), /音标过长/);
  assert.throws(() => repository.createItem({
    term: 'invalid parts',
    meaning: '无效拆解',
    components: [{ text: 'invalid', meaning: '', role: 'root' }]
  }), /片段中文义不能为空/);

  const first = repository.reviewItem(
    added.id,
    'good',
    new Date('2026-07-14T01:00:00.000Z'),
    { result: 'correct', durationMs: 4200 }
  );
  assert.equal(first.item.status, 'S1');
  const sameDay = repository.reviewItem(added.id, 'good', new Date('2026-07-14T10:00:00.000Z'));
  assert.equal(sameDay.item.status, 'S1');
  const delayed = repository.reviewItem(added.id, 'good', new Date('2026-07-15T01:00:00.000Z'));
  assert.equal(delayed.item.status, 'S2');
  assert.equal(delayed.item.reviewCount, 3);
  assert.equal(repository.progress().totalReviews, 3);
  assert.deepEqual(repository.progress().writing, { attempted: 1, correct: 1, incorrect: 0 });
  const writingEvent = repository.exportData().reviewEvents.find((event) => event.writing_result);
  assert.equal(writingEvent.writing_result, 'correct');
  assert.equal(writingEvent.writing_duration_ms, 4200);
  assert.throws(() => repository.reviewItem(
    added.id,
    'good',
    new Date('2026-07-16T01:00:00.000Z'),
    { result: 'guessed', durationMs: 100 }
  ), /书写结果无效/);
});

test('seed sync promotes legacy pending rows into formal S0 content', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordflow-migration-'));
  const db = openDatabase(path.join(dir, 'test.db'));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO learning_items (seed_key, term, meaning, status, created_at, updated_at)
    VALUES ('fixture:formal', 'formal', '', 'candidate', ?, ?)
  `).run(now, now);

  const result = syncSeedData(db, {
    items: [{
      seedKey: 'fixture:formal', term: 'formal', meaning: '正式的', kind: 'word',
      module: 'foundation', source: 'test', status: 'S0', priority: 25,
      components: [
        { text: 'form', meaning: '形式', role: 'root' },
        { text: '-al', meaning: '构成形容词', role: 'suffix' }
      ]
    }],
    tracks: []
  });
  const item = createRepository(db, { timeZone: 'Asia/Singapore' }).listItems({}).items[0];
  assert.equal(result.migrated, 1);
  assert.equal(item.status, 'S0');
  assert.equal(item.meaning, '正式的');
  assert.equal(item.components.length, 2);
  assert.ok(item.nextReviewAt);
});
