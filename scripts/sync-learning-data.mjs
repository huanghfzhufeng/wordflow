import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { buildSeedData } from '../src/sync-data.js';

const outputPath = config.seedPath;
const data = buildSeedData(config.memoryRoot);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(`已生成 ${outputPath}`);
console.log(`内容 ${data.items.length} 条，进度轨道 ${data.tracks.length} 条`);
