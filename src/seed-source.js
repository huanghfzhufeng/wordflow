import fs from 'node:fs';
import { buildSeedData } from './sync-data.js';
import { mergeRedditCore } from './reddit-core.js';

export function loadSeedData({ memoryRoot, seedPath }) {
  try {
    return { data: mergeRedditCore(buildSeedData(memoryRoot)), source: 'workspace-memory' };
  } catch (memoryError) {
    if (!fs.existsSync(seedPath)) throw memoryError;
    return {
      data: mergeRedditCore(JSON.parse(fs.readFileSync(seedPath, 'utf8'))),
      source: 'bundled-seed'
    };
  }
}
