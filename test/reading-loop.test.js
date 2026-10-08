import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase, createRepository, syncSeedData } from '../src/db.js';
import { loadSeedData } from '../src/seed-source.js';
import { withReadingSeed } from '../src/sentence-seed.js';
import { createApp } from '../src/app.js';
import { once } from 'node:events';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordflow-reading-'));
  const file = path.join(dir, 'db');
  let db = openDatabase(file);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return {
    get db() { return db; }, repo() { return createRepository(db, { timeZone: 'Asia/Singapore' }); },
    reopen() { db.close(); db = openDatabase(file); }
  };
}
const options = { ratingVersion: 2 };

test('FSRS learning, graduation, growing intervals and relearning are independent of evidence labels', t => {
  const f = fixture(t); const repo = f.repo();
  const item = repo.createItem({ term: 'post', meaning: '帖子；发布' });
  let at = new Date('2026-10-08T15:59:00Z');
  const first = repo.reviewItem(item.id, 'good', at, null, options);
  assert.equal(first.item.learningPhase, 'learning'); assert.equal(first.item.status, 'S1');
  assert.equal(new Date(first.item.nextReviewAt) - at, 10 * 60_000);
  at = new Date(first.item.nextReviewAt);
  let result = repo.reviewItem(item.id, 'good', at, null, options);
  assert.equal(result.item.learningPhase, 'review'); assert.equal(result.item.status, 'S1');
  const firstInterval = new Date(result.item.nextReviewAt) - at;
  for (let i = 0; i < 8; i++) {
    at = new Date(result.item.nextReviewAt);
    result = repo.reviewItem(item.id, 'good', at, null, options);
  }
  assert.equal(result.item.status, 'S2');
  assert.ok(new Date(result.item.nextReviewAt) - at > firstInterval);
  at = new Date(result.item.nextReviewAt);
  result = repo.reviewItem(item.id, 'again', at, null, options);
  assert.equal(result.item.learningPhase, 'relearning'); assert.equal(result.item.status, 'S1');
  assert.equal(new Date(result.item.nextReviewAt) - at, 10 * 60_000);
  result = repo.reviewItem(item.id, 'good', new Date(result.item.nextReviewAt), null, options);
  assert.equal(result.item.status, 'S1');
  assert.throws(() => repo.reviewItem(item.id, 'bad'), /无效/);
});

test('practice never changes item, schedule or formal results, and sync/restart preserve schedules', t => {
  const f = fixture(t); let repo = f.repo();
  const item = repo.createItem({ term: 'test', meaning: '测试' });
  repo.reviewItem(item.id, 'hard', new Date(), null, options);
  const before = repo.getItem(item.id);
  const schedule = f.db.prepare('SELECT * FROM review_schedules WHERE item_id = ?').get(item.id);
  const metrics = repo.progress().readingReview;
  repo.reviewItem(item.id, 'again', new Date(), null, { ratingVersion: 2, eventKind: 'practice' });
  assert.deepEqual(repo.getItem(item.id), before);
  assert.deepEqual(f.db.prepare('SELECT * FROM review_schedules WHERE item_id = ?').get(item.id), schedule);
  assert.deepEqual(repo.progress().readingReview, metrics);
  assert.equal(repo.progress().practiceCount, 1);
  f.reopen(); repo = f.repo();
  syncSeedData(f.db, { items: [], tracks: [] });
  assert.deepEqual(repo.getItem(item.id), before);
  assert.deepEqual(f.db.prepare('SELECT * FROM review_schedules WHERE item_id = ?').get(item.id), schedule);
});

test('new Hard is successful but legacy ambiguous Hard is not replayed as success', t => {
  const f = fixture(t); const repo = f.repo();
  const legacy = repo.createItem({ term: 'legacy', meaning: '旧规则' });
  const fresh = repo.createItem({ term: 'fresh', meaning: '新规则' });
  repo.reviewItem(legacy.id, 'hard');
  const result = repo.reviewItem(fresh.id, 'hard', new Date(), null, options);
  assert.equal(repo.getItem(legacy.id).correctCount, 0);
  assert.equal(result.item.correctCount, 1);
  assert.deepEqual(repo.progress().readingReview, { reviewed: 1, correct: 1 });
});

