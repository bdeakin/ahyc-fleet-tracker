# Atlantic Highlands Yacht Club Map Kiosk

Web kiosk for AHYC sailing grounds: readable charts, **club vessels + harbor AIS**, local track storage/replay, a watch list, and seasonal **Adventures** narratives with a stylized nautical map.

**Version:** 0.8.9

## What it does

| Surface | Purpose |
| --- | --- |
| **`/` — Kiosk map** | Live AIS on Esri Ocean / optional NOAA charts; source + category filters; vessel search, detail pane, track windows, tray, CPA alerts |
| **`/adventures` — Season adventures** | Dropdown of `Vessel name - year` for club boats that have stored AIS; narrative + artistic season map |
| **`/admin` — Registry** | Register / remove club vessels (admin auth required) |

### Kiosk highlights

- **AIS feeds:** Pi radio ingest, AISHub (Northeast + Great Lakes), AISStream — filterable on the map
- **Categories:** Club boats / Watch list / All other traffic
- **Watch list:** Keep indefinite track history for non-club MMSIs (admin-authenticated add/remove)
- **Tracks:** 24h / 7d / 30d windows from whatever SQLite still holds
- **Tray:** Recent selections with speed, distance from home waters, and a named waterway
- **CPA:** Pulsing highlight when closing tracks pass within ~0.1 nm (tuned to avoid docked false alarms)
- **Markers:** Circles when stopped, course arrows when moving; club boats keep registry color + star

### Data model (important)

**SQLite is the source of truth** for:

- Club vessel registry
- Live vessel state + track points
- Watch list
- Trips / adventure inputs
- AISHub perimeter watch + scraped vessel profiles

Database file: `$DATA_DIR/db/ahyc.sqlite` (local default `./data/db/ahyc.sqlite`; Railway volume typically `/data`).

**Supabase is optional** — only for admin email login and *optional* cloud registry sync. You can run the whole stack with SQLite + a `LOCAL_ADMIN_TOKEN` and never configure Supabase.

## Stack

- **Frontend:** React + Vite + TypeScript + Leaflet (`apps/web`)
- **Backend:** Node.js + Fastify + better-sqlite3 (`apps/server`)
- **Shared types/helpers:** `packages/shared`
- **AIS:** AISStream WebSocket, AISHub HTTP poller, Pi AIS Dispatcher → `POST /api/ais/ingest`
- **Charts:** Esri Ocean (+ optional OpenSeaMap seamarks), NOAA Chart Display WMS, optional local MBTiles
- **Auth:** `LOCAL_ADMIN_TOKEN` Bearer token, or Supabase email session when configured

## Deploy from your phone (Railway)

**Supabase is not required.** Follow **[`deploy/CLOUD.md`](deploy/CLOUD.md)** — Railway + AISStream API key + strong admin token + volume at `/data`.

Optional: set `AISHUB_USERNAME` for wider Northeast / Great Lakes coverage; set `AIS_INGEST_TOKEN` if a Pi forwarder will push local radio traffic. The AISHub username is earned by feeding them a receiver — antenna to account in **[`deploy/AISHUB.md`](deploy/AISHUB.md)**.

## Quick start (laptop)

```bash
cp .env.example .env
# Set at least LOCAL_ADMIN_TOKEN (and AISSTREAM_API_KEY for live positions)
npm install
npm run build
npm run seed
npm run dev:server
# other terminal
npm run dev:web
```

Open http://localhost:5173 — kiosk map, Season adventures dropdown / `/adventures`, `/admin` to register vessels.

Default local admin token in `.env.example`: `dev-admin-token` (change this for any shared or production host; production rejects that insecure default unless `ALLOW_INSECURE_ADMIN=1`).

## Season adventures

Season window defaults to **April 1 – October 31** (`SEASON_START` / `SEASON_END`).

The **Season adventures** control (kiosk + `/adventures`) lists entries as **`Vessel name - year`** for each **active club vessel** that has stored AIS traffic in that calendar year (`GET /api/adventures/options`). Choosing a row opens the narrative page for that vessel/season.

Title example: **The 2026 Adventures of the LIFE AT SEA**. Tracks are segmented into trips and turned into prose plus an artistic SVG map (not the operational chart).

## Admin & vessel registry

1. Open `/admin`.
2. Sign in with the local admin token (saved in the browser) **or** Supabase email/password when `SUPABASE_*` is set.
3. Register club boats by name + MMSI (+ optional sail number / color).

Mutations (register/remove vessel, watch-list add/remove, registry sync) require a valid admin Bearer token. The public kiosk stays read-only for those actions.

### Optional Supabase sync

If you want cloud backup / multi-device admin auth:

1. Create a project at [supabase.com](https://supabase.com).
2. Run [`deploy/supabase/schema.sql`](deploy/supabase/schema.sql) in the SQL editor.
3. Enable Email auth and create an admin user.
4. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
5. Restart the server; sign in at `/admin`. The service can sync the cloud `vessels` table **into** local SQLite (AIS filtering always uses SQLite).

## MBTiles

Download a regional pack from [NCDS MBTiles Download](https://distribution.charts.noaa.gov/ncds/index.html) into `data/charts/*.mbtiles`. It appears in the kiosk chart picker and is served from the charts API.

## Raspberry Pi

See [`deploy/README.md`](deploy/README.md) for systemd units, Chromium kiosk autostart, and the AIS Dispatcher forwarder. Same SQLite data directory model as Railway; Supabase remains optional.

## Useful docs

| Doc | Contents |
| --- | --- |
| [`architecture.md`](architecture.md) | Components, AIS sources, auth, data flow |
| [`version_history.md`](version_history.md) | Release notes |
| [`development_narrative.md`](development_narrative.md) | Design decisions over time |
| [`deploy/CLOUD.md`](deploy/CLOUD.md) | Railway phone deploy |
| [`deploy/README.md`](deploy/README.md) | Pi kiosk deploy |
