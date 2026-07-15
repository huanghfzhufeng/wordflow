import { config } from './config.js';
import { createApp } from './app.js';
import { openDatabase, createRepository, syncSeedData } from './db.js';
import { loadSeedData } from './seed-source.js';

const db = openDatabase(config.dbPath);
const seed = loadSeedData(config);
const syncResult = syncSeedData(db, seed.data);
const repository = createRepository(db, { timeZone: config.timeZone });
const app = createApp({ config, db, repository });
const server = app.listen(config.port, config.host, () => {
  console.log(`词流已启动: http://${config.host}:${config.port}`);
  console.log(`学习档案同步: 新增 ${syncResult.inserted}, 更新 ${syncResult.updated}, 总计 ${syncResult.total}`);
  console.log(`种子来源: ${seed.source}`);
});

function shutdown(signal) {
  console.log(`收到 ${signal}，正在关闭…`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
