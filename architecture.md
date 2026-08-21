# Architecture

## Components

- `apps/web` — React UI: kiosk map (`/`), Adventures (`/adventures`), admin registry (`/admin`).
- `apps/server` — Fastify API, AISStream ingest worker, SQLite persistence, MBTiles tile route, trip detection + narrative builder.
- `packages/shared` — shared TypeScript types and helpers (AHYC center, NOAA WMS URL, adventure title).

## Data flow

1. Admins register club vessels (name, MMSI, color) via `/admin`.
2. AIS worker subscribes to AISStream with `FiltersShipMMSI` = active club MMSIs only (no general traffic).
3. Positions are downsampled into `track_points` and mirrored in `vessel_state` for live kiosk markers.
4. Timeline scrubbing uses `/api/tracks` and `/api/tracks/replay`.
5. Adventures recomputes trips for a vessel/season, builds prose, and returns track geometries for the stylized map.

## Season model

- Default season window: April 1 – October 31 (`SEASON_START` / `SEASON_END`).
- Home waters for trip start/end: `HOME_LAT` / `HOME_LON` / `HOME_RADIUS_NM` around AHYC.

## Charts

- Default operational basemap: NOAA Chart Display Service WMS.
- Optional offline: MBTiles files in `data/charts`, served as XYZ with TMS→XYZ conversion.
