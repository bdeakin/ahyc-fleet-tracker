# Development narrative

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
