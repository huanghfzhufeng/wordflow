# Production deployment

Current production target:

- Server: Tencent Cloud `YOUR_SERVER_IP`
- Public URL: `http://YOUR_SERVER_IP/wordflow/`
- App process: PM2 `wordflow`, listening on `127.0.0.1:4317`
- Database: `/var/lib/wordflow/wordflow.db`
- Reverse proxy: Nginx on port 80
- Access control: signed application session cookie with a 90-day lifetime

The existing ledger remains available at `http://YOUR_SERVER_IP`. Nginx proxies it to
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
  ./ root@YOUR_SERVER_IP:/opt/wordflow/

ssh root@YOUR_SERVER_IP '
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
ssh root@YOUR_SERVER_IP /opt/wordflow/deploy/backup.sh
```

## Verification

```bash
ssh root@YOUR_SERVER_IP 'pm2 status && nginx -t'
curl -I http://YOUR_SERVER_IP/wordflow/
```

The HTML shell and `/wordflow/api/auth/session` are public. An unauthenticated
request to `/wordflow/api/progress` must return `401`; after signing in once,
the session cookie must keep the installed iOS app authenticated across launches.
