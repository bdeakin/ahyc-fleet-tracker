# Development narrative

## 2026-08-21 — Project inception

Greenfield AHYC map kiosk monorepo created after product planning. Scope locked to **club vessels only** (no general AIS traffic layer). Core deliverables: NOAA chart kiosk with timeline replay, vessel registration, local track storage, and a seasonal **Adventures** page with scroll title, narrative summary, and stylized nautical trip art.

Stack chosen for Raspberry Pi friendliness: React + Leaflet frontend, Fastify + SQLite backend, AISStream for legal real-time AIS, optional Supabase later for cloud registry.

Synthetic 2026 season seed data for SV Nuthatch enables Adventures UI without waiting for live AIS. Adventures API verified: title “The 2026 Adventures of the SV Nuthatch”, trip detection, narrative paragraphs, and track geometries for the stylized map.
