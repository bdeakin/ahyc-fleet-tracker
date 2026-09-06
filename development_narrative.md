# Development narrative

## 2026-09-06 — Make Railway track storage survive redeploys

Production only had ~30 minutes of AIS history after a redeploy even though a Railway volume existed. Volumes are durable; the wipe happens when SQLite writes to the container filesystem instead of the mount. The server now prefers `RAILWAY_VOLUME_MOUNT_PATH`, logs a warning when storage is ephemeral, and exposes `durableStorage` on `/api/health`.

## 2026-09-06 — Carto API key for harbor Voyager tiles

Carto’s public Voyager CDN is fine for light local use but production needs an authenticated basemap URL. The harbor layer now reads `CARTO_API_KEY` and serves `…/voyager/{z}/{x}/{y}.png?key=…` (no subdomain host) when set; otherwise it keeps the public `{s}.basemaps.cartocdn.com` template.

## 2026-09-06 — Live last-report age on vessel cards

A static “Updated” clock on the detail pane was hard to read at a glance on the kiosk. It is now a **Last report** field that counts up every second from the vessel’s latest AIS timestamp (tray cards show the same age). Absolute time remains available on hover.

## 2026-09-06 — Drag cards to compare + in-app help

Operators wanted a quick way to reason about two contacts without leaving the kiosk. Tray cards are now draggable: drop one on another to stack them and read distance, mutual true bearings, each COG, and relative bearings in the own-ship frame (ahead / beam / quarter). A **?** control opens a short help panel covering filters, watch list, stacking, and track tools.

## 2026-09-06 — Season adventures dropdown + SQLite-first docs

Season adventures should not require hunting for a vessel and then a year. The kiosk and adventures page now share one dropdown fed by club registry boats crossed with calendar years that already have AIS points in SQLite (`Vessel name - year`). README/architecture were updated so operators are not steered into thinking Supabase is the registry — local SQLite always is; Supabase remains an optional login/sync layer.

## 2026-09-06 — AIS shapes, tray along the ribbon, tighter CPA

Markers now read like other AIS apps: circles when stopped, heading arrows when moving, with a pulsing red ring for CPA risk. Alerts fire when tracks pass within 0.1 nm in the next 12 minutes — including a mover closing on a stopped boat, but never two stopped vessels.

The selection tray lives in the bottom filter row to the right of AIS source / Show, grows left-to-right, and sheds rightmost cards when there is not enough width. Zoom controls moved to the bottom-right above the status ribbon; the “local sailing grounds” line sits top-center so the type legend no longer covers it. Esri Ocean caps native zoom and overzooms instead of blank tiles, with an optional OpenSeaMap seamark overlay for buoys and lights without full NOAA clutter.

## 2026-09-06 — Watch list + tray + AISHub empty Atlantic region

Operators needed long-lived tracks for boats that are not club registry members. The right-hand vessel pane can now add/remove a watch list entry; prune keeps those MMSIs forever alongside club boats. Filters next to AIS source let the kiosk show club / watch / other traffic independently.

The bottom tray keeps the last few clicked vessels with distance from the Ocean Blvd station and a named waterway, and CPA logic draws a red ring on collision-risk contacts. The ribbon reports AISHub refresh timing, how many club boats are outside the Northeast box, and how deep SQLite history goes for traffic vs club.

Production AISHub looked “stuck” because the Atlantic NE bbox was still too large and returned 0 vessels while Great Lakes succeeded — so New York harbor never got AISHub updates. Regions are smaller now, and empty replies rotate after ~65s instead of waiting the full 5 minutes.

## 2026-09-06 — Track range buttons on the vessel pane

Operators wanted more than the default 24h track when inspecting a boat. The detail pane now offers 24h / 7d / 30d buttons under the vessel name and plots whatever history SQLite still has for that MMSI (club boats keep longer history; harbor traffic may only retain ~24h).


## 2026-09-06 — Source filter vs Live banner; less clustering

The AIS source panel sat under the Live status/timeline strip. Moved it above that banner. Clustering was still on at bay-overview zoom (~10), which hid individual ships behind large counts — disable clustering from zoom 9 up and tighten cluster radius when still zoomed further out.


## 2026-09-06 — Blank page after clustering deploy

Production HTML and `/assets/*.js` loaded, but React left `#root` empty. Playwright caught `Map has no maxZoom specified` from leaflet.markercluster when `disableClusteringAtZoom` was used without a map `maxZoom`. Fixed by setting `maxZoom: 18` on map init and adding a small ErrorBoundary so future map failures show a message instead of a white screen. AISStream `1006` reconnects are separate (API key / upstream) and no longer hide the UI.


## 2026-09-06 — Blank kiosk + AISStream 1006 + slow radio ingest

Railway logs showed AISStream sockets dying with code 1006 and `POST /api/ais/ingest` taking 6–8 seconds. Large radio batches were writing SQLite without a transaction and broadcasting one websocket event per vessel, which starved the server and could leave the map looking blank. Ingest is now one transaction + one notify; the kiosk refreshes live AIS every 5 seconds for harbor radio traffic; AISStream reconnect backs off instead of hammering the upstream.


## 2026-09-06 — Viewport AIS + clustering (and source tags)

AISHub’s wider coverage made the kiosk sluggish: every vessel on the Northeast seaboard and Great Lakes was drawn at once, and short trails fetched the entire track table. Live AIS now loads for the padded map viewport (`/api/live?minLat…`), traffic markers cluster until zoom 13 (club boats stay individual), and 10-minute trails only request nearby MMSIs when zoomed in. The same release tags each fix with its feed (radio / AISHub / AISStream), splits AISHub into rotating Atlantic + Great Lakes regions so the API returns data again, and adds source checkboxes on the kiosk.


