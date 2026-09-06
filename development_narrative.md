# Development narrative

## 2026-09-06 — A hairline of black under every track

Sailing vessels are drawn white, which is right on open water and useless the moment a trail crosses land, a shoal, or the pale paper of the NOAA chart — the line simply vanishes. Cartographers solved this long ago with a casing: draw the line twice, a slightly wider dark one underneath and the coloured one on top, so the colour keeps its meaning and the edge does the work of separating it from whatever is behind it.

Every track now goes through one `drawTrack` helper that lays a casing 1.6 px wider than the line beneath it, which covers live trails, the selected vessel's history, replay tracks, and noteworthy events alike. Runs that are coloured by speed are the exception: they are drawn as many short segments, so a per-segment casing would be both wasteful and visibly seamed, and they get a single casing under the whole run instead. The short trails were dimmed to 0.55 opacity back when nothing separated them from the chart and faintness was the only way to keep a crowded harbour from turning to soup; with an edge on them they can go back up to 0.75 and actually show their hull colour.

## 2026-09-06 — Flying the burgee

The gold star over club boats was always a placeholder for the thing a club actually uses, so it is now the AHYC burgee. It is drawn rather than loaded: the flag reduces to a blue pennant, a white wedge opening from the middle of the hoist, and two stars at the hoist, which is a handful of SVG paths and stays crisp at any zoom or pixel density, with the club letters in red across the wedge. Geometry came from measuring the flag itself: sampling the artwork row by row put the wedge's apex at the middle of the hoist and showed its edges converging with the pennant's own edges at the fly, which is what makes the blue read as two tapering borders rather than a field with a triangle cut out of it. The same measurements explained the lettering, which is not set in one size: the letters share a width but each is taller than the last, so the word grows with the wedge and never spills onto the blue.

The first pass left the letters off as unreadable, which they were at thirteen pixels. Rendering the glyph at a range of sizes against a plain background settled it: at twenty-two pixels the red is a legible word on an ordinary screen and unmistakable on a retina one, and a flag that size still sits comfortably above a twenty-eight-pixel course arrow.

Leaflet's `divIcon` takes an HTML string and React does not, so the markup is built by one function and the kiosk wraps it for the legend, the search list, and the pane heading. The marker offset is computed per marker rather than fixed, since a moving club boat is a 28-pixel arrow and a stopped one is an 18-pixel circle, and the flag should clear both.

## 2026-09-06 — A phone is not a kiosk

Everything on this map was laid out for a wall-mounted screen: a legend in one corner, filters in another, chart pickers along the bottom, a status ribbon under those. On a phone the panels covered the chart almost completely — the map was a few visible pixels between boxes. The fix is the usual one for small screens, two drawers that slide in from the edges with tabs at the bottom to open them, but the implementation detail worth recording is that the drawers wrap the existing panels and are `display: contents` above the breakpoint. The desktop kiosk therefore renders exactly the markup it always did, with the wrappers contributing nothing, and only inside the media query do they become fixed, scrolling panels that pull their children out of the corners and stack them in flow.

Two behaviours needed thought. Tapping a ship on the chart should show its card, but picking a ship from the search list — which lives *inside* a drawer — should close the drawer, because the point of that tap is to watch the map fly. Both go through the same selection state, so the search path sets a flag that suppresses the auto-open once. And the status ribbon, four lines of diagnostics that are genuinely useful on a kiosk, now folds to one line; on a phone it starts folded, which turned out to be pleasant on the desktop too.

## 2026-09-06 — Charts that were a mile out

With the sheets finally rendering at every zoom, it became obvious that several were in the wrong place. The 1845 survey was the worst: sail up to the club and you were looking at the engraved coastal profile printed in the sheet's bottom margin. The bounds had been estimated from what the charts covered rather than measured, which is fine for a thumbnail and hopeless for an overlay.

Old survey sheets carry their own answer in the margin. Each has a minute ruler along the neat line with labelled ticks every five minutes, so reading two labels gives both the scale in pixels per minute and an absolute anchor, and the rest is arithmetic. The 1910 sheet gave up 40°45' at row 1446 and 74°00' at column 1945; the 1845 sheet, whose margin carries two longitude scales (Greenwich and New York City Hall) and is ambiguous, gave its latitude the same way and took its longitude anchor from Sandy Hook Light, which has not moved since 1764. The 1895 scan is a low-resolution derivative with no legible ruler, so it was fitted to two features instead — the light again, and Governors Island. Every fit was checked by predicting where a known landmark should fall and cropping the scan there to look.

Since a pyramid is only valid for the bounding box it was cut against, the manifest now records that box, and a corrected georeference quietly re-cuts the tiles on the next boot.

## 2026-09-06 — Old charts that survive a zoom

Picking a historical sheet worked until you zoomed, at which point the chart turned into a flat tan rectangle — that rectangle being the paper underlay drawn behind it, suddenly with nothing on top. The scans are 12–20 megapixels, and Leaflet's imageOverlay scales one `<img>` to whatever the zoom demands; past roughly ten thousand pixels across, Chrome gives up on painting it. Nothing about the element changes — it stays loaded, correctly sized and positioned — so the only symptom is bare paper, and the flash of chart during the zoom animation is the old texture still on screen.

The fix is to stop asking the browser to do something it will not do, and cut the scans into ordinary XYZ tiles. Each chart is reprojected once from its linear lat/lon georeference into Web Mercator — one tile row at a time, so a 20-megapixel scan never has to sit in memory whole — and the shallower levels are built by merging four tiles into one, which is cheap and lands exactly on the tile grid. Pyramids are cached on the data volume (roughly 20 MB for all five sheets) and cut in the background at boot, so nobody waits for them. One surprise at the end: with the chart living in the tile pane, the paper underlay in the overlay pane now sat on top of it and hid it completely, which needed its own pane below the tiles.

