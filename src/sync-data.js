import fs from 'node:fs';
import path from 'node:path';
import { parse as parseCsv } from 'csv-parse/sync';
import { statusRank } from './review-policy.js';

const FILES = {
  vocabulary: 'english-vocabulary.md',
  iphone: 'english-iphone-priority.md',
  curriculum: 'english-curriculum.csv',
  progress: 'english-progress.md'
};

const IPHONE_SECTIONS = [
  { heading: 'P0 Switch And Recovery', module: 'iphone-p0', priority: 95 },
  { heading: 'P1 Risk-Critical Actions', module: 'iphone-p1', priority: 90 },
  { heading: 'P2 Permissions And Connectivity', module: 'iphone-p2', priority: 55 }
];

const HIGH_RISK_TERMS = new Set(['Delete', 'Remove', 'Erase', 'Reset', 'Restore', 'Sign Out']);
const HIGH_RISK_PRIORITIES = new Map([
  ['Erase', 130],
  ['Restore', 126],
  ['Reset', 123],
  ['Remove', 120],
  ['Sign Out', 116],
  ['Delete', 112]
]);
const PHONETICS = new Map([
  ['Delete', '/dɪˈliːt/'],
  ['Remove', '/rɪˈmuːv/'],
  ['Erase', '/ɪˈreɪs/'],
  ['Reset', '/ˌriːˈset/'],
  ['Restore', '/rɪˈstɔːr/'],
  ['Sign Out', '/saɪn aʊt/']
]);
const CORE_MEANINGS = new Map(Object.entries(JSON.parse(
  fs.readFileSync(new URL('../seed/core-meanings.zh-CN.json', import.meta.url), 'utf8')
)).map(([term, meaning]) => [normalizeTerm(term), meaning]));
const WORD_COMPONENTS = new Map(Object.entries(JSON.parse(
  fs.readFileSync(new URL('../seed/word-components.zh-CN.json', import.meta.url), 'utf8')
)).map(([term, components]) => [normalizeTerm(term), validatedComponents(term, components)]));

function readRequired(memoryRoot, filename) {
  return fs.readFileSync(path.join(memoryRoot, filename), 'utf8');
}

function cleanCell(value = '') {
  return value.trim().replace(/^`|`$/g, '').replace(/\\\|/g, '|');
}

function section(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(`^##+ ${escaped}[^\\n]*\\n([\\s\\S]*?)(?=^##+ |\\Z)`, 'm'));
  return match?.[1] || '';
}

function parseMarkdownTable(markdownSection) {
  return markdownSection
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.trim().slice(1, -1).split('|').map(cleanCell))
    .filter((cells) => cells.length >= 2 && !cells.every((cell) => /^:?-+:?$/.test(cell)))
    .slice(1);
}

