# Version history

## 0.9.16 — Scrubbed back, only the boat you picked draws a track

- Replay drew a short trail for every vessel in view. It now draws a track for the selected vessel and nothing else: scrubbing is for following one boat, and fifty trails is still a pile of lines.
- The selection survives scrubbing. The timeline used to clear it on every move of the slider, which is why there was never a selected vessel to draw — and picking one no longer snaps back to live, so you can choose a boat mid-replay and keep the playhead where it is. Its detail pane reads at the playhead.
- Scrubbing behind stored history is explained rather than blank: the timeline covers 48 h and traffic is kept 24 h, so the ribbon says "nothing stored this far back" instead of leaving an empty chart. The ribbon otherwise says "pick a vessel for its track" while scrubbed.

## 0.9.15 — Replay stops painting the harbour green

- Scrubbing back drew every vessel's entire window as one flat teal line. On the East River with 293 ships in view that is a solid mat of lines over the chart, and it was reproduced here with 300 synthetic vessels: 300 tracks, no vessel icons, and no way to tell one ship from another.
- Replay now shows what live mode shows, measured from the playhead: positions as they were then, coloured by vessel type, with a 10-minute trail behind up to 50 of the ships in view, and trails hidden below zoom 11 exactly as live does. Verified: 50 trails in 8 colours where there had been 300 in one, and 281 icons where there had been none.
- Fixed with it: a vessel's icon disappeared as soon as you scrubbed more than an hour back, because 0.9.14's staleness rule measured a historical fix against the current time. Age is now measured against whichever clock the chart is showing, and the "last report" counter on cards follows the same clock, so a card and the chart never disagree.
- Each scrub now asks for one 10-minute window of at most 50 vessels rather than 24 hours of every vessel, which also takes the heaviest remaining query off the server.

## 0.9.14 — Stale transponders fade off the chart

- A vessel's icon is drawn at full strength for the first 10 minutes after its last AIS report, then fades steadily, and leaves the chart an hour after that report. Class A transmits every few seconds and class B every 30, so a ten-minute-old fix is already a guess and an hour-old one only says something was once there.
- The fade runs on its own 30-second clock rather than waiting for the next live refresh, so positions keep ageing honestly even when the AIS feed drops — verified with the feed blocked in the browser: markers kept fading and the expiring one left the chart with no server contact.
- Vessels off the chart are still in the app: search finds them, tray cards keep them, and the "last report" counter says how old the fix is. The hover tooltip also carries the age once a vessel has been quiet for 10 minutes.
- Short trails and the "in view" count follow the same rule, and collision-risk outlines no longer consider hour-old ghosts.

## 0.9.13 — Second pass on memory

Measured on the same 4.3 M-point database under sustained load (six clients, continuous heavy queries):

| | before this pass | after |
| --- | --- | --- |
| idle | 99 MB | 85 MB |
| peak under continuous load | 223 MB | 196 MB |
| resident once load stops | 221 MB | 195 MB |
| largest response (`/api/tracks`, 24 h) | 3.67 MB | 2.58 MB |

- V8's heap cap now comes from the container's own cgroup limit (`apps/server/bin/start.sh`, 45 % of it, clamped to 128–1024 MB) instead of a number picked by hand. A 512 MB instance gets 230 MB, a 256 MB instance gets 128 MB, and an unlimited one falls back to 256 MB.
- Coordinates are rounded in SQL — five decimals of latitude is about a metre, and AIS is nowhere near that good. That is 30 % off the biggest response for digits nothing could use.
- SQLite holds a 4 MB page cache, spills sort scratch to the volume rather than memory, and runs under a 16 MB soft heap limit. Worth 35 MB of resident memory with no measurable change in query time, because the kernel caches the file anyway.
- Noteworthy rebuilds run one at a time (each holds tens of thousands of fixes), the bundle cache keeps 4 windows rather than the 72 the route allows, and names come from a per-vessel lookup instead of a join that copied the name string onto every fix.
- The vessel photo cache is bounded by bytes (8 MB, 2 MB per photo) rather than by entry count, which allowed 96 MB; photo metadata is capped at 500 vessels rather than kept forever.
- `MALLOC_ARENA_MAX=2`: glibc gives each thread its own arena and rarely hands the memory back.
- Production logs at `warn`, so the two lines per request that nobody reads are not allocated while several kiosks poll every five seconds.
- `/api/health` `memory` now includes heap total, external bytes, and V8's real heap limit.

