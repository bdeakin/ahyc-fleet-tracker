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
10bb. Historical charts are served as tiles: `GET /api/historical/:id/{z}/{x}/{y}.webp` (`apps/server/src/historicalTiles.ts`). Each scan is reprojected from its lat/lon georeference into Web Mercator one tile row at a time, shallower levels are built by merging 2x2 tiles, and pyramids are cached under `$DATA_DIR/historical-tiles/` (git-ignored, rebuilt on demand) and keyed to the chart's bounding box so a corrected georeference re-cuts them and warmed in the background at boot. The Docker build cuts every pyramid up front (`apps/server/src/tools/cutTiles.ts`) and ships it as a read-only seed at `HISTORICAL_TILE_SEED_DIR`, which tile reads check alongside the volume — a production container therefore never runs libvips, and sharp is imported lazily so its ~30 MB is not resident either. The kiosk adds them with `minNativeZoom`/`maxNativeZoom` from `historicalNativeZoom()` in `@ahyc/shared`, with the paper underlay in a pane below the tile pane.
10c. `GET /api/live` accepts `pinned=<mmsi,…>`, returning those vessels regardless of the viewport box so tray cards and the open detail pane keep updating after the map flies elsewhere.
10e. All map tracks are drawn through `drawTrack()` in `KioskPage.tsx`: a near-black casing 1.6 px wider than the line, then the coloured line, so white sailing trails stay visible over land and pale chart fills. Speed-coloured runs take a single `addTrackCasing()` under the whole run.
10d. Club boat markers are drawn in the burgee's colours as three nested bands (`clubShapeSvg()` in `KioskPage.tsx`): red core, white, blue outside, edged in near-black — a roundel when stopped, the course arrow when moving. The legend's club swatch mirrors it. The AHYC burgee (`apps/web/src/burgee.ts` — pennant, wedge, hoist stars, and red club letters set on the wedge's taper) is not drawn on the chart; the `BurgeeGlyph` component marks club boats on the tray cards, the detail-pane heading, and the search results.
10f. `locateMe()` in `KioskPage.tsx` snaps the chart to the viewer: one `navigator.geolocation.getCurrentPosition` fix per press (high accuracy, 10 s timeout, 30 s max age), a dot plus accuracy circle in `userLayerRef`, `flyTo` at `max(currentZoom, 15)`, and a self-clearing read-out for both the fix and each failure mode. Requires a secure context, which Railway serves.
10g. Deploy contract: the image entrypoint is `node apps/server/dist/index.js` (npm swallows SIGTERM and exits non-zero, which reads as a crash); SIGTERM/SIGINT close the workers, Fastify, and SQLite, then exit 0 within 8 s. Boot work is wrapped — on failure the server still listens and `/api/health` returns 503 with `bootError`. The health payload's storage diagnostics come from a background snapshot (60 s TTL), never a query on the request path. Historical tile warmup runs 45 s after listen with `sharp.concurrency(1)`, and `HISTORICAL_TILE_WARMUP=0` disables it.
10h. `ensureSeedWatchlist()` in `apps/server/src/bootstrap.ts` seeds watch-list entries (currently AMERICAN PRINCESS, 367124840) on boot, once per MMSI, marked in the `settings` table so a manual removal is not undone by the next deploy. Watch-list writes require an admin session; the kiosk now reports a 401 instead of swallowing it.
10i. Markers carry the age of their fix (`stalenessOpacity()` in `KioskPage.tsx`): full opacity for the first `STALE_FADE_START_MS` (10 min), easing to 0.22 by `STALE_HIDE_MS` (60 min), after which the vessel is not drawn, gets no short trail, and is excluded from the "in view" count and collision-risk pairs. It stays in `liveVessels`, so search, tray cards and the "last report" counter still have it. A 30 s interval re-applies opacity to the markers in `fadingMarkersRef` and redraws only when one crosses the hour, so the fade continues when the AIS feed stops rather than freezing at whatever the last refresh drew.
11. Kiosk colors traffic markers by AIS ship type or scraped class label (club vessels keep registry colors and fly the club burgee); live view loads AIS for the current map area, clusters when zoomed out, and draws short trails when zoomed in; click or search a vessel to zoom, open a detail pane (live **Last report** age since latest AIS), and choose a 24h / 7d / 30d track from stored history.
12. Timeline scrubbing uses `/api/tracks` and `/api/tracks/replay`.
12c. Replay draws positions from `/api/tracks/replay?at=` for everything, and a track for the selected vessel only (its chosen 24 h / 7 d / 30 d range ending at the playhead) — live mode's fifty short trails are deliberately not drawn, because scrubbing is for following one vessel. The selection persists across slider moves and `focusVessel()` does not force live mode, so a vessel can be picked mid-replay; its detail pane reads from the replay states and so describes the playhead. `markerClockRef` holds the clock a fix's age is measured against — null for the wall clock, the playhead in replay — so `drawMarkers()` and the `formatElapsedSince` counters on cards stay consistent no matter which effect triggers the redraw, and the 30 s fade ticker sits out replay because a historical position does not age while displayed. The timeline window (`HOURS` = 48) is longer than traffic retention (24 h), so an empty `positionsAt` result sets `replayEmpty` and the ribbon says so rather than showing a blank chart.
12d. `positionsAt(db, at, include)` takes each vessel's newest fix in the hour before `at` (`REPLAY_LOOKBACK_MS`, matching the kiosk's `STALE_HIDE_MS`) ordered by recency under `REPLAY_VESSEL_CAP` = 600, so the cap goes to vessels that were reporting rather than to an arbitrary slice of every MMSI stored. `/api/tracks/replay?mmsi=` adds vessels from full history regardless of that window — the kiosk passes the selection, so a highlighted vessel always has a position. It is also exempt from `STALE_HIDE_MS` in `drawMarkers()` and floored at `STALE_MIN_OPACITY`, and carries `vessel-marker--selected` (a steady ring; the pulsing red one means collision risk). Marker drawing reads the selection from `selectedMmsiRef` because the live refresh interval holds an older render's closure.
12a. Memory contract for track reads (`queryTracks` in `apps/server/src/tracks.ts`): every query groups fixes into `span / pointsPerVessel` buckets and returns one fix per vessel per bucket under a row cap — 12 000 for a named vessel, 24 000 for a list of them or for the whole window — with coordinates rounded to five decimals (~1 m, better than AIS reports). Short trails and 24 h tracks are unaffected at the 60 s ingest cadence; month-long and all-traffic views coarsen instead of returning millions of points. `positionsAt` returns at most 600 vessels plus any explicitly requested.
12b. Container memory contract: `apps/server/bin/start.sh` reads the cgroup limit and caps V8's old space at 45 % of it (128–1024 MB, 256 MB when no limit is visible), the image sets `MALLOC_ARENA_MAX=2`, SQLite runs on a 4 MB page cache with `temp_store=FILE` and a 16 MB soft heap limit, and production logs at `warn` so per-request lines are not allocated. In-memory caches are bounded: vessel photos by bytes (8 MB), photo metadata by count (500), noteworthy bundles to 4 windows, and noteworthy rebuilds run one at a time. `/api/health` reports RSS, heap used/total, external bytes, and the heap limit.
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

