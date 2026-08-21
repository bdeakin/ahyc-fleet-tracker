# Version history

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
