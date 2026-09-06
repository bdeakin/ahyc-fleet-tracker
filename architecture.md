# Architecture

## Components

- `apps/web` — React UI: kiosk map (`/`), Adventures (`/adventures`), admin registry (`/admin`).
- `apps/server` — Fastify API, AISStream ingest worker, AISHub poller, SQLite persistence, MBTiles tile route, trip detection + narrative builder, optional Supabase sync.
- `packages/shared` — shared TypeScript types and helpers (AHYC center, Esri ocean + NOAA WMS URLs, adventure title, AIS ship-type labels/colors, `AisSource` tags, AISHub regions).
- `deploy/` — Pi systemd/kiosk scripts, AIS Dispatcher forwarder, Supabase SQL schema, Railway phone deploy guide.
- `Dockerfile` + `railway.toml` — container build for Railway (or any Docker host).

## Deployment targets

- **Railway (phone-friendly):** always-on Node service with a volume mounted at `/data` for SQLite (redeploy-safe when `DATA_DIR` / `RAILWAY_VOLUME_MOUNT_PATH` points at that mount). Chart tiles over the network. See `deploy/CLOUD.md`. `/api/health` reports `durableStorage`.
- **Raspberry Pi kiosk:** same app + Chromium `--kiosk`. See `deploy/README.md`.

## AIS sources

Each live fix and track point may carry `source`:

| Tag | Feed |
| --- | --- |
| `radio` | Pi AIS Dispatcher → `POST /api/ais/ingest` |
| `aishub` | AISHub Northeast / Great Lakes poller |
| `aisstream` | AISStream WebSocket worker |
| `vesselfinder` | Reserved for a future API fallback |
| `unknown` | Legacy rows or untagged ingest |

Kiosk checkboxes filter markers by source (Radio / AISHub / AISStream).

## AISHub (optional)

- Env: `AISHUB_USERNAME` on Railway.
- Rotating bbox regions in `AISHUB_REGIONS`: `atlantic-ne` (Chesapeake→Maine) and `great-lakes` (Superior→Ontario). Union `NORTHEAST_BBOX` is used for perimeter / watch hysteresis.
- Perimeter watch: club boats near/outside the union box are stored in SQLite `aishub_watch` and queried via the AISHub `mmsi=` parameter until `deepInsideBbox`.
- Rate limit: one HTTP request every 5 minutes by default (API floor: 1/min); bbox region rotation + MMSI share a single scheduler.
- Status: `GET /api/aishub/status` (`lastFetched`, `lastIngested`, `lastRegion`, …).

## Kiosk map performance

- `GET /api/live?minLat&minLon&maxLat&maxLon` returns vessels in the padded viewport (club registry boats still included when outside the box for search/fly-to data).
- Traffic markers use Leaflet.markercluster (clusters only when zoomed out past bay scale (individual from zoom 9) (map maxZoom required by markercluster)); AHYC club markers stay on a separate unclustered layer.
- Kiosk refreshes viewport AIS every 5 seconds. Short 10-minute trails load only for visible / club vessels when zoom ≥ 11 (capped), via `/api/tracks?mmsis=…`; selected vessel still gets a 24h track.

## Data flow