function normalizeTerm(term) {
  return term.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

function validatedComponents(term, components) {
  const roles = new Set(['word', 'prefix', 'root', 'suffix']);
  if (!Array.isArray(components) || components.length < 2 || components.length > 8) {
    throw new Error(`构词拆解数量无效: ${term}`);
  }
  return components.map((component) => {
    const text = String(component?.text || '').trim();
    const meaning = String(component?.meaning || '').trim();
    const role = String(component?.role || 'word');
    if (!text || text.length > 60 || !meaning || meaning.length > 120 || !roles.has(role)) {
      throw new Error(`构词拆解内容无效: ${term}`);
    }
    return { text, role, meaning };
  });
}

function normalizedStatus(status) {
  const match = String(status || '').match(/S[0-3]/);
  return match?.[0] || 'S0';
}

function curriculumModule(unitType) {
  if (unitType === 'internet_expression') return 'reddit-x';
  if (unitType === 'domain_anchor') return 'tech';
  return 'foundation';
}

function curriculumKind(row) {
  if (row.unit_type === 'form_or_chunk' || row.unit.includes(' ')) return 'phrase';
  return 'word';
}

function mergeItem(map, item) {
  const key = normalizeTerm(item.term);
  const current = map.get(key);
  if (!current) {
    map.set(key, { ...item, seedKey: `item:${key}` });
    return;
  }

  const incomingWins = statusRank(item.status) > statusRank(current.status);
  map.set(key, {
    ...current,
    ...item,
    status: incomingWins ? item.status : current.status,
    meaning: item.meaning || current.meaning,
    note: item.note || current.note,
    seedKey: current.seedKey
  });
}

function vocabularyItems(markdown, reviewedAt) {
  const entries = [];
  for (const [heading, kind] of [['Words', 'word'], ['Chunks', 'phrase']]) {
    for (const [term, meaning, status, note] of parseMarkdownTable(section(markdown, heading))) {
      entries.push({
        term,
        meaning,
        phonetic: PHONETICS.get(term) || '',
        status: normalizedStatus(status),
        kind,
        module: 'learning-ledger',
        source: '英语词汇账本',
        note,
        priority: /待复测|失败|误|不认识/.test(note) ? 80 : 35,
        lastReviewedAt: reviewedAt
      });
    }
  }
  return entries;
}

function iphoneItems(markdown, statusByTerm, reviewedAt) {
  const entries = [];
  for (const definition of IPHONE_SECTIONS) {
    for (const [term, meaning] of parseMarkdownTable(section(markdown, definition.heading))) {
      entries.push({
        term,
        meaning,
        status: statusByTerm.get(normalizeTerm(term)) || 'S0',
        kind: term.includes(' ') ? 'phrase' : 'word',
        module: definition.module,
        source: 'iPhone English',
        note: HIGH_RISK_TERMS.has(term) ? '高风险操作词，必须能在场景中准确区分。' : '',
        priority: HIGH_RISK_PRIORITIES.get(term) || definition.priority,
        lastReviewedAt: reviewedAt
      });
    }
  }

  entries.push({
    term: 'Settings > General > Language & Region > Add Language > Simplified Chinese',
    meaning: '切换回简体中文的菜单路径',
    status: 'S1',
    kind: 'phrase',
    module: 'iphone-path',
    source: 'iPhone English',
    note: '需要在后续学习日无提示说出，才算通过安全切换门槛。',
    priority: 105,
    lastReviewedAt: reviewedAt
  });
  return entries;
}

function curriculumItems(csv) {
  return parseCsv(csv, { columns: true, skip_empty_lines: true }).map((row) => {
    const meaning = String(row.meaning_zh || CORE_MEANINGS.get(normalizeTerm(row.unit)) || '').trim();
    if (!meaning) throw new Error(`课程词条缺少中文核心义: ${row.unit}`);
    return {
      term: row.unit,
      meaning,
      status: normalizedStatus(row.status),
      kind: curriculumKind(row),
      module: curriculumModule(row.unit_type),
      source: row.source || '300 词核心课程',
      example: row.example_or_chunk,
      note: row.notes,
      priority: 25,
      orderIndex: Number(row.order || 0) || null,
      lastReviewedAt: null
    };
  });
}

export function parseProgressTracks(markdown) {
  const tracks = [];
  const pattern = /^### ([A-Z]\d) ([^`\n]+) `\[[^\]]+\] (\d+)\/(\d+)`/gm;
  for (const match of markdown.matchAll(pattern)) {
    tracks.push({
      code: match[1],
      label: match[2].trim(),
      current: Number(match[3]),
      target: Number(match[4])
    });
  }
  return tracks;
}

export function buildSeedData(memoryRoot) {
  const vocabularyPath = path.join(memoryRoot, FILES.vocabulary);
  const reviewedAt = fs.statSync(vocabularyPath).mtime.toISOString();
  const vocabulary = readRequired(memoryRoot, FILES.vocabulary);
  const iphone = readRequired(memoryRoot, FILES.iphone);
  const curriculum = readRequired(memoryRoot, FILES.curriculum);
  const progress = readRequired(memoryRoot, FILES.progress);
  const map = new Map();

  for (const item of curriculumItems(curriculum)) mergeItem(map, item);
  const ledgerItems = vocabularyItems(vocabulary, reviewedAt);
  for (const item of ledgerItems) mergeItem(map, item);
  const statusByTerm = new Map(ledgerItems.map((item) => [normalizeTerm(item.term), item.status]));
  for (const item of iphoneItems(iphone, statusByTerm, reviewedAt)) mergeItem(map, item);

  return {
    generatedAt: new Date().toISOString(),
    items: [...map.values()].map((item) => ({
      ...item,
      components: WORD_COMPONENTS.get(normalizeTerm(item.term)) || []
    })),
    tracks: parseProgressTracks(progress)
  };
}
