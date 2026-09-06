# Prompts

## Product framing

Build a yacht-club kiosk for Atlantic Highlands Yacht Club that shows local sailing grounds on a readable chart (simplified ocean depth + place names by default; full NOAA WMS optional), overlays **registered club vessels** and harbor AIS traffic, stores tracks locally for timeline replay, and offers a seasonal Adventures page with narrative prose and a stylized artistic nautical map titled like “The 2026 Adventures of the LIFE AT SEA”.

## Constraints

- Prefer local responsiveness (MBTiles + SQLite on Pi)
- AIS via AISStream API, not website scraping
- Season ≈ April–October; any vessel × any season with data
- Raspberry Pi capable; Railway for phone-friendly cloud deploy
- Supabase optional for admin auth + vessel registry sync

## Known club vessels

- LIFE AT SEA — MMSI 338357109 (sailing vessel)

## AIS Dispatcher ingest (Pi → Railway)

- Dispatcher output: UDP `127.0.0.1:10110`
- Forwarder: `deploy/ais-forwarder` with `AHYC_INGEST_URL` + `AIS_INGEST_TOKEN`
- Railway: set matching `AIS_INGEST_TOKEN`; optional `TRAFFIC_RETENTION_HOURS`, `TRACK_MIN_INTERVAL_SEC`
- Product rules: traffic 24h; registered MMSIs indefinite; live 10m trails when zoomed in; click/search vessel → 24h track + detail pane
- Markers color-coded by AIS ship type (sailing white, pleasure pink); club vessels keep registry color + star
- Kiosk search: type vessel name or MMSI to zoom and inspect (scoped to vessels loaded for the current view)
- New MMSI → one-time public profile scrape (cached in SQLite); pane shows flag / class / size when known
- Default basemap: Esri Ocean (depth + labels); switcher keeps full NOAA Chart Display WMS
- Live AIS is viewport-scoped and refreshes every 5 seconds; map sets maxZoom for marker clustering; traffic only clusters at far overview (individual ships from bay/harbor scale); filter markers by source (Radio / AISHub / AISStream)

## AISHub (Northeast + offshore)

- Set `AISHUB_USERNAME` on Railway
- Rotating regions: Atlantic NE + Great Lakes (union used for perimeter watch)
- Poll AISHub every 5 minutes by default (never more than once per minute)
- Tag ingest `source=aishub`; status at `/api/aishub/status`