1. Admins register club vessels (name, MMSI, color) via `/admin`. **SQLite is the source of truth** for the registry, tracks, watch list, and trips (`$DATA_DIR/db/ahyc.sqlite`).
2. When Supabase is configured (optional), the service can sync the cloud `vessels` table into SQLite on a timer and push local mutations upstream — AIS filtering always reads from SQLite.
3. Optional AISStream worker can still subscribe with `FiltersShipMMSI` = active club MMSIs (cloud fallback).
4. Primary harbor feed: Pi **AIS Dispatcher** UDP → `deploy/ais-forwarder` → `POST /api/ais/ingest` (Bearer `AIS_INGEST_TOKEN`). Forwarder assembles multipart AIVDM, caches vessel name + ITU ship type from static messages, and batches positions. Server filters to `TRAFFIC_BBOX`, downsamples to ~60s/MMSI, stores live + tracks + optional `traffic_names.ship_type`, tagged `source=radio`.
5. Optional AISHub worker tags ingest `source=aishub`; AISStream tags `source=aisstream`.
6. Retention: non-registered traffic pruned after `TRAFFIC_RETENTION_HOURS` (default 24h); registered club MMSIs and `watched_vessels` MMSIs kept indefinitely.
7. Kiosk watch list: `GET/POST/DELETE /api/watchlist`; live state includes `watched`; category filters sit beside AIS source filters.
8. Season adventures dropdown: `GET /api/adventures/options` returns active club vessels × calendar years that have stored AIS (`Vessel name - year`); `/adventures/:vesselId/:year` builds the narrative.
9. AISHub polls smaller regions (NY/NJ Mid-Atlantic, New England, Great Lakes); empty replies retry ~65s so harbor coverage is not starved by the lakes rotation.
10. First sight of an MMSI queues a public profile scrape (VesselFinder → MyShipTracking fallback); results persist in `vessel_profiles` and are shown in the kiosk detail pane.
10b. Clicking a vessel also asks `GET /api/vessels/photo/:mmsi` for a photo (`apps/server/src/vesselPhotos.ts`): VesselFinder ship page (MMSI-keyed) → Wikidata by IMO → Wikimedia Commons by name, the last only when the vessel name appears verbatim in the file title. Results and image bytes are held in process memory only — nothing is written to SQLite or disk — and the pane loads the image through `GET /api/vessels/photo/:mmsi/image` so the kiosk stays single-origin and hotlink referers are set server-side.
10ba. The kiosk collapses to a phone layout below 760 px: `.drawer--left` (chart/event pickers, legend, filters, tray) and `.drawer--right` (search, vessel card) are `display: contents` above the breakpoint and fixed edge drawers below it, toggled by `.mobile-tabs`. The status ribbon folds via `timeline--collapsed`.
10bb. Historical charts are served as tiles: `GET /api/historical/:id/{z}/{x}/{y}.webp` (`apps/server/src/historicalTiles.ts`). Each scan is reprojected from its lat/lon georeference into Web Mercator one tile row at a time, shallower levels are built by merging 2x2 tiles, and pyramids are cached under `$DATA_DIR/historical-tiles/` (git-ignored, rebuilt on demand) and keyed to the chart's bounding box so a corrected georeference re-cuts them and warmed in the background at boot. The kiosk adds them with `minNativeZoom`/`maxNativeZoom` from `historicalNativeZoom()` in `@ahyc/shared`, with the paper underlay in a pane below the tile pane.
10c. `GET /api/live` accepts `pinned=<mmsi,…>`, returning those vessels regardless of the viewport box so tray cards and the open detail pane keep updating after the map flies elsewhere.
10e. All map tracks are drawn through `drawTrack()` in `KioskPage.tsx`: a near-black casing 1.6 px wider than the line, then the coloured line, so white sailing trails stay visible over land and pale chart fills. Speed-coloured runs take a single `addTrackCasing()` under the whole run.
10d. Club boats are marked with the AHYC burgee (`apps/web/src/burgee.ts`), an SVG string (pennant, wedge, hoist stars, and red club letters set on the wedge's taper) shared by the Leaflet `divIcon` markers and the `BurgeeGlyph` component used in the legend, search results, and detail-pane heading. The marker offset is derived from each marker's own height so the flag clears both the moving arrow and the stopped circle.
11. Kiosk colors traffic markers by AIS ship type or scraped class label (club vessels keep registry colors and fly the club burgee); live view loads AIS for the current map area, clusters when zoomed out, and draws short trails when zoomed in; click or search a vessel to zoom, open a detail pane (live **Last report** age since latest AIS), and choose a 24h / 7d / 30d track from stored history.
12. Timeline scrubbing uses `/api/tracks` and `/api/tracks/replay`.
13. Adventures recomputes trips for a vessel/season, builds prose, and returns track geometries for the stylized map.

## Season model

- Default season window: April 1 – October 31 (`SEASON_START` / `SEASON_END`).
- Home waters for trip start/end: `HOME_LAT` / `HOME_LON` / `HOME_RADIUS_NM` around AHYC.

## Charts

- Default chart: **NOAA chart (paper style)** — ENC data rendered by NOAA's Maritime Chart Service WMS (`NOAA_CHART_WMS`) with the S-52 mariner settings in `NOAA_PAPER_CHART_PARAMS`: display categories `DISPLAYBASE,STANDARD` only (view groups 0–7), paper-chart point symbols, plain area boundaries, four depth shades at 3.6 / 9.1 / 18.3 m (12 / 30 / 60 ft), soundings and contour labels in feet. NOAA retired its raster charts, so this is the closest live equivalent of a paper sheet.
- Alternate operational basemap: **Carto Voyager** (sharp coast/place names through harbor zoom) + OpenSeaMap seamarks for buoys/lights. Set `CARTO_API_KEY` so tiles use `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=…`; without it, the public `{s}.basemaps.cartocdn.com` CDN is used.
- **Historical charts:** when the viewport overlaps coverage, a dropdown offers public-domain sheets as Leaflet `imageOverlay` basemap replacements — Dudley **1646** eastern seaboard (regional zoom), **1776** Hudson entrance, and **1845 / 1895 / 1910** NY Bay (`packages/shared` `HISTORICAL_CHARTS`, assets under `apps/web/public/historical-charts/`).
- Regional overview: Esri World Ocean Base + Ocean Reference (bathymetry). Native zoom capped (~z13) with Leaflet overzoom; optional OpenSeaMap seamark overlay.
- OpenSeaMap seamark tiles carry baked-in labels, so those overlays set `minZoom: 14` (`ChartTileUrl.minZoom`).
- The full ENC display (all view groups, default S-52 settings) remains selectable as **NOAA chart (all detail)**.
- Optional offline: MBTiles files in `data/charts`, served as XYZ with TMS→XYZ conversion (Pi).
- `ChartLayer` kinds: `xyz` (one or more tile URL templates), `noaa-wms` (optional `layers` / `params` / `transparent`), `mbtiles`.

## Noteworthy traffic

- `GET /api/noteworthy?hours=` (default 24, max 72) walks every stored fix in the window and caches the bundle for 3 minutes (`apps/server/src/noteworthy.ts`).
- Detectors live in `packages/shared/src/noteworthyTraffic.ts`:
  - `detectInterceptions` — pairs that close from ≥ 0.6 nm to ≤ 0.12 nm; marked `pilotTransfer` when either vessel is a pilot boat (AIS type 50 or name) and the two matched course or met inside `PILOT_BOARDING_AREAS` (Ambrose, Sandy Hook).
  - `detectSuddenStops` + `gradeGrounding` — making way to stopped inside one report, stays put ≥ 12 min, in a cell where no other traffic stops. Draught is estimated (`estimateDraughtM`, AIS static draught is not in our feeds); depth comes from the NOAA NCEI DEM mosaic `identify` endpoint, cached in SQLite `depth_samples` per ~100 m cell (≤ 12 lookups per rebuild). Under-keel clearance ≤ 0.5 m reads *likely*, ≤ 1.5 m *possible*, more is discarded.
  - `detectSpeedRuns` — two or more consecutive fixes over `SPEED_RUN_KN` (30 kn). `plausibleSog` drops ≥ `IMPLAUSIBLE_SOG_KN` (70) so AIS decode errors and the 102.3 sentinel are never reported.
  - `detectEvasiveManeuvers`, `detectNoWakeSpeeding` — pre-existing; no-wake pockets now require stopped fixes from more than one vessel.
- The kiosk picker draws the selected event (both tracks for an interception, speed-coloured segments for speed / no-wake runs) and flies to its bounds.

## Auth

- **SQLite** holds the vessel registry and all track data (`$DATA_DIR/db/ahyc.sqlite`). Supabase never replaces local tracks.
- **Local admin (default path):** `LOCAL_ADMIN_TOKEN` Bearer secret for `/admin` and mutating APIs when Supabase is unset. Production rejects the insecure `dev-admin-token` default unless `ALLOW_INSECURE_ADMIN=1`.
- **Supabase (optional):** email/password session; browser sends access token as `Authorization: Bearer …`; server validates with `auth.getUser`. Can also sync the cloud `vessels` table into SQLite.

- Kiosk tray cards can be stacked via HTML5 drag/drop; `relativeVesselNav` in `@ahyc/shared` computes distance, true bearings, COG, relative bearings, and `cpaBetween` adds CPA / TCPA (vessels without usable COG/SOG count as stationary). Only the card stacks take pointer events — the tray row itself spans the measurable width and must stay draggable as map. Tray + detail pane show a live last-report age counter from each vessel’s latest `ts`.
- In-app help overlay documents filters, watch list, stacking, and track controls.
