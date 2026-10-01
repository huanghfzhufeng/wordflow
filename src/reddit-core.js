import fs from 'node:fs';

const source = JSON.parse(fs.readFileSync(new URL('../seed/reddit-core-3000.json', import.meta.url), 'utf8'));

function key(term) {
  return String(term).toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

export function mergeRedditCore(seed) {
  const items = new Map(seed.items.map((item) => [key(item.term), { ...item }]));
  const mainTerms = new Set();
  if (source.items.length !== 3000 || source.forms.length !== 106) {
    throw new Error('Reddit 核心词表数量不完整');
  }

  for (const row of source.items) {
    if (row.order !== mainTerms.size + 1 || !row.term || !row.meaning || mainTerms.has(key(row.term))) {
      throw new Error(`Reddit 核心词表顺序或内容无效: ${row.order}`);
    }
    const normalized = key(row.term);
    mainTerms.add(normalized);
    const existing = items.get(normalized) || {};
    items.set(normalized, {
      ...existing,
      seedKey: existing.seedKey || `item:${normalized}`,
      term: row.term,
      meaning: row.meaning,
      kind: 'word',
      module: existing.module?.startsWith('iphone-') ? existing.module : 'reddit-core',
      source: source.title,
      status: existing.status || 'S0',
      priority: existing.module?.startsWith('iphone-') ? existing.priority : 50,
      orderIndex: row.order,
      note: existing.note || '',
      components: existing.components || []
    });
  }

  for (const row of source.forms) {
    const normalized = key(row.term);
    const existing = items.get(normalized) || {};
    const detail = `${row.kind}：${row.expanded}${row.note ? `；${row.note}` : ''}`;
    if (mainTerms.has(normalized)) {
      items.set(normalized, {
        ...existing,
        note: existing.note?.includes(detail) ? existing.note : [existing.note, detail].filter(Boolean).join('；')
      });
    } else {
      items.set(normalized, {
        ...existing,
        seedKey: existing.seedKey || `item:${normalized}`,
        term: row.term,
        meaning: row.meaning,
        kind: 'word',
        module: 'reddit-forms',
        source: `${source.title} · 关键变形与缩写`,
        status: existing.status || 'S0',
        priority: 40,
        orderIndex: null,
        note: detail,
        components: existing.components || []
      });
    }
  }

  return { ...seed, items: [...items.values()] };
}
