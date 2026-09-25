# Deployment

## Requirements

- Node.js 20+
- Python 3.9+ with `ml/requirements.txt` installed
- PostgreSQL 14+
- A TLS-terminating reverse proxy (nginx, Caddy, or a platform load balancer)

## Build and run

Two processes must run: the Node API and the Python inference service.

```bash
npm ci
pip3 install -r ml/requirements.txt

npm run ml:train       # produces ml/models/ — commit these or build them in CI
npm run build          # type-check + compile to server/dist
npm run db:migrate     # apply migrations (never db:reset in production)

# process 1 — inference, localhost only
python3 ml/serve.py
# process 2 — API + frontend
npm start
```

The compiled server also serves `web/`, so there is no separate frontend deploy.

**Order matters at boot.** The API starts and serves pages even if the model service is down, but
`POST /requests` returns 503 `CLASSIFIER_UNAVAILABLE` until inference is up. `GET /api/v1/health`
reports `classifier: "up" | "down"` separately from `status` for exactly this reason — point your
monitoring at both fields.

**Never expose port 8001.** The model service has no authentication of its own; it is safe only
because nothing but the Node API can reach it. Bind it to `127.0.0.1` (the default) and do not
add it to your reverse proxy.

## Production configuration

```bash
NODE_ENV=production
DATABASE_URL=postgresql://udc_app:<password>@db-host:5432/udc
JWT_SECRET=<openssl rand -base64 48>
ML_SERVICE_URL=http://127.0.0.1:8001
HOST=0.0.0.0
PORT=4000
CORS_ORIGIN=https://deptify.example
COOKIE_SECURE=true
API_URL=https://deptify.example
RATE_LIMIT_MAX=300
RATE_LIMIT_WINDOW=1 minute
```

`COOKIE_SECURE=true` is required once you are on HTTPS, or the session cookie will be sent over
plaintext. The process refuses to start if `JWT_SECRET` is missing or shorter than 32 characters.

## Before you go live

- [ ] **Delete the demo accounts.** All six are created by the seed with published passwords.
      ```sql
      DELETE FROM users WHERE email LIKE '%@udc.local';
      ```
      Then create a real admin and promote it:
      ```sql
      UPDATE users SET role = 'ADMIN' WHERE email = 'you@yourdomain';
      ```
- [ ] Generate a fresh `JWT_SECRET` (rotating it invalidates all sessions).
- [ ] `COOKIE_SECURE=true` and `CORS_ORIGIN` set to your real origin.
- [ ] Wire an email provider for password resets — see
      [SECURITY.md](SECURITY.md#password-reset). Until then, `devToken` is withheld in production
      and the reset flow cannot complete.
- [ ] Create a least-privilege database role (below).
- [ ] Set up backups and verify a restore.
- [ ] Point monitoring at `GET /api/v1/health` — alert on `status` **and** `classifier`.
- [ ] Confirm port 8001 is not reachable from outside the host.
- [ ] Decide whether `requests.message` needs encryption at rest — students write free text, which
      may contain personal details.

## Database role

Do not run the app as a superuser:

```sql
CREATE ROLE udc_app LOGIN PASSWORD '<password>';
GRANT CONNECT ON DATABASE udc TO udc_app;
GRANT USAGE ON SCHEMA public TO udc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO udc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO udc_app;
```

Migrations need DDL rights, so run `npm run db:migrate` as a migration role, not as `udc_app`.

## Reverse proxy

Terminate TLS upstream and forward the real client IP — the app sets `trustProxy`, and rate
limiting and audit logging both depend on it.

```nginx
location / {
    proxy_pass         http://127.0.0.1:4000;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
}
```

## systemd

Two units. The API should start after inference so the first requests do not 503.

`udc-ml.service`:

```ini
[Unit]
Description=UDC inference service
After=network.target

[Service]
Type=simple
User=udc
WorkingDirectory=/srv/udc/ml
Environment=ML_HOST=127.0.0.1 ML_PORT=8001
ExecStart=/usr/bin/python3 serve.py
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`udc-api.service`:

```ini
[Unit]
Description=UDC API
After=network.target postgresql.service udc-ml.service
Wants=udc-ml.service

[Service]
Type=simple
User=udc
WorkingDirectory=/srv/udc
EnvironmentFile=/srv/udc/.env
ExecStart=/usr/bin/node server/dist/index.js
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/srv/udc

[Install]
WantedBy=multi-user.target
```

`SIGTERM` and `SIGINT` are handled: the server stops accepting connections, drains, closes the
pool, then exits.

## Migrations in a release

Run `npm run db:migrate` **before** starting the new build. Migrations are additive and each runs
in its own transaction. `npm run db:reset` refuses to run when `NODE_ENV=production`, but it is
still worth ensuring no deploy script calls it.

To roll back, deploy the previous build. There are no down-migrations by design: write a new
forward migration that reverses the change.

## Scaling

The rate limiter is **in-memory**, so each instance counts independently. Before running more
than one:

```ts
// server/src/app.ts
await app.register(rateLimit, { redis: new Redis(process.env.REDIS_URL), /* … */ });
```

Sessions are stateless JWTs, so no sticky sessions are needed. The database connection pool is 10
per instance (`server/src/db/pool.ts`) — size PostgreSQL's `max_connections` accordingly, or put
PgBouncer in front.

## Retraining in production

The model is a build artifact, not runtime state:

```bash
# on a build machine or in CI
npm run ml:train && python3 ml/test_model.py
# ship ml/models/ with the release, then
systemctl restart udc-ml      # loads the new artifact
npm run db:seed               # registers the new version and its metrics
```

Old tickets keep the `model_version` that routed them, so a retrain never rewrites history.

## Backups

```bash
pg_dump --format=custom --file=udc-$(date +%F).dump "$DATABASE_URL"
```

`request_predictions.probabilities` is JSONB and compresses well. Test a restore into a scratch
database regularly — an untested backup is not a backup.

## Monitoring

- **Liveness**: `GET /api/v1/health` runs a real query, so it fails when the database is down.
- **Logs**: structured JSON (pino) with credentials redacted. Ship to your aggregator.
- **Worth alerting on**: sustained 5xx, 429 spikes on `/auth/*` (credential stuffing), health
  check latency, connection-pool saturation.