test('teaching material is complete and draft publication is validated, atomic and repeatable', t => {
  const f = fixture(t); const repo = f.repo();
  const seed = loadSeedData({ memoryRoot: '/missing', seedPath: path.resolve('seed/learning-seed.json') }).data;
  assert.equal(seed.items.filter(item => item.seedKey.startsWith('reading:')).length, 30);
  assert.equal(withReadingSeed(seed).items.length, seed.items.length);
  syncSeedData(f.db, seed);
  assert.equal(repo.listItems({ module: 'reddit-core', limit: 1 }).total, 3000);
  const sentences = repo.listItems({ module: 'reddit-reading' }).items;
  assert.equal(sentences.length, 30);
  assert.ok(sentences.every(item => item.meaning && item.note && item.source.startsWith('教学短句')));
  assert.equal(new Set(sentences.map(item => item.source)).size, 6);
  assert.ok(repo.todayQueue(30, 'words').every(item => item.kind !== 'sentence'));
  assert.ok(repo.todayQueue(30, 'sentence').every(item => item.kind === 'sentence'));
  const words = f.db.prepare("SELECT id, status FROM learning_items WHERE kind <> 'sentence' ORDER BY id").all();
  repo.reviewItem(sentences[0].id, 'good', new Date(), null, options);
  assert.deepEqual(f.db.prepare("SELECT id, status FROM learning_items WHERE kind <> 'sentence' ORDER BY id").all(), words);
  const draft = repo.createReadingDraft({ text: 'Read the original post.', sourceUrl: 'https://www.reddit.com/' });
  assert.equal(repo.listReadingDrafts().length, 1);
  assert.throws(() => repo.publishReadingDraft(draft.id, { meaning: '' }), /不能为空/);
  assert.equal(repo.listReadingDrafts().length, 1);
  const published = repo.publishReadingDraft(draft.id, { meaning: '阅读原帖。', note: '对象：原帖。' });
  assert.equal(published.kind, 'sentence');
  assert.equal(repo.publishReadingDraft(draft.id, {}).id, published.id);
  assert.equal(repo.listReadingDrafts().length, 0);
  assert.equal(repo.listItems({ module: 'reddit-reading' }).total, 31);
  assert.throws(() => repo.createReadingDraft({ text: 'Bad URL', sourceUrl: 'javascript:alert(1)' }), /只支持/);
});

test('legacy due dates remain unchanged until a subsequent formal review', t => {
  const f = fixture(t); const repo = f.repo();
  const item = repo.createItem({ term: 'old', meaning: '旧词' });
  f.db.prepare("UPDATE learning_items SET status = 'S2', next_review_at = '2026-10-30T00:00:00Z' WHERE id = ?").run(item.id);
  const before = repo.getItem(item.id);
  f.reopen();
  assert.deepEqual(f.repo().getItem(item.id), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM review_schedules').get().n, 0);
});

test('database failures roll back schedules, evidence and draft publication together', t => {
  const f = fixture(t); const repo = f.repo();
  const item = repo.createItem({ term: 'atomic', meaning: '原子操作' });
  const before = repo.getItem(item.id);
  f.db.exec("CREATE TRIGGER fail_review BEFORE INSERT ON review_events BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  assert.throws(() => repo.reviewItem(item.id, 'good', new Date(), null, options), /test failure/);
  assert.deepEqual(repo.getItem(item.id), before);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM review_schedules').get().n, 0);
  f.db.exec('DROP TRIGGER fail_review');
  const draft = repo.createReadingDraft({ text: 'Read this post.' });
  const count = repo.listItems().total;
  f.db.exec("CREATE TRIGGER fail_publish BEFORE UPDATE ON reading_drafts BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  assert.throws(() => repo.publishReadingDraft(draft.id, { meaning: '阅读这篇帖子。' }), /test failure/);
  assert.equal(repo.listItems().total, count);
  assert.equal(repo.listReadingDrafts().length, 1);
});

test('reading APIs require login and expose draft publication and practice without altering schedules', async t => {
  const f = fixture(t); const repo = f.repo();
  const item = repo.createItem({ term: 'api', meaning: '接口' });
  const app = createApp({ db: f.db, repository: repo, config: {
    rootDir: path.resolve('.'), authEnabled: true, authUsername: 'fixture', authPassword: 'fixture-password',
    sessionSecret: 'fixture-session-only', sessionTtlDays: 1, cookiePath: '/'
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/reading-drafts')).status, 401);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'fixture', password: 'fixture-password' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const before = repo.getItem(item.id);
  const response = await post(`/api/items/${item.id}/reviews`, { rating: 'good', ratingVersion: 2, eventKind: 'practice' });
  assert.equal(response.status, 200); assert.equal((await response.json()).eventKind, 'practice');
  assert.deepEqual(repo.getItem(item.id), before);
  const draft = (await (await post('/api/reading-drafts', { text: 'Read this post.' })).json()).draft;
  const published = await post(`/api/reading-drafts/${draft.id}/publish`, { meaning: '读这篇帖子。' });
  assert.equal(published.status, 200);
  const queue = await fetch(base + '/api/today?kind=sentence', { headers: { cookie } });
  const result = await queue.json(); assert.equal(result.items[0].kind, 'sentence');
  const exported = await (await fetch(base + '/api/export', { headers: { cookie } })).json();
  assert.ok(Array.isArray(exported.schedules)); assert.equal(exported.readingDrafts.length, 1);
});
