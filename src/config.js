import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  rootDir,
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 4317),
  dbPath: path.resolve(rootDir, process.env.DB_PATH || 'data/wordflow.db'),
  seedPath: path.resolve(rootDir, process.env.SEED_PATH || 'seed/learning-seed.json'),
  memoryRoot: path.resolve(rootDir, process.env.MEMORY_ROOT || '../全局记忆/notes'),
  timeZone: process.env.LEARNING_TIME_ZONE || 'Asia/Singapore'
};
