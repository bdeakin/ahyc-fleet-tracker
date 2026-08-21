# Atlantic Highlands Yacht Club Map Kiosk

Web kiosk for AHYC sailing grounds: NOAA charts, **club vessels only** via AISStream, local track storage/replay, and a seasonal **Adventures** narrative page with a stylized nautical map.

## Stack

- **Frontend:** React + Vite + TypeScript + Leaflet
- **Backend:** Node.js + Fastify + SQLite (runs on the Raspberry Pi)
- **AIS:** [AISStream.io](https://aisstream.io) WebSocket filtered by registered MMSIs
- **Charts:** NOAA Chart Display Service WMS + optional local MBTiles
- **Cloud (optional):** Supabase for admin auth / registry sync (local admin token works for v1)

## Quick start

```bash
cp .env.example .env
npm install
npm run build --workspace=@ahyc/shared
npm run seed --workspace=@ahyc/server
npm run dev:server
# other terminal
npm run dev:web
```

Open http://localhost:5173 — kiosk map, `/adventures` for season stories, `/admin` to register vessels.

Admin token default: `dev-admin-token` (see `.env`).

## Adventures

Season = April 1 – October 31. Pick any vessel and any season with data. Title example: **The 2026 Adventures of the SV Nuthatch**. Tracks are segmented into trips and turned into a narrative plus an artistic SVG map (not the operational NOAA chart).

## MBTiles

Download a regional pack from [NCDS MBTiles Download](https://distribution.charts.noaa.gov/ncds/index.html) into `data/charts/*.mbtiles`. It appears in the kiosk chart picker and is served from `/api/charts/:id/{z}/{x}/{y}.png`.

## Raspberry Pi

See `deploy/` for systemd units and Chromium kiosk autostart.
