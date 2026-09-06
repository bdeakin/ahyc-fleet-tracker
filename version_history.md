# Version history

## 0.9.0 — NOAA paper-style charts, noteworthy traffic, CPA

- New default chart: **NOAA chart (paper style · soundings in feet)** — ENC rendered through the Maritime Chart Service with paper-chart symbols, plain area boundaries, four depth shades at 12 / 30 / 60 ft, and labelled contours. The all-detail ENC display stays available as a second option.
- OpenSeaMap seamarks only draw at zoom ≥ 14, so buoy labels no longer cover the harbor at overview zoom.
- **Noteworthy traffic** picker with five detectors over the stored AIS window: **Interceptions** (converging vessels, flagged as pilot transfers near the Ambrose boarding area), **Suspected groundings** (hard stop where surveyed depth is close to the estimated draught), **Need for speed** (over 30 kn), **Evasive maneuvers**, and **No-wake speeding**. Selecting an event draws the tracks and fits the view.
- Chart, historical chart and noteworthy pickers now live in one always-visible panel; historical sheets can be chosen from anywhere and the map flies to their coverage.
- Stacked vessel cards show **CPA** and **TCPA**, highlighted when the pair closes inside 0.15 nm within 15 minutes.
- Implausible AIS speeds (≥ 70 kn, including the 102.3 "not available" sentinel) are ignored by the speed detector.
- Fixed: the vessel tray no longer swallows mouse drags on the map next to the cards; only the cards themselves take pointer events.
- Removed the empty **Season adventures** dropdown from the kiosk (the `/adventures` route is unchanged).
- No-wake pockets now require several *different* vessels sitting still, so a single moored or aground boat cannot create one.

## 0.8.14 — Historical charts dropdown (viewport-aware)

- When the map view overlaps a chart’s coverage, a **Historical chart** dropdown appears.
- Sheets replace the modern basemap: **1646** Dudley eastern seaboard (regional zoom), **1776** Entrance of Hudson’s River, **1845**, **1895**, and **1910** NY Bay & Harbor.
- Choose **Modern map** to restore Carto / NOAA / ocean layers.

## 0.8.13 — Durable Railway volume path + storage health

- Prefer `RAILWAY_VOLUME_MOUNT_PATH` for SQLite so redeploys keep track history when a volume is attached.
- `/api/health` reports `dataDir`, mount detection, and `durableStorage` so operators can verify persistence.

## 0.8.12 — Carto Voyager API key for harbor basemap

- Harbor chart layer uses `CARTO_API_KEY` when set: `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=…`.
- Without the key, falls back to the public `{s}.basemaps.cartocdn.com` CDN.

## 0.8.11 — Last-report age counter on vessel cards

- Vessel detail pane replaces the static **Updated** timestamp with a live **Last report** up-counter (time since the latest AIS point).
- Tray cards show the same live age; hover still reveals the absolute timestamp.

## 0.8.10 — Season adventures dropdown + README/storage clarity

- Season adventures is a single dropdown of `Vessel name - year` for active club boats that have stored AIS in that calendar year (`GET /api/adventures/options`), on the kiosk and `/adventures`.
- README and architecture now state clearly that **SQLite is the vessel/track source of truth**; Supabase is optional auth/sync only.

## 0.8.9 — AIS markers, tray layout, CPA, basemap overzoom

- AIS markers: stopped vessels are circles; moving vessels are course arrows (heading/COG).
- Collision alerts: pulsing red highlight; CPA ≤ 0.1 nm within 12 min for moving/moving or moving/stopped pairs.
- Vessel tray sits to the right of AIS source / Show filters, fills left→right along the ribbon, and drops rightmost cards when the window shrinks.
- Zoom +/- moved to bottom-right (above status ribbon); tagline centered at top so it clears the legend.
- Esri Ocean overzooms past ~z13 instead of showing blank “Map data not yet available”; optional Ocean + OpenSeaMap buoys/lights layer.

