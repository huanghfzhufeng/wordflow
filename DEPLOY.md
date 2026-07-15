# Production deployment

Current production target:

- Server: Tencent Cloud `1.15.122.48`
- Public URL: `http://1.15.122.48/wordflow/`
- App process: PM2 `wordflow`, listening on `127.0.0.1:4317`
- Database: `/var/lib/wordflow/wordflow.db`
- Reverse proxy: Nginx on port 80
- Access control: Nginx Basic Auth, generated from the existing ledger owner account on the server

The existing ledger remains available at `http://1.15.122.48`. Nginx proxies it to
`127.0.0.1:3000` and routes `/wordflow/` to port `4317` after removing the path prefix.

On the first deployment, copy `.env.production.example` to `/opt/wordflow/.env` and
keep the production database outside the release directory.

## Deploy an update

From the repository root:

```bash
rsync -az --delete \
  --exclude node_modules \
  --exclude data \
  --exclude .git \
  --exclude .env \
  ./ root@1.15.122.48:/opt/wordflow/

ssh root@1.15.122.48 '
  cd /opt/wordflow &&
  deploy/install-production.sh &&
  pm2 restart wordflow --update-env &&
  curl -fsS http://127.0.0.1:4317/api/health
'
```

## Backups

The server runs `deploy/backup.sh` every day at 04:15 and keeps 14 days. Run a
manual consistent SQLite backup with:

```bash
ssh root@1.15.122.48 /opt/wordflow/deploy/backup.sh
```

## Verification

```bash
ssh root@1.15.122.48 'pm2 status && nginx -t'
curl -I http://1.15.122.48/wordflow/
```

An unauthenticated request must return `401`. After signing in with the existing
ledger owner account, `/wordflow/api/health` must return `{ "ok": true }`.
