import fs from 'node:fs';

const sentences = JSON.parse(fs.readFileSync(new URL('../seed/reading-sentences.zh-CN.json', import.meta.url), 'utf8'));

export function withReadingSeed(seed) {
  const items = new Map(seed.items.map(item => [item.seedKey, item]));
  sentences.forEach(([category, term, meaning, note], index) => {
    const seedKey = `reading:teaching:${index + 1}`;
    items.set(seedKey, {
      seedKey, term, meaning, note, kind: 'sentence', module: 'reddit-reading',
      source: `教学短句 · ${category}`, status: 'S0', priority: 35, orderIndex: index + 1, components: []
    });
  });
  return {
    ...seed,
    items: [...items.values()]
  };
}
