import path from 'node:path';
import express from 'express';
import { createAuth } from './auth.js';
import { syncSeedData } from './db.js';
import { loadSeedData } from './seed-source.js';

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function createApp({ config, db, repository }) {
  const app = express();
  const auth = createAuth(config);
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(express.json({ limit: '128kb' }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/auth/session', auth.session);
  app.post('/api/auth/login', auth.login);
  app.post('/api/auth/logout', auth.logout);
  app.use('/api', auth.requireAuth);

  app.get('/api/today', (req, res) => {
    res.json({ items: repository.todayQueue(req.query.limit, req.query.kind), nextDueAt: repository.nextDueAt(req.query.kind), progress: repository.progress() });
  });

  app.get('/api/items', (req, res) => res.json(repository.listItems(req.query)));
  app.get('/api/items/:id', (req, res) => {
    const item = repository.getItem(req.params.id);
    if (!item) return res.status(404).json({ error: '没有找到这条内容' });
    res.json({ item });
  });
  app.post('/api/items', (req, res) => res.status(201).json({ item: repository.createItem(req.body) }));
  app.patch('/api/items/:id', (req, res) => {
    const item = repository.updateItem(req.params.id, req.body);
    if (!item) return res.status(404).json({ error: '没有找到这条内容' });
    res.json({ item });
  });
  app.post('/api/items/:id/components/:index', (req, res) => {
    const result = repository.addComponentAsItem(req.params.id, req.params.index);
    if (!result) return res.status(404).json({ error: '没有找到这条内容' });
    res.status(result.created ? 201 : 200).json(result);
  });
  app.delete('/api/items/:id', (req, res) => {
    if (!repository.archiveItem(req.params.id)) return res.status(404).json({ error: '没有找到这条内容' });
    res.status(204).end();
  });
  app.post('/api/items/:id/reviews', (req, res) => {
    const result = repository.reviewItem(req.params.id, req.body?.rating, new Date(), {
      result: req.body?.writingResult,
      durationMs: req.body?.writingDurationMs
    }, { ratingVersion: req.body?.ratingVersion, eventKind: req.body?.eventKind });
    if (!result) return res.status(404).json({ error: '没有找到这条内容' });
    res.json({ ...result, progress: repository.progress() });
  });
  app.get('/api/progress', (_req, res) => res.json(repository.progress()));
  app.get('/api/reading-drafts', (_req, res) => res.json({ drafts: repository.listReadingDrafts() }));
  app.post('/api/reading-drafts', (req, res) => res.status(201).json({ draft: repository.createReadingDraft(req.body) }));
  app.post('/api/reading-drafts/:id/publish', (req, res) => {
    const item = repository.publishReadingDraft(req.params.id, req.body);
    if (!item) return res.status(404).json({ error: '没有找到这条原句' });
    res.json({ item });
  });
  app.get('/api/export', (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="wordflow-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(repository.exportData());
  });
  app.post('/api/sync', asyncRoute(async (_req, res) => {
    const seed = loadSeedData(config);
    const result = syncSeedData(db, seed.data);
    res.json({ result, source: seed.source, progress: repository.progress() });
  }));

  app.use('/vendor/lucide', express.static(path.join(config.rootDir, 'node_modules/lucide/dist/umd')));
  app.use(express.static(path.join(config.rootDir, 'public'), {
    extensions: ['html'],
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    setHeaders: (res, filePath) => {
      if (['index.html', 'service-worker.js', 'manifest.webmanifest'].includes(path.basename(filePath))) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));
  app.get('*splat', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.rootDir, 'public/index.html'));
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(400).json({ error: error.message || '请求失败' });
  });
  return app;
}
