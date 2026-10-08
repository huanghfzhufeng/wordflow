import fs from 'node:fs';
import { buildSeedData } from './sync-data.js';
import { mergeRedditCore } from './reddit-core.js';
import { withReadingSeed } from './sentence-seed.js';

export function loadSeedData({ memoryRoot, seedPath }) {
  try {
    return { data: withReadingSeed(mergeRedditCore(buildSeedData(memoryRoot))), source: 'workspace-memory' };
  } catch (memoryError) {
    if (!fs.existsSync(seedPath)) throw memoryError;
    return {
      data: withReadingSeed(mergeRedditCore(JSON.parse(fs.readFileSync(seedPath, 'utf8')))),
      source: 'bundled-seed'
    };
  }
}
