import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { applyReviewPolicy, localDay, statusRank } from './review-policy.js';

const VALID_KINDS = new Set(['word', 'phrase', 'sentence']);
const VALID_MODULES = new Set([
  'foundation', 'learning-ledger', 'iphone-p0', 'iphone-p1', 'iphone-p2',
  'iphone-path', 'reddit-x', 'tech', 'daily', 'basketball', 'custom'
]);
const HIGH_RISK_TERMS = new Set(['Delete', 'Remove', 'Erase', 'Reset', 'Restore', 'Sign Out']);

function nowIso() {
  return new Date().toISOString();
}

function requireText(value, label, maxLength = 500) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label}不能为空`);
  if (text.length > maxLength) throw new Error(`${label}过长`);
  return text;
}

export function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seed_key TEXT UNIQUE,
      term TEXT NOT NULL,
      meaning TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'word',
      module TEXT NOT NULL DEFAULT 'custom',
      source TEXT NOT NULL DEFAULT '手动添加',
      source_url TEXT,
      example TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'S0',
      priority REAL NOT NULL DEFAULT 10,
      order_index INTEGER,
      last_reviewed_at TEXT,
      next_review_at TEXT,
      review_count INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      lapse_count INTEGER NOT NULL DEFAULT 0,
      real_hit_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
      rating TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      next_status TEXT NOT NULL,
      reviewed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_due
      ON learning_items(archived, status, next_review_at, priority DESC);
    CREATE INDEX IF NOT EXISTS idx_review_item_date
      ON review_events(item_id, reviewed_at);

    CREATE TABLE IF NOT EXISTS progress_tracks (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      current_value INTEGER NOT NULL,
      target_value INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

export function syncSeedData(db, seedData) {
  const find = db.prepare('SELECT * FROM learning_items WHERE seed_key = ?');
  const insert = db.prepare(`
    INSERT INTO learning_items (
      seed_key, term, meaning, kind, module, source, source_url, example, note,
      status, priority, order_index, last_reviewed_at, next_review_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE learning_items SET
      term = ?, meaning = ?, kind = ?, module = ?, source = ?, example = ?, note = ?,
      priority = ?, order_index = ?, status = ?, last_reviewed_at = COALESCE(last_reviewed_at, ?),
      next_review_at = CASE WHEN status = 'candidate' AND ? <> 'candidate' THEN ? ELSE next_review_at END,
      updated_at = ?
    WHERE id = ?
  `);
  const upsertTrack = db.prepare(`
    INSERT INTO progress_tracks (code, label, current_value, target_value, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      label = excluded.label,
      current_value = MAX(progress_tracks.current_value, excluded.current_value),
      target_value = excluded.target_value,
      updated_at = excluded.updated_at
  `);
  const now = nowIso();
  let inserted = 0;
  let updated = 0;

  db.transaction(() => {
    for (const item of seedData.items) {
      const existing = find.get(item.seedKey);
      const nextReviewAt = item.status === 'candidate' ? null : now;
      if (!existing) {
        insert.run(
          item.seedKey, item.term, item.meaning || '', item.kind, item.module, item.source,
          item.sourceUrl || null, item.example || '', item.note || '', item.status,
          item.priority || 10, item.orderIndex || null, item.lastReviewedAt || null,
          nextReviewAt, now, now
        );
        inserted += 1;
        continue;
      }

      const mergedStatus = statusRank(item.status) > statusRank(existing.status)
        ? item.status
        : existing.status;
      update.run(
        item.term, item.meaning || existing.meaning, item.kind, item.module, item.source,
        item.example || '', item.note || '', item.priority || 10, item.orderIndex || null,
        mergedStatus, item.lastReviewedAt || null, item.status, nextReviewAt, now, existing.id
      );
      updated += 1;
    }

    for (const track of seedData.tracks) {
      upsertTrack.run(track.code, track.label, track.current, track.target, now);
    }
  })();

  return { inserted, updated, total: seedData.items.length };
}

function publicItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    term: row.term,
    meaning: row.meaning,
    kind: row.kind,
    module: row.module,
    source: row.source,
    sourceUrl: row.source_url,
    example: row.example,
    note: row.note,
    status: row.status,
    priority: row.priority,
    lastReviewedAt: row.last_reviewed_at,
    nextReviewAt: row.next_review_at,
    reviewCount: row.review_count,
    correctCount: row.correct_count,
    lapseCount: row.lapse_count,
    realHitCount: row.real_hit_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createRepository(db, { timeZone }) {
  const getItemRow = db.prepare('SELECT * FROM learning_items WHERE id = ? AND archived = 0');

  function getItem(id) {
    return publicItem(getItemRow.get(Number(id)));
  }

  function listItems({ q = '', status = 'all', module = 'all', limit = 300, offset = 0 } = {}) {
    const clauses = ['archived = 0'];
    const params = [];
    if (q.trim()) {
      clauses.push('(term LIKE ? OR meaning LIKE ? OR note LIKE ?)');
      const like = `%${q.trim()}%`;
      params.push(like, like, like);
    }
    if (status === 'candidate') clauses.push("status = 'candidate'");
    if (status === 'learning') clauses.push("status IN ('S0', 'S1')");
    if (status === 'mastered') clauses.push("status IN ('S2', 'S3')");
    if (/^S[0-3]$/.test(status)) {
      clauses.push('status = ?');
      params.push(status);
    }
    if (module !== 'all') {
      clauses.push('module = ?');
      params.push(module);
    }
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const rows = db.prepare(`
      SELECT * FROM learning_items
      WHERE ${clauses.join(' AND ')}
      ORDER BY
        CASE status WHEN 'S0' THEN 0 WHEN 'S1' THEN 1 WHEN 'S2' THEN 2 WHEN 'S3' THEN 3 ELSE 4 END,
        priority DESC, COALESCE(order_index, 9999), term COLLATE NOCASE
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);
    const count = db.prepare(`SELECT COUNT(*) AS value FROM learning_items WHERE ${clauses.join(' AND ')}`).get(...params).value;
    return { items: rows.map(publicItem), total: count };
  }

  function todayQueue(limit = 10) {
    const now = nowIso();
    const rows = db.prepare(`
      SELECT * FROM learning_items
      WHERE archived = 0
        AND status <> 'candidate'
        AND (next_review_at IS NULL OR next_review_at <= ?)
      ORDER BY
        CASE status WHEN 'S0' THEN 0 WHEN 'S1' THEN 1 WHEN 'S2' THEN 2 WHEN 'S3' THEN 3 ELSE 4 END,
        priority DESC, lapse_count DESC, COALESCE(next_review_at, created_at), id
      LIMIT ?
    `).all(now, Math.min(Math.max(Number(limit) || 10, 1), 30));
    return rows.map(publicItem);
  }

  function createItem(input) {
    const term = requireText(input.term, '英文', 500);
    const meaning = requireText(input.meaning, '中文意思', 500);
    const kind = VALID_KINDS.has(input.kind) ? input.kind : 'word';
    const module = VALID_MODULES.has(input.module) ? input.module : 'custom';
    const now = nowIso();
    const info = db.prepare(`
      INSERT INTO learning_items (
        term, meaning, kind, module, source, source_url, example, note, status,
        priority, next_review_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'S0', 70, ?, ?, ?)
    `).run(
      term, meaning, kind, module, input.source?.trim() || '手动添加',
      input.sourceUrl?.trim() || null, input.example?.trim() || '', input.note?.trim() || '',
      now, now, now
    );
    return getItem(info.lastInsertRowid);
  }

  function updateItem(id, input) {
    const current = getItemRow.get(Number(id));
    if (!current) return null;
    const term = input.term === undefined ? current.term : requireText(input.term, '英文', 500);
    const meaning = input.meaning === undefined ? current.meaning : requireText(input.meaning, '中文意思', 500);
    const kind = VALID_KINDS.has(input.kind) ? input.kind : current.kind;
    const module = VALID_MODULES.has(input.module) ? input.module : current.module;
    db.prepare(`
      UPDATE learning_items SET
        term = ?, meaning = ?, kind = ?, module = ?, source = ?, source_url = ?,
        example = ?, note = ?, updated_at = ?
      WHERE id = ?
    `).run(
      term, meaning, kind, module,
      input.source === undefined ? current.source : input.source.trim() || '手动添加',
      input.sourceUrl === undefined ? current.source_url : input.sourceUrl.trim() || null,
      input.example === undefined ? current.example : input.example.trim(),
      input.note === undefined ? current.note : input.note.trim(),
      nowIso(), Number(id)
    );
    return getItem(id);
  }

  function archiveItem(id) {
    const info = db.prepare('UPDATE learning_items SET archived = 1, updated_at = ? WHERE id = ? AND archived = 0')
      .run(nowIso(), Number(id));
    return info.changes > 0;
  }

  function activateItem(id) {
    const current = getItemRow.get(Number(id));
    if (!current) return null;
    if (!current.meaning.trim()) throw new Error('请先补充中文核心义，再加入复习');
    db.prepare(`
      UPDATE learning_items SET status = 'S0', next_review_at = ?, priority = MAX(priority, 65), updated_at = ?
      WHERE id = ? AND archived = 0 AND status = 'candidate'
    `).run(nowIso(), nowIso(), Number(id));
    return getItem(id);
  }

  function reviewItem(id, rating, reviewedAt = new Date()) {
    const row = getItemRow.get(Number(id));
    if (!row) return null;
    const reviewedIso = reviewedAt instanceof Date ? reviewedAt.toISOString() : new Date(reviewedAt).toISOString();
    const realDaysRows = db.prepare(`
      SELECT reviewed_at FROM review_events WHERE item_id = ? AND rating = 'real'
    `).all(row.id);
    const realDays = new Set(realDaysRows.map((event) => localDay(event.reviewed_at, timeZone)));
    if (rating === 'real') realDays.add(localDay(reviewedIso, timeZone));
    const result = applyReviewPolicy({
      status: row.status,
      rating,
      reviewedAt: reviewedIso,
      previousReviewedAt: row.last_reviewed_at,
      realHitDays: realDays.size,
      timeZone
    });
    const isCorrect = rating === 'good' || rating === 'real';

    db.transaction(() => {
      db.prepare(`
        UPDATE learning_items SET
          status = ?, last_reviewed_at = ?, next_review_at = ?, review_count = review_count + 1,
          correct_count = correct_count + ?, lapse_count = lapse_count + ?,
          real_hit_count = real_hit_count + ?, updated_at = ?
        WHERE id = ?
      `).run(
        result.nextStatus, reviewedIso, result.nextReviewAt, isCorrect ? 1 : 0,
        rating === 'again' ? 1 : 0, rating === 'real' ? 1 : 0, reviewedIso, row.id
      );
      db.prepare(`
        INSERT INTO review_events (item_id, rating, previous_status, next_status, reviewed_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(row.id, rating, result.previousStatus, result.nextStatus, reviewedIso);
    })();

    return { item: getItem(id), transition: result };
  }

  function progress() {
    const statusRows = db.prepare(`
      SELECT status, COUNT(*) AS value FROM learning_items WHERE archived = 0 GROUP BY status
    `).all();
    const counts = Object.fromEntries(statusRows.map((row) => [row.status, row.value]));
    for (const status of ['candidate', 'S0', 'S1', 'S2', 'S3']) counts[status] ||= 0;

    const today = localDay(new Date(), timeZone);
    const events = db.prepare('SELECT reviewed_at, rating FROM review_events').all();
    const todayEvents = events.filter((event) => localDay(event.reviewed_at, timeZone) === today);
    const reviewDays = new Set(events.map((event) => localDay(event.reviewed_at, timeZone)));

    const iphoneRows = db.prepare(`
      SELECT seed_key, term, module, status FROM learning_items
      WHERE archived = 0 AND module LIKE 'iphone-%'
    `).all();
    const learned = (row) => statusRank(row.status) >= statusRank('S2');
    const p0 = iphoneRows.filter((row) => row.module === 'iphone-p0');
    const p1 = iphoneRows.filter((row) => row.module === 'iphone-p1');
    const critical = iphoneRows.filter((row) => HIGH_RISK_TERMS.has(row.term));
    const recovery = iphoneRows.find((row) => row.module === 'iphone-path');
    const e0Goals = [
      { label: 'P0 延迟识别至少 11/12', done: p0.filter(learned).length >= 11, value: `${p0.filter(learned).length}/12` },
      { label: 'P1 延迟识别至少 22/24', done: p1.filter(learned).length >= 22, value: `${p1.filter(learned).length}/24` },
      { label: '6 个高风险词全部正确', done: critical.length === 6 && critical.every(learned), value: `${critical.filter(learned).length}/6` },
      { label: '能独立说出恢复中文路径', done: Boolean(recovery && learned(recovery)), value: recovery?.status || 'S0' }
    ];

    const tracks = db.prepare('SELECT * FROM progress_tracks ORDER BY code').all().map((row) => ({
      code: row.code,
      label: row.label,
      current: row.code === 'E0' ? e0Goals.filter((goal) => goal.done).length : row.current_value,
      target: row.target_value
    }));

    const f0 = tracks.find((track) => track.code === 'F0');
    if (f0) {
      const criticalReady = ['what they mean', 'send a request', 'receive a response'].every((term) => {
        const item = db.prepare('SELECT status FROM learning_items WHERE lower(term) = lower(?) AND archived = 0').get(term);
        return item && statusRank(item.status) >= statusRank('S2');
      });
      f0.current = criticalReady ? 4 : Math.max(f0.current, 3);
    }

    return {
      counts,
      today: {
        reviewed: todayEvents.length,
        remembered: todayEvents.filter((event) => ['good', 'real'].includes(event.rating)).length
      },
      totalReviewDays: reviewDays.size,
      tracks,
      e0Goals
    };
  }

  function exportData() {
    return {
      exportedAt: nowIso(),
      items: db.prepare('SELECT * FROM learning_items WHERE archived = 0 ORDER BY id').all().map(publicItem),
      reviewEvents: db.prepare('SELECT * FROM review_events ORDER BY id').all(),
      progress: progress()
    };
  }

  return {
    getItem,
    listItems,
    todayQueue,
    createItem,
    updateItem,
    archiveItem,
    activateItem,
    reviewItem,
    progress,
    exportData
  };
}

export { HIGH_RISK_TERMS };