## 0.8.8 — Watch list, vessel tray, AISHub region fix

- Click any vessel and **Add to watch list** in the right pane — those MMSIs keep track history indefinitely (same as club boats).
- Map filters beside AIS source: **Club boats / Watch list / All other traffic**.
- Bottom vessel tray (FIFO ~8) with speed, distance from 307 Ocean Blvd, and named waterway; collision-risk vessels get a red outline.
- Bottom ribbon shows AISHub countdown, club boats outside the NE bbox, and how far back stored AIS history goes (traffic vs club).
- AISHub: split the oversized Atlantic NE bbox into NY/NJ Mid-Atlantic + New England; retry sooner when a region returns 0 vessels (harbor was starving while Great Lakes still refreshed).

## 0.8.7 — Selectable vessel track windows (24h / 7d / 30d)

- Vessel detail pane adds **24h / 7d / 30d** track buttons under the name; the map draws whatever points are stored for that window.
- Also raises AIS source filters above the Live banner and eases clustering from zoom 9.


## 0.8.6 — AIS source panel clear of banner; lighter clustering

- Raise the AIS source checkbox panel above the Live timeline banner.
- Disable marker clustering from zoom 9 (bay scale) upward so ships stay individual at harbor overview.


## 0.8.5 — Fix blank kiosk (Leaflet maxZoom)

- Leaflet.markercluster was throwing `Map has no maxZoom specified` because `disableClusteringAtZoom` was set without `maxZoom` on the map — leaving `#root` empty.
- Map now sets `maxZoom: 18`; an ErrorBoundary shows a reload message instead of a blank page if render fails again.


## 0.8.4 — Live AIS refresh every 5s + ingest/AISStream hardening

- Kiosk polls viewport AIS every **5 seconds** so local radio traffic stays current without a full page reload.
- `/api/ais/ingest` runs each Pi batch in one SQLite transaction and emits a single `vessels` websocket notify (was 6–8s and flooded the UI).
- AISStream reconnect uses exponential backoff and tears down the prior socket (reduces tight `1006` reconnect loops); logs lived-ms hint when closes are abnormal.


## 0.8.3 — AIS source tags, region split, viewport + clustering

- Live / track rows carry `source` (`radio`, `aishub`, `aisstream`, …); kiosk can filter by Radio / AISHub / AISStream.
- AISHub polls rotating `atlantic-ne` and `great-lakes` regions instead of one huge empty bbox.
- Kiosk loads `/api/live` for the visible map area, clusters traffic when zoomed out, and limits short trails to nearby vessels when zoomed in.


## 0.8.2 — AISHub coverage includes the Great Lakes

- Expanded `NORTHEAST_BBOX` west/north to cover Lakes Superior through Ontario (with the existing Chesapeake→Maine seaboard).


## 0.8.1 — AISHub full Northeast ingest every 5 minutes

- AISHub Northeast bbox now ingests **all** returned vessels (not only club MMSIs).
- Default poll / bbox cadence is **5 minutes** (still hard-capped at AISHub’s 1/min floor).
- Club boats near/outside the perimeter still get MMSI watch slots, alternating with bbox pulls.


## 0.8.0 — AISHub Northeast bbox + outbound MMSI watch

- Optional AISHub poller (`AISHUB_USERNAME`) pulls a Chesapeake→Maine + Great Lakes bbox about every 5 minutes for club vessels.
- Club boats near/outside that perimeter are added to an MMSI watchlist and polled until they return deep inside the box (Bermuda-race style departures).
- Default poll every **5 minutes** (API floor still 5 min (API floor 1/min)). Daily Northeast bbox ingests **all** vessels, not only club MMSIs; club boats near/outside the perimeter still get MMSI watch.
- Club vessel positions may be stored outside the harbor `TRAFFIC_BBOX` so offshore tracks persist.


## 0.7.0 — Simplified ocean basemap + sailing/pleasure colors

