import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRepository, openDatabase, syncSeedData } from '../src/db.js';
import { mergeRedditCore } from '../src/reddit-core.js';

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

test('Reddit core import keeps existing review history and follows numbered learning order', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordflow-core-'));
  const db = openDatabase(path.join(dir, 'test.db'));
  t.after(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const legacy = { items: [{
    seedKey: 'item:the', term: 'the', meaning: '旧义', kind: 'word', module: 'foundation',
    source: 'test', status: 'S0', priority: 25
  }], tracks: [] };
  syncSeedData(db, legacy);
  const repository = createRepository(db, { timeZone: 'Asia/Singapore' });
  const original = repository.listItems({ q: 'the' }).items.find((item) => item.term === 'the');
  repository.reviewItem(original.id, 'good', new Date());
  const seed = mergeRedditCore(legacy);
  syncSeedData(db, seed);
  syncSeedData(db, seed);
  const item = repository.getItem(original.id);
  assert.equal(item.status, 'S1');
  assert.equal(item.reviewCount, 1);
  assert.equal(item.orderIndex, 1);
  assert.equal(item.meaning, '这/那个；定冠词');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_items WHERE module = 'reddit-core'").get().n, 3000);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM learning_items WHERE module = 'reddit-forms'").get().n, 54);
  assert.equal(repository.listItems({ module: 'reddit-core', limit: 1 }).total, 3000);
  assert.equal(repository.progress().coreCounts.S1, 1);
  assert.equal(repository.todayQueue(3)[0].term, 'be');
});

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
  const tryWord = repository.createItem({ term: 'try', meaning: '尝试' });
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
  assert.equal(added.components[0].linkedItem.id, tryWord.id);
  assert.equal(added.components[1].linkedItem, null);
  const addedAgain = repository.addComponentAsItem(added.id, 1);
  assert.equal(addedAgain.created, true);
  assert.equal(addedAgain.item.term, 'again');
  assert.equal(repository.getItem(added.id).components[1].linkedItem.id, addedAgain.item.id);
  assert.equal(repository.addComponentAsItem(added.id, 1).created, false);
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
  assert.throws(() => repository.createItem({
    term: 'invalid role',
    meaning: '无效类型',
    components: [{ text: 'invalid', meaning: '无效', role: 'guess' }]
  }), /片段类型无效/);

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

  const adaptive = repository.createItem({ term: 'recall', meaning: '回忆' });
  repository.reviewItem(
    adaptive.id,
    'hard',
    new Date('2026-07-15T02:00:00.000Z'),
    { result: 'incorrect', durationMs: 1800 }
  );
  repository.reviewItem(
    adaptive.id,
    'good',
    new Date('2026-07-16T02:00:00.000Z'),
    { result: 'correct', durationMs: 2100 }
  );
  repository.reviewItem(
    adaptive.id,
    'good',
    new Date('2026-07-17T02:00:00.000Z'),
    { result: 'correct', durationMs: 1900 }
  );
  assert.deepEqual(repository.progress().writing, { attempted: 4, correct: 3, incorrect: 1 });
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
