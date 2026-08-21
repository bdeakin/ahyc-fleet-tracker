# Development narrative

## 2026-08-21 — First club vessel registered

Registered **LIFE AT SEA** (MMSI `338357109`) as the primary club vessel for AIS tracking. Seed script now creates this vessel as active and keeps synthetic season tracks on an inactive demo vessel only. Adventure titles use the registered name as-is (e.g. “The 2026 Adventures of the LIFE AT SEA”). Vessel delete now cascades trips/tracks so registry cleanup works.

## 2026-08-21 — Project inception

Greenfield AHYC map kiosk monorepo created after product planning. Scope locked to **club vessels only** (no general AIS traffic layer). Core deliverables: NOAA chart kiosk with timeline replay, vessel registration, local track storage, and a seasonal **Adventures** page with scroll title, narrative summary, and stylized nautical trip art.

Stack chosen for Raspberry Pi friendliness: React + Leaflet frontend, Fastify + SQLite backend, AISStream for legal real-time AIS, optional Supabase later for cloud registry.

Synthetic demo tracks live on an inactive “SV Season Preview” vessel so Adventures UI can be exercised offline. Live AIS tracking targets registered club boats only — first vessel: **LIFE AT SEA** (MMSI 338357109).