- Default kiosk basemap is Esri Ocean Base + Ocean Reference (bathymetry shading and place names like Raritan Bay) instead of the dense full NOAA WMS chart; NOAA full chart remains selectable.
- Chart catalog supports `xyz` multi-URL layers alongside NOAA WMS and local MBTiles.
- Sailing vessels render white; pleasure craft pink (AIS-app convention). Light fills use a dark marker/legend outline.

## 0.6.1 — Vessel type colors + AHYC club stars

- Fixed marker coloring: live state now falls back to scraped vessel-class labels when AIS `shipType` is missing (production had shipType=null for all traffic → all gray).
- AIS forwarder no longer mistakes AIS message id for ship type; stamps learned type/name onto queued positions.
- Profile scrape writes inferred `ship_type` into `traffic_names` for persistent coloring.
- AHYC club vessels render with a gold ★ behind the marker.

## 0.6.0 — MMSI vessel profile scrape + cache

- On first sight of an MMSI, server scrapes public vessel particulars (VesselFinder, MyShipTracking fallback) and stores them in SQLite `vessel_profiles`.
- Subsequent sightings reuse the cache; errors retry after 6 hours.
- Kiosk detail pane shows flag, call sign, IMO, class, and dimensions when available.
- `GET /api/vessels/profile/:mmsi` (+ admin refresh POST).

## 0.5.0 — Ship-type colors + short trails + search

- AIS ship type stored on `traffic_names` and returned on live vessel state with label + marker color.
- Pi forwarder extracts ship type/name from multipart static AIS and includes `shipType` on ingest.
- Kiosk markers color-coded by type (legend on map); default 10-minute trails; click still shows 24h.
- Vessel search by name/MMSI zooms the map and opens a detail side pane.

## 0.4.0 — AIS Dispatcher harbor ingest

- `POST /api/ais/ingest` accepts batched positions from the Pi (Bearer `AIS_INGEST_TOKEN`).
- Harbor traffic filtered to NYC `TRAFFIC_BBOX`, downsampled ~60s/MMSI.
- Non-registered vessels retained 24h; registered club vessels kept indefinitely.
- Kiosk shows traffic markers; click a vessel for a 24h track polyline.
- `deploy/ais-forwarder`: Python UDP→HTTPS bridge + systemd unit for AIS Dispatcher.

## 0.3.2 — 2026-08-21

- AIS ingest: Class B extended reports, broader subscription, status endpoint
- Kiosk hint when API key missing or no positions yet

## 0.3.1 — 2026-08-21

- Wider AIS subscription bbox (NY Harbor–Long Island Sound)
- First-boot / local AISStream wiring notes

## 0.3.0 — 2026-08-21

- Dockerfile + `.dockerignore` for container builds
- `railway.toml` health check for Railway
- `deploy/CLOUD.md` phone deploy walkthrough (Supabase optional)
- Bootstrap LIFE AT SEA on empty database
- `DATA_DIR=/data` cloud defaults documented

## 0.2.0 — 2026-08-21

- Supabase vessel registry schema (`deploy/supabase/schema.sql`)
- Server sync pull/push + JWT or local-token admin auth
- Admin UI Supabase email login + “Sync from Supabase”
- `/api/config` exposes whether Supabase is configured

## 0.1.1 — 2026-08-21

- Primary club vessel: **LIFE AT SEA** (MMSI 338357109)
- Seed registers LIFE AT SEA as active; demo season tracks are inactive-only
- Cascade delete for vessel trips/tracks
- Adventure titles use registered vessel names without forced `SV` prefix

## 0.1.0 — 2026-08-21

- Initial monorepo: `@ahyc/web`, `@ahyc/server`, `@ahyc/shared`
- Kiosk map with NOAA WMS + chart picker + timeline scrubber
- Club-only AIS ingest worker (AISStream MMSI filter)
- Vessel admin registration (local token; Supabase-ready env)
- Adventures API + UI: season narrative, scroll title, stylized SVG map
- Demo seed for offline Adventures preview
- Pi deploy unit stubs under `deploy/`
