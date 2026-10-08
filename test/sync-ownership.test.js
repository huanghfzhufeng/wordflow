import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase, createRepository, syncSeedData } from '../src/db.js';
import { mergeRedditCore } from '../src/reddit-core.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordflow-ownership-'));
  const file = path.join(dir, 'test.db');
  let db = openDatabase(file);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return {
    get db() { return db; },
    repo() { return createRepository(db, { timeZone: 'Asia/Singapore' }); },
    reopen() { db.close(); db = openDatabase(file); }
  };
}

test('sync and restart preserve latest failed review and user-edited content', (t) => {
  const f = fixture(t);
  const seed = mergeRedditCore({ items: [], tracks: [] });
  seed.items.find(x => x.term === 'to').status = 'S2';
  syncSeedData(f.db, seed);
  let repo = f.repo();
  const to = repo.listItems({ q: 'to' }).items.find(x => x.term === 'to');
  repo.reviewItem(to.id, 'again');
  repo.updateItem(to.id, {
    meaning: '我修正的释义', example: 'I want to read this post.', source: '实际工作帖文',
    phonetic: '', components: []
  });
  const before = repo.exportData().reviewEvents;
  f.reopen(); repo = f.repo();
  seed.items.find(x => x.term === 'to').note = '后续词库补充';
  syncSeedData(f.db, seed);
  syncSeedData(f.db, seed);
  const item = repo.getItem(to.id);
  assert.equal(item.status, 'S1');
  assert.equal(item.meaning, '我修正的释义');
  assert.equal(item.example, 'I want to read this post.');
  assert.equal(item.source, '实际工作帖文');
  assert.equal(item.note, '后续词库补充');
  assert.equal(item.coreOrder, to.coreOrder);
  assert.equal(repo.listItems({ module: 'reddit-core', limit: 1 }).total, 3000);
  assert.deepEqual(repo.exportData().reviewEvents, before);
});

test('first upgrade preserves content edits made before edit tracking existed', (t) => {
  const f = fixture(t);
  const seed = mergeRedditCore({ items: [], tracks: [] });
  syncSeedData(f.db, seed);
  const id = f.repo().listItems({ module: 'reddit-core', limit: 1 }).items[0].id;
  f.repo().updateItem(id, { meaning: '升级前的修订', example: 'the original post' });
  f.db.exec('ALTER TABLE learning_items DROP COLUMN user_edited_fields; ALTER TABLE learning_items DROP COLUMN core_order_index;');
  f.reopen();
  syncSeedData(f.db, seed);
  const item = f.repo().getItem(id);
  assert.equal(item.meaning, '升级前的修订');
  assert.equal(item.example, 'the original post');
  assert.equal(item.coreOrder, 1);
});

test('due failures and new work words precede numbered new words without premature reviews', (t) => {
  const f = fixture(t);
  syncSeedData(f.db, mergeRedditCore({ items: [], tracks: [] }));
  const repo = f.repo();
  const id = f.db.prepare('SELECT id FROM learning_items WHERE core_order_index = 1000').get().id;
  repo.reviewItem(id, 'again', new Date(Date.now() - 20 * 60_000));
  const manual = repo.createItem({ term: 'work phrase', meaning: '本次工作的生词' });
  const first = repo.todayQueue(4);
  assert.equal(first[0].id, id);
  assert.equal(first[1].id, manual.id);
  assert.deepEqual(first.slice(2).map(x => x.coreOrder), [1, 2]);
  repo.reviewItem(id, 'good');
  assert.equal(repo.todayQueue(1)[0].id, manual.id);
  assert.ok(!repo.todayQueue(30).some(x => x.id === id));
  repo.reviewItem(manual.id, 'good');
  assert.deepEqual(repo.todayQueue(3).map(x => x.coreOrder), [1, 2, 3]);
});
