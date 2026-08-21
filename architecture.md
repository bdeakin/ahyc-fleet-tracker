# Architecture

## Components

- `apps/web` — React UI: kiosk map (`/`), Adventures (`/adventures`), admin registry (`/admin`).
- `apps/server` — Fastify API, AISStream ingest worker, SQLite persistence, MBTiles tile route, trip detection + narrative builder, optional Supabase sync.
- `packages/shared` — shared TypeScript types and helpers (AHYC center, NOAA WMS URL, adventure title).
- `deploy/` — Pi systemd/kiosk scripts and Supabase SQL schema.

## Data flow

1. Admins register club vessels (name, MMSI, color) via `/admin` (Supabase auth when configured, else local admin token).
2. When Supabase is configured, vessel rows live in the cloud `vessels` table; the Pi pulls them into SQLite every 5 minutes and pushes local mutations upstream.
3. AIS worker subscribes to AISStream with `FiltersShipMMSI` = active club MMSIs only (no general traffic).
4. Positions are downsampled into `track_points` and mirrored in `vessel_state` for live kiosk markers.
5. Timeline scrubbing uses `/api/tracks` and `/api/tracks/replay`.
6. Adventures recomputes trips for a vessel/season, builds prose, and returns track geometries for the stylized map.

## Season model

- Default season window: April 1 – October 31 (`SEASON_START` / `SEASON_END`).
- Home waters for trip start/end: `HOME_LAT` / `HOME_LON` / `HOME_RADIUS_NM` around AHYC.

## Charts

- Default operational basemap: NOAA Chart Display Service WMS.
- Optional offline: MBTiles files in `data/charts`, served as XYZ with TMS→XYZ conversion.

## Auth

- **Supabase:** email/password session; browser sends access token as `Authorization: Bearer …`; server validates with `auth.getUser`.
- **Local fallback:** `LOCAL_ADMIN_TOKEN` for kiosk/dev when Supabase is unset.
- Tracks always stay on the Pi SQLite database (not in Supabase).