- `GET /api/noteworthy?hours=` (default 24, max 72) caches the bundle for 3 minutes (`apps/server/src/noteworthy.ts`). Fixes are thinned to one per vessel per 15 s and capped at 60 000, newest first, and the scan is narrowed to roughly the span that will survive the cap — a day of raw fixes does not fit in a small container.
- Detectors live in `packages/shared/src/noteworthyTraffic.ts`:
  - `detectInterceptions` — pairs that close from ≥ 0.6 nm to ≤ 0.12 nm; marked `pilotTransfer` when either vessel is a pilot boat (AIS type 50 or name) and the two matched course or met inside `PILOT_BOARDING_AREAS` (Ambrose, Sandy Hook).
  - `detectSuddenStops` + `gradeGrounding` — making way to stopped inside one report, stays put ≥ 12 min, in a cell where no other traffic stops. Draught is estimated (`estimateDraughtM`, AIS static draught is not in our feeds); depth comes from the NOAA NCEI DEM mosaic `identify` endpoint, cached in SQLite `depth_samples` per ~100 m cell (≤ 12 lookups per rebuild). Under-keel clearance ≤ 0.5 m reads *likely*, ≤ 1.5 m *possible*, more is discarded.
  - `detectSpeedRuns` — two or more consecutive fixes over `SPEED_RUN_KN` (30 kn). `plausibleSog` drops ≥ `IMPLAUSIBLE_SOG_KN` (70) so AIS decode errors and the 102.3 sentinel are never reported.
  - `detectEvasiveManeuvers`, `detectNoWakeSpeeding` — pre-existing; no-wake pockets now require stopped fixes from more than one vessel. Nearby vessels come from a minute/grid index rather than a walk over every other track, and only the strongest `EVASIVE_CANDIDATE_CAP` turns get a track and nearby list built.
- The kiosk picker draws the selected event (both tracks for an interception, speed-coloured segments for speed / no-wake runs) and flies to its bounds.

## Auth

- **SQLite** holds the vessel registry and all track data (`$DATA_DIR/db/ahyc.sqlite`). Supabase never replaces local tracks.
- **Local admin (default path):** `LOCAL_ADMIN_TOKEN` Bearer secret for `/admin` and mutating APIs when Supabase is unset. Production rejects the insecure `dev-admin-token` default unless `ALLOW_INSECURE_ADMIN=1`.
- **Supabase (optional):** email/password session; browser sends access token as `Authorization: Bearer …`; server validates with `auth.getUser`. Can also sync the cloud `vessels` table into SQLite.

- Kiosk tray cards can be stacked via HTML5 drag/drop; `relativeVesselNav` in `@ahyc/shared` computes distance, true bearings, COG, relative bearings, and `cpaBetween` adds CPA / TCPA (vessels without usable COG/SOG count as stationary). Only the card stacks take pointer events — the tray row itself spans the measurable width and must stay draggable as map. Tray + detail pane show a live last-report age counter from each vessel’s latest `ts`.
- In-app help overlay documents filters, watch list, stacking, and track controls.