## 0.9.12 — Memory: the deploy that ran out of it

Measured against a 2.5 M-point database (roughly three times a busy harbour day at the 60 s ingest cadence):

| | before | after |
| --- | --- | --- |
| `GET /api/tracks` (24 h, all vessels) | 14.9 s, ~500 MB of JSON, RSS 2.3 GB | 2.0 s, 3.5 MB, peak RSS 137 MB |
| `GET /api/noteworthy?hours=24` | did not return in 10 min, RSS 930 MB | 0.44 s, peak RSS 185 MB |
| `detectEvasiveManeuvers` alone | 133 s, +700 MB | 73 ms |
| idle | 111 MB | 95 MB |
| twelve heavy requests at once | untested — one was already fatal | peak RSS 216 MB |

- Track queries thin to one fix per vessel per time bucket and stop at a row cap. Buckets are sized from the requested span, so a ten-minute trail and a 24 h vessel track are unchanged and only long windows coarsen; the all-vessel scrub, which returned every point in the window, now returns at most 24 000.
- `detectEvasiveManeuvers` looked up nearby vessels by walking every other vessel's entire track, once per turn it found. Nearby fixes are now indexed by minute and grid cell, and only the strongest few turns get a track and a nearby list built for them.
- `detectInterceptions` searched the whole day for each candidate pair; it now searches only the window where the pair actually shared a grid cell, with a sample cap.
- The noteworthy fix loader thins to one fix per vessel per 15 s, caps at 60 000 fixes, and narrows its scan to about the span that will survive the cap instead of grouping a whole day of rows and discarding most of them.
- Historical chart pyramids are cut during the Docker build and shipped in the image, so a container never runs libvips. sharp is also imported lazily now — it costs ~30 MB resident before doing any work, and with seeded tiles it is never loaded at all.
- `NODE_OPTIONS=--max-old-space-size=384` in the image: uncapped, V8 sizes its heap from the host's memory rather than the container's limit, so a spike is killed instead of collected.
- SQLite holds a 16 MB page cache and checkpoints before the WAL passes ~8 MB.
- `/api/health` reports `memory` (RSS, heap used, heap limit), so the next memory kill can be seen coming.

## 0.9.11 — AMERICAN PRINCESS on the watch list

- AMERICAN PRINCESS (367124840) is seeded onto the watch list at boot, so her track history is kept indefinitely rather than pruned with the rest of harbour traffic after 24 h. The seed is recorded in `settings`, so removing her in the app makes it stick.
- The "Add to watch list" button no longer fails silently. Changing the watch list needs an admin session, and without one the request was rejected and the error swallowed, so the button appeared to do nothing; it now says to sign in and links to the Admin page.

## 0.9.10 — Bigger locate button on phones

- The GPS crosshair is a 44 px accent-blue circle on phones — a full thumb target and the most prominent control in the header, where before it was a 32 px icon indistinguishable from the help and admin links. Its styling had also been losing to `.kiosk-actions button`, a more specific selector, so the round shape and colour it was asking for never rendered anywhere.

## 0.9.9 — Deploy hardening

- The container now runs `node` directly instead of `npm run start`. npm does not pass SIGTERM to the server and exits non-zero when the platform stops the container, which is what the deploy log showed (`npm error signal SIGTERM`, `command failed`) and what an ON_FAILURE restart policy reads as a crash.
- SIGTERM and SIGINT close Fastify, stop the AIS workers, and close SQLite so the WAL is checkpointed onto the volume; a `setTimeout` guarantees the process is gone inside the platform's grace period either way.
- `/api/health` no longer walks every track point on the request path. The storage diagnostics come from a snapshot refreshed in the background at most once a minute, so the check answers in about a millisecond regardless of how much history the volume holds.
- Boot failures (an unwritable volume, a corrupt database) no longer kill the process before it can say why. The server listens anyway and `/api/health` returns 503 with the exact error, so a broken deploy is never promoted but is diagnosable from a phone.
- Unhandled rejections and uncaught exceptions are logged instead of taking the server down, so a failed background scrape or tile cut cannot end the process.
- Historical chart tiling now starts 45 s after the server is listening (was 5 s after process start), holds sharp to one thread and a 32 MB cache, and pauses between charts. Measured: five pyramids cut with health responses steady at ~1 ms and peak RSS 233 MB. `HISTORICAL_TILE_WARMUP=0` skips it entirely.
- `healthcheckTimeout` raised from 30 s to 120 s to cover a cold start that opens SQLite on a volume and runs migrations.