## 2026-09-06 — Watching the event instead of reading it

A noteworthy event drew as a static line, which tells you where something happened but not how. Every event already carries the fixes it was built from, so the kiosk can replay them: a scrubber under the event detail, transponders interpolated to the playhead with their speed at that moment, and a trail growing behind each one. The whole window compresses into about fourteen seconds regardless of real duration, and dragging the slider pauses playback and moves the ships. Watching the Ambrose pilot transfer, the two arrows converge and merge — which is the point.

## 2026-09-06 — A photo for the ship you tapped

Asked whether a vessel photo could be scraped by MMSI, the answer turned out to be yes, but only from a few places. MarineTraffic's photo endpoint sits behind Cloudflare (522s), ShipSpotting returns 403 to anything without a browser session, and Wikidata's MMSI property has almost no coverage. What does work is VesselFinder's ship page, which embeds a `main-photo` image keyed on the MMSI and falls back to a stock illustration under `/images/` when nobody has contributed one — that placeholder is easy to detect and reject. Behind it, Wikidata by IMO leads to a Commons file with a real licence and author, and a Commons full-text search on the vessel name is the last resort. Name search is genuinely unreliable: searching "PILOT AMERICA" surfaces a 19th-century pilot schooner, "Queen Mary 2" first offers a museum model, and "SEA LARK" produced a Christie's lithograph of an 1843 Royal Navy brig. Title text alone does not separate those from photographs, but Commons metadata does — the artwork carries `PD-Art` and `Paintings` categories and a date of "19th century", where a usable photo has a modern capture year. A name match therefore has to appear verbatim in the file title, avoid artwork categories, and carry a capture year of 1970 or later; anything that survives that is flagged in the UI as a likely match rather than presented as fact.

Nothing is persisted, per the request. Lookups are memoised in process memory (12h for hits, 2h for misses) and the last two dozen images are cached the same way, so a redeploy just looks them up again. The kiosk loads the image from our own server rather than the upstream URL: one origin, no mixed content, and the referer and user-agent are ours to set.

Two bugs surfaced while testing this against real clicks. Pinning two vessels in the tray and then flying to one of them emptied the tray, because the live feed is viewport-scoped and cards only render for vessels in that response; `/api/live` now takes a `pinned` list that ignores the bounding box. And with a vessel pane open, the search result list underneath it was unclickable, which made a second card impossible to add.

## 2026-09-06 — Charts that look like charts

The kiosk wanted the look of a NOAA paper chart: soundings, depth tints, magenta aids, buff land. NOAA cancelled its raster charts, so the closest live source is the ENC data rendered through NOAA's Maritime Chart Service, which accepts S-52 mariner settings per request. Comparing renders against a paper sheet of Sandy Hook, two settings did most of the work: dropping the `OTHER` display category (that is where the hatching, data-quality boxes and AIO overlays come from) and asking for paper-chart point symbols with plain area boundaries. Four depth shades at 12 / 30 / 60 ft in feet finish it, matching the New York Harbor sheets. The layer is now the default; the full ECDIS display is still selectable.

OpenSeaMap seamarks were the other source of clutter — their labels are baked into the tiles, so at bay zoom every buoy name overlapped. They now start at zoom 14.

## 2026-09-06 — Noteworthy traffic

The detectors in `packages/shared/src/noteworthyTraffic.ts` had no route and no UI. They now sit behind `GET /api/noteworthy`, which walks the stored AIS window once every few minutes and caches the result, and a picker on the map draws whichever event you select.

Three detectors are new:

- **Interceptions** — pairs whose tracks close from over half a mile to alongside (within ~220 m). Around Ambrose this is mostly Sandy Hook pilots boarding or landing a pilot: the event is marked as a pilot transfer when either vessel is a pilot boat by AIS type or name and the two either matched course or met inside a known boarding area.
- **Suspected groundings** — a vessel that goes from making way to stopped in one report and stays put somewhere no other traffic stops. Our AIS feeds do not carry static draught, so draught is estimated from ship type and length, and depth comes from NOAA NCEI's DEM mosaic (cached per ~100 m cell in `depth_samples`). Under-keel clearance decides between *possible* and *likely*; comfortable water drops the event entirely.
- **Need for speed** — sustained runs over 30 kn. Speeds at or above 70 kn are dropped as decode errors rather than reported, which also covers the AIS 102.3 kn "not available" sentinel.

Detecting no-wake speeding used to treat any cell with enough stopped fixes as a no-wake pocket, so an aground boat manufactured a pocket and then "sped" through it on the way in. A pocket now needs stopped fixes from more than one vessel.

## 2026-09-06 — CPA on stacked cards, and a tray that stops eating drags

Stacking two vessel cards already showed range, bearings and courses; it now also shows CPA and TCPA, computed from both fixes assuming each holds course and speed, with the row highlighted when the pair closes inside 0.15 nm within 15 minutes. Vessels without usable COG/SOG count as stationary, so a mover against a moored boat still yields a useful answer.

The tray row spans the width between the filter panels and the zoom control so the app can measure how many cards fit. That whole row was capturing mouse events, which is why the map would not drag to the right of the cards. Only the card stacks take pointer events now.

## 2026-09-06 — Historical charts on the kiosk

Operators can switch the basemap to period charts when the viewport intersects coverage. A **Historical chart** control offers Robert Dudley’s **1646** eastern-seaboard general chart (regional zoom), plus **1776** Entrance of Hudson’s River and **1845 / 1895 / 1910** NY Bay sheets. Selecting one swaps modern tiles for a georeferenced image overlay; assets live under `/historical-charts/`.

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
