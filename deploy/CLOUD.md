# Deploy from your phone (Railway)

You do **not** need Supabase to go live. You **do** need a free [AISStream.io](https://aisstream.io) API key for live vessel positions.

## What you need

| Item | Required? |
|------|-----------|
| GitHub repo `bdeakin/ahyc-fleet-tracker` | Yes |
| [AISStream](https://aisstream.io) API key | Yes (for live tracking) |
| [Railway](https://railway.app) account (login with GitHub) | Yes |
| Strong `LOCAL_ADMIN_TOKEN` | Yes |
| Supabase project | No (optional later) |

## Steps (phone browser)

### 1. AISStream

1. Open [aisstream.io](https://aisstream.io) and sign in.
2. Create an API key and copy it.

### 2. Railway project

1. Open [railway.app](https://railway.app) → sign in with GitHub.
2. **New Project** → **Deploy from GitHub repo**.
3. Select **`bdeakin/ahyc-fleet-tracker`** (use `main` after merge, or the PR branch while testing).
4. Railway builds with the root `Dockerfile` (`railway.toml`).

### 3. Persistent volume (required for track history)

Railway volumes **do** survive redeploys. Tracks only vanish when SQLite is writing to the ephemeral container disk instead of the volume.

1. Open the service → click the volume (or **Settings → Volumes**).
2. Set the volume **mount path** to exactly **`/data`** (must match where the app stores the DB).
3. In **Variables**, set `DATA_DIR=/data` (optional if the volume mount is `/data` — the app also follows `RAILWAY_VOLUME_MOUNT_PATH`).
4. Redeploy once after attaching/changing the volume.

After deploy, open `/api/health` and confirm:
- `durableStorage: true`
- `dataDir` / `railwayVolumeMountPath` are `/data` (or your mount path)
- `dataDirIsMount: true`

### 4. Environment variables

Service → **Variables** → add:

| Variable | Value |
|----------|--------|
| `AISSTREAM_API_KEY` | your AISStream key |
| `CARTO_API_KEY` | Carto Basemaps key (Voyager harbor tiles) |
| `LOCAL_ADMIN_TOKEN` | long random string (not `dev-admin-token`) |
| `DATA_DIR` | `/data` |

Leave all `SUPABASE_*` variables empty for now. Railway sets `PORT` automatically. Without `CARTO_API_KEY`, the harbor layer falls back to the public Carto CDN (may be rate-limited).

### 5. Open the app

1. Wait for the deploy to finish (green).
2. Open the public URL (`*.up.railway.app`), or **Settings → Networking → Generate domain**.
3. `/` — live map (LIFE AT SEA is bootstrapped automatically).
4. `/admin` — paste the same `LOCAL_ADMIN_TOKEN`, save, manage vessels.
5. `/adventures` — season stories once tracks exist (and the offline demo vessel if you ran `npm run seed` locally; cloud boots with LIFE AT SEA only).

## Optional: Supabase later

Only if you want email login or a cloud-backed vessel list:

1. Create a project at [supabase.com](https://supabase.com).
2. SQL editor → run [`supabase/schema.sql`](supabase/schema.sql).
3. Authentication → Users → invite/create an admin.
4. Project Settings → API → copy URL, `anon` key, `service_role` key.
5. Add to Railway variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
6. Redeploy; sign in at `/admin` with that email.

## Troubleshooting

- **No vessels on the map:** confirm `AISSTREAM_API_KEY` is set and the vessel MMSI is registered/active in `/admin`.
- **Admin 401:** token in the admin UI must match `LOCAL_ADMIN_TOKEN`.
- **Tracks disappear after redeploy:** the volume must be mounted at `/data` and the app must use that path (`DATA_DIR=/data`). Check `/api/health` → `durableStorage` should be `true`. A volume that exists in the project but is not mounted (or is mounted at a different path) does **not** persist SQLite.
- **Health check:** `GET /api/health` returns storage diagnostics (`dataDir`, `durableStorage`, `trafficSpanMs`, …).

## Clubhouse kiosk (Pi)

For a display at Atlantic Highlands Yacht Club, see [README.md](README.md) (systemd + Chromium). Cloud and Pi can share the same GitHub repo; use Supabase if you want one vessel registry for both.
