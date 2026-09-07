# Prompts

## Product framing

Build a yacht-club kiosk for Atlantic Highlands Yacht Club that shows local sailing grounds on a readable chart (simplified ocean depth + place names by default; full NOAA WMS optional), overlays **registered club vessels** and harbor AIS traffic, stores tracks locally for timeline replay, and offers a seasonal Adventures page with narrative prose and a stylized artistic nautical map titled like “The 2026 Adventures of the LIFE AT SEA”.

## Constraints

- Railway volume at `/data` + `DATA_DIR=/data` (or `RAILWAY_VOLUME_MOUNT_PATH`) so SQLite tracks survive redeploys; `/api/health` reports `durableStorage`
- Prefer local responsiveness (MBTiles + SQLite on Pi)
- AIS via AISStream API, not website scraping
- Season ≈ April–October; any vessel × any season with data
- Raspberry Pi capable; Railway for phone-friendly cloud deploy
- Supabase optional for admin auth + vessel registry sync
- Must run inside a small container: every stored-fix query is bucketed and capped, chart pyramids ship pre-cut in the image, in-memory caches are bounded by bytes, and V8's heap is capped from the container's own cgroup limit so a spike is collected rather than killed. `/api/health` reports `memory`.

## Known club vessels

- LIFE AT SEA — MMSI 338357109 (sailing vessel)

## AIS Dispatcher ingest (Pi → Railway)

- Dispatcher output: UDP `127.0.0.1:10110`
- Forwarder: `deploy/ais-forwarder` with `AHYC_INGEST_URL` + `AIS_INGEST_TOKEN`
- Railway: set matching `AIS_INGEST_TOKEN`; optional `TRAFFIC_RETENTION_HOURS`, `TRACK_MIN_INTERVAL_SEC`
- Product rules: traffic 24h; registered MMSIs indefinite; live 10m trails when zoomed in; click/search vessel → detail pane with 24h / 7d / 30d track buttons
- Markers color-coded by AIS ship type (sailing white, pleasure pink); club vessels are drawn in the burgee's colours (red core, white, blue outside), and the AHYC burgee itself (blue pennant, white wedge, two stars, red letters) marks their tray cards, detail pane, and search results rather than the chart
- Tracks are drawn with a thin dark casing under the coloured line so white sailing trails stay visible over white chart areas
- Crosshair button snaps the chart to the viewer's own GPS position, with an accuracy circle and distance from the club
- Kiosk search: type vessel name or MMSI to zoom and inspect (scoped to vessels loaded for the current view)
- New MMSI → one-time public profile scrape (cached in SQLite); pane shows flag / class / size when known
- Default chart: **NOAA chart (paper style)** — ENC via the Maritime Chart Service with paper symbols, plain boundaries, four depth shades (12 / 30 / 60 ft), soundings in feet. Carto Voyager harbor layer (`CARTO_API_KEY` → keyed tiles) + OpenSeaMap seamarks (zoom ≥ 14 only), Esri Ocean regional overview, and the all-detail ENC display are the other options
- One always-visible panel holds **Chart**, **Historical chart** and **Noteworthy traffic**; historical sheets (Dudley 1646, 1776 / 1845 / 1895 / 1910 harbor) can be selected from anywhere and the map flies to their coverage
- **Noteworthy traffic** (`GET /api/noteworthy?hours=`): Interceptions (converging vessels; pilot transfers near the Ambrose boarding area), Suspected groundings (hard stop where surveyed depth ≈ estimated draught, NOAA NCEI DEM), Need for speed (> 30 kn), Evasive maneuvers, No-wake speeding. Selecting an event draws its tracks and fits the view
- Speeds ≥ 70 kn are treated as AIS decode errors (102.3 = "not available") and never reported as speed runs
- Stacked tray cards show distance, bearings, COG, **CPA** and **TCPA**; the CPA row is highlighted inside 0.15 nm / 15 min
- Live AIS is viewport-scoped and refreshes every 5 seconds; map sets maxZoom for marker clustering; traffic only clusters at far overview (individual ships from bay/harbor scale); filter markers by source (Radio / AISHub / AISStream) and by category (Club boats / Watch list / All other traffic)
- Click a vessel → right pane can **Add to watch list**; drag tray cards onto each other to compare distance / bearing / COG; **?** opens in-app help
- Detail pane **Last report** (and tray cards) show a live up-counter of time since that vessel’s latest AIS point
- Click a vessel → the pane shows a **photo scraped on demand by MMSI** (VesselFinder, then Wikidata/Commons by IMO or name) with credit and licence; nothing is stored locally, and name-only matches are labelled “likely match”
- Tray cards and the open detail pane keep live-updating when the map moves away from those vessels
- On a phone, panels collapse into left/right drawers so the chart is visible; status ribbon folds
- Historical chart bounds come from each sheet's printed graticule, not estimates
- Historical charts are tiled server-side; a single scan scaled past ~10k px stops painting in the browser
- Selecting a noteworthy event gives a **replay scrubber**: play/pause plus a time slider that moves the transponders along their stored fixes
- Click a vessel → right pane can **Add to watch list** (indefinite track retention); bottom tray (right of AIS source / Show) holds as many cards as fit left→right and drops the rightmost on shrink; collision-risk contacts get a pulsing red outline (CPA ≤ 0.1 nm, moving/moving or moving/stopped)
- AIS markers: circle when stopped, course arrow when moving; zoom control bottom-right; tagline top-center
- Transponder icons fade after 10 minutes without a report and leave the chart after an hour; the vessel stays in search and on its tray card
- A fix's age is measured against whatever moment the chart shows — the clock when live, the playhead when scrubbed — for icon fades, tooltips, and the "last report" counters alike
- Scrubbed back, the chart shows positions at that moment and a track for the **selected vessel only** — never every vessel's trail, and never every vessel's whole window in one colour
- The selection follows the slider, and a vessel can be picked while scrubbed without snapping back to live
- A highlighted vessel always has a position on the chart, ringed so it can be found on its own track — faint if its last report is old, never absent
- The timeline reaches 48 h but traffic is kept 24 h; behind stored history the ribbon says so rather than showing a blank chart
- Default basemap overzooms Esri Ocean past ~z13; optional Ocean + OpenSeaMap seamarks for buoys/lights without full NOAA clutter

## AISHub (Northeast + offshore)

- Set `AISHUB_USERNAME` on Railway
- Rotating regions: Atlantic NE + Great Lakes (union used for perimeter watch)
- Poll AISHub every 5 minutes by default (never more than once per minute)
- Tag ingest `source=aishub`; status at `/api/aishub/status`
