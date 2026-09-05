# Architecture

## Components

- `apps/web` — React UI: kiosk map (`/`), Adventures (`/adventures`), admin registry (`/admin`).
- `apps/server` — Fastify API, AISStream ingest worker, SQLite persistence, MBTiles tile route, trip detection + narrative builder, optional Supabase sync.
- `packages/shared` — shared TypeScript types and helpers (AHYC center, NOAA WMS URL, adventure title, AIS ship-type labels/colors).
- `deploy/` — Pi systemd/kiosk scripts, AIS Dispatcher forwarder, Supabase SQL schema, Railway phone deploy guide.
- `Dockerfile` + `railway.toml` — container build for Railway (or any Docker host).

## Deployment targets

- **Railway (phone-friendly):** always-on Node service, volume at `/data` for SQLite, NOAA WMS over the network. See `deploy/CLOUD.md`.
- **Raspberry Pi kiosk:** same app + Chromium `--kiosk`. See `deploy/README.md`.

## Data flow

1. Admins register club vessels (name, MMSI, color) via `/admin` (Supabase auth when configured, else local admin token).
2. When Supabase is configured, vessel rows live in the cloud `vessels` table; the service pulls them into SQLite every 5 minutes and pushes local mutations upstream.
3. Optional AISStream worker can still subscribe with `FiltersShipMMSI` = active club MMSIs (cloud fallback).
4. Primary harbor feed: Pi **AIS Dispatcher** UDP → `deploy/ais-forwarder` → `POST /api/ais/ingest` (Bearer `AIS_INGEST_TOKEN`). Forwarder assembles multipart AIVDM, caches vessel name + ITU ship type from static messages, and batches positions. Server filters to `TRAFFIC_BBOX`, downsamples to ~60s/MMSI, stores live + tracks + optional `traffic_names.ship_type`.
5. Retention: non-registered traffic pruned after `TRAFFIC_RETENTION_HOURS` (default 24h); registered club MMSIs kept indefinitely.
6. Kiosk colors traffic markers by AIS ship type (club vessels keep registry colors); live view draws a 10-minute trail per vessel; click or search a vessel to zoom, open a detail pane, and draw a 24h track.
7. Timeline scrubbing uses `/api/tracks` and `/api/tracks/replay`.
8. Adventures recomputes trips for a vessel/season, builds prose, and returns track geometries for the stylized map.

## Season model

- Default season window: April 1 – October 31 (`SEASON_START` / `SEASON_END`).
- Home waters for trip start/end: `HOME_LAT` / `HOME_LON` / `HOME_RADIUS_NM` around AHYC.

## Charts

- Default operational basemap: NOAA Chart Display Service WMS.
- Optional offline: MBTiles files in `data/charts`, served as XYZ with TMS→XYZ conversion (Pi).

## Auth

- **Supabase:** email/password session; browser sends access token as `Authorization: Bearer …`; server validates with `auth.getUser`.
- **Local fallback:** `LOCAL_ADMIN_TOKEN` for kiosk/dev/cloud when Supabase is unset.
- Tracks always stay in SQLite (`DATA_DIR`), not in Supabase.
