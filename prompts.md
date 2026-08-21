# Prompts

## Product framing

Build a yacht-club kiosk for Atlantic Highlands Yacht Club that shows NOAA nautical charts of local sailing grounds, overlays **registered club vessels only** from public AIS, stores tracks locally for timeline replay, and offers a seasonal Adventures page with narrative prose and a stylized artistic nautical map titled like “The 2026 Adventures of the SV Nuthatch”.

## Constraints

- Prefer local responsiveness (MBTiles + SQLite on Pi)
- AIS via AISStream API, not website scraping
- Season ≈ April–October; any vessel × any season with data
- Raspberry Pi capable; Supabase optional for admin/registry

## Known club vessels

- LIFE AT SEA — MMSI 338357109 (sailing vessel)
