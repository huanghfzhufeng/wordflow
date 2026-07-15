import fs from 'node:fs';
import { buildSeedData } from './sync-data.js';

export function loadSeedData({ memoryRoot, seedPath }) {
  try {
    return { data: buildSeedData(memoryRoot), source: 'workspace-memory' };
  } catch (memoryError) {
    if (!fs.existsSync(seedPath)) throw memoryError;
    return {
      data: JSON.parse(fs.readFileSync(seedPath, 'utf8')),
      source: 'bundled-seed'
    };
  }
}