## 0.9.8 — Snap to my location

- A crosshair button beside the help button puts the viewer on the chart: one GPS fix per press, a blue dot inside its accuracy circle, and the chart flown to it without ever zooming out from a closer view. The read-out gives the accuracy in metres and the distance from the club, and blocked, timed-out, insecure-context, and no-geolocation cases each say what happened rather than failing silently.

## 0.9.7 — Burgee moves to the cards

- The burgee no longer flies over club markers on the chart; the banded marker carries the identification there. It now appears on the vessel cards instead: the bottom tray card, the detail pane heading, and the search results. The legend shows the club roundel on its own, since that is what the chart actually draws.

## 0.9.6 — Club markers in club colours

- Club boats are drawn in the burgee's colours banded out from the middle: a red core, white around it, blue outside, with a hairline dark edge. The stopped marker is a roundel and the moving one is the same course arrow in three nested bands, so a club boat reads as a club boat at a glance without waiting for the burgee above it to resolve. The legend swatch matches.

## 0.9.5 — Track casings

- Every track on the map — live trails, the selected vessel's history, replay tracks, and noteworthy event tracks — is now drawn over a hairline of near-black, so a white sailing hull's trail stays visible where it crosses land, shoals, and the pale paper of the NOAA chart. Speed-coloured runs get one casing under the whole run rather than one per segment. Short trails were brightened from 0.55 to 0.75 opacity now that the casing, not faintness, keeps a crowded harbour readable.

## 0.9.4 — Club burgee

- Club boats now fly the AHYC burgee instead of a gold star: a blue pennant with the white wedge, two hoist stars, and the club letters in red, drawn as an SVG (`apps/web/src/burgee.ts`) so it stays sharp at any zoom or pixel density. It flies clear above the marker whatever shape the marker is, at 22 px so the red reads on an ordinary screen, and the same glyph marks club boats in the legend, the search results, and the detail pane heading.

## 0.9.3 — Phone layout, corrected chart georeferences

- **Mobile layout**: on phones the panels now ride in two edge drawers ("Layers" and "Vessels") behind tabs at the bottom of the screen, so the chart owns the display instead of being buried. Tapping a ship opens its card; picking one from search closes the drawer and flies to it. The status ribbon folds to a single line (and can now be folded on the desktop kiosk too).
- **Chart georeferences corrected.** The 1910, 1845, and 1895 sheets were placed by eye and landed a mile or more off — the 1845 sheet put its coastal-profile margin over the club. Each is now fitted to its own printed graticule (or, for the 1895 scan, to Sandy Hook Light and Governors Island). Pyramids are keyed to the bounding box they were cut for, so a corrected georeference re-cuts the tiles automatically.

## 0.9.2 — Tiled historical charts, event replay

- Historical charts are now served as map tiles (`GET /api/historical/:id/{z}/{x}/{y}.webp`) instead of one giant image. Zooming into a sheet no longer leaves blank paper: browsers stop painting a 20-megapixel scan once it is scaled past roughly ten thousand pixels, which is what the tan rectangle was.
- Pyramids are cut once from the scans, reprojected into Web Mercator, and cached on the data volume (about 20 MB for all five sheets). They are built in the background at boot, so picking a chart is instant.
- **Noteworthy traffic replay**: selecting an event adds a scrubber with play/pause and a time slider. Transponders move along their stored fixes with live speed labels and a trail behind them, so you can watch a pilot transfer or a speed run unfold instead of reading a static line.

## 0.9.1 — Vessel photos by MMSI

- Clicking a vessel now looks up a **photo from public sources using the MMSI**: VesselFinder's ship page first, then Wikidata by IMO and Wikimedia Commons by name. The pane shows the photo with its credit and licence, and labels name-only matches as a "likely match".
- Name matches must look like a modern photograph — verbatim name in the file title, no artwork categories, capture year 1970 or later — so a ship-name collision cannot put a 19th-century painting in the pane.
- Photos are never stored locally — lookups and image bytes sit in short-lived process memory, and the kiosk loads them through `GET /api/vessels/photo/:mmsi/image` so there is no mixed-content or hotlink trouble.
- Fixed: tray cards and the open detail pane no longer go blank when the map moves away from those vessels — `GET /api/live` takes a `pinned` list that bypasses the viewport filter.
- Fixed: the vessel detail pane no longer covers the search results, so a second vessel can be added to the tray while one is open.

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