## 2026-09-05 — AISHub for Northeast coverage and offshore club boats

AISStream and the Pi Dispatcher cover the harbor well, but club boats leaving for races (Bermuda, etc.) fall off those feeds. AISHub gives a Northeast bbox (default every 5 minutes) (Chesapeake through Maine and the Great Lakes) plus an MMSI endpoint. When a registered boat approaches the perimeter of that box it joins a watchlist; we poll those MMSIs on the remaining once-per-minute AISHub budget until the boat is safely back inside. Empty AISHub responses are treated as rate-limit/no-data so we never hammer the API.


## 2026-09-05 — Simplified chart + sailing white / pleasure pink

The full NOAA Chart Display WMS is accurate but too busy for a clubhouse kiosk — depth contours and regional labels are what people need first. Default basemap is now Esri’s Ocean Base (bathymetry) plus Ocean Reference (place names); operators can still switch to the full NOAA WMS. Sailing vessels are white and pleasure craft pink to match common AIS apps; white markers get a dark outline so they stay visible on pale water tiles.

## 2026-09-05 — Type colors were all gray; club vessels need stars

Production `/api/live` returned `shipType: null` for every traffic vessel, so every marker used the “other” gray. Two gaps: the Pi forwarder often learned names from Class B static messages without reliably attaching ship type to later positions, and scraped vessel-class text was not used for coloring. Live state now maps scraped class labels to ITU type codes when AIS type is absent, the forwarder stamps learned type onto queued positions (and no longer treats message id as ship type), and AHYC club boats get a gold star behind their pin.

## 2026-09-05 — MMSI profile scrape with local cache

AIS gives position and type, but the kiosk pane still lacked registry-style particulars (flag, dimensions, call sign). Added a one-time scrape per newly seen MMSI against VesselFinder (MyShipTracking fallback), stored in SQLite `vessel_profiles`. The background worker drains a pending queue politely; successful and not-found results stay cached, errors retry after six hours. Selecting a vessel loads `/api/vessels/profile/:mmsi` and fills the side pane as the scrape completes.

## 2026-09-05 — Ship-type colors, short trails, and vessel search

Harbor traffic was hard to read when every marker shared one gray. Live state now carries ITU AIS ship type (from Dispatcher static messages via the Pi forwarder) and maps it to a fixed palette (sailing, pleasure, tug, cargo, tanker, etc.). Club vessels still use their registry color. The kiosk shows a type legend and draws a 10-minute trail for every vessel by default; selecting a vessel still expands that track to 24 hours. A find-vessel search zooms the map and opens a side pane with MMSI, type, speed, and course.

## 2026-08-21 — AIS ingest diagnostics on Railway

Production showed LIFE AT SEA registered but `/api/live` empty. VesselFinder also reported the last AIS fix ~19 hours old. Hardened AIS ingest for Class B extended reports, removed narrow message-type filters, and exposed `/api/ais/status` plus a kiosk hint when no positions arrive or the API key is missing.

## 2026-08-21 — AISStream key + wider subscription bbox

Configured local `.env` with an AISStream API key (gitignored). Expanded `DEFAULT_BBOX` to cover NY Harbor through Long Island Sound so club vessels remain visible when cruising away from Sandy Hook.

## 2026-08-21 — Railway phone deploy

Added Docker + Railway config so the same app can be deployed from a phone browser without a Pi. Documented in `deploy/CLOUD.md`: AISStream required, Supabase optional, volume at `/data` for SQLite. First boot bootstraps LIFE AT SEA when the registry is empty.

## 2026-08-21 — Supabase registry sync

Implemented Supabase-backed admin auth and vessel registry sync as specified in the product plan. The Pi (or local server) keeps SQLite for AIS tracks; when `SUPABASE_URL` + keys are set it pulls the cloud `vessels` table every 5 minutes and pushes local admin creates/updates/deletes upstream. Admin UI supports Supabase email/password login or the local admin token fallback. Schema lives in `deploy/supabase/schema.sql`.

## 2026-08-21 — First club vessel registered

Registered **LIFE AT SEA** (MMSI `338357109`) as the primary club vessel for AIS tracking. Seed script now creates this vessel as active and keeps synthetic season tracks on an inactive demo vessel only. Adventure titles use the registered name as-is (e.g. “The 2026 Adventures of the LIFE AT SEA”). Vessel delete now cascades trips/tracks so registry cleanup works.

## 2026-08-21 — Project inception

Greenfield AHYC map kiosk monorepo created after product planning. Scope locked to **club vessels only** (no general AIS traffic layer). Core deliverables: NOAA chart kiosk with timeline replay, vessel registration, local track storage, and a seasonal **Adventures** page with scroll title, narrative summary, and stylized nautical trip art.

Stack chosen for Raspberry Pi friendliness: React + Leaflet frontend, Fastify + SQLite backend, AISStream for legal real-time AIS, optional Supabase later for cloud registry.

Synthetic demo tracks live on an inactive “SV Season Preview” vessel so Adventures UI can be exercised offline. Live AIS tracking targets registered club boats only — first vessel: **LIFE AT SEA** (MMSI 338357109).

## Harbor traffic via AIS Dispatcher (2026-09)

AISStream alone was unreliable for club-wide harbor context. With a dAISy HAT + AIS Dispatcher on the Pi, we added a Railway HTTPS ingest path: Dispatcher UDP → local Python forwarder → `POST /api/ais/ingest`. The app stores all vessels in the NYC traffic bbox for 24 hours (kiosk click-to-track) while registered club boats keep indefinite history for Adventures.
