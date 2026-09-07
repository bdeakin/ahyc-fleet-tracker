# Raspberry Pi deployment

## Prerequisites

- Raspberry Pi 4/5 (4GB+ recommended), 64-bit Raspberry Pi OS
- Node.js 20+
- Chromium
- Network access for AISStream + NOAA WMS (+ Supabase if used)

## Install

```bash
sudo mkdir -p /opt/ahyc-map-kiosk
sudo chown pi:pi /opt/ahyc-map-kiosk
cd /opt/ahyc-map-kiosk
git clone https://github.com/bdeakin/ahyc-fleet-tracker.git .
cp .env.example .env
# Edit .env: AISSTREAM_API_KEY, LOCAL_ADMIN_TOKEN, optional SUPABASE_* 
npm install
npm run build
npm run seed
```

## systemd

```bash
sudo cp deploy/systemd/ahyc-api.service /etc/systemd/system/
sudo cp deploy/systemd/ahyc-kiosk.service /etc/systemd/system/
sudo cp /opt/ahyc-map-kiosk/.env /etc/ahyc-map.env
sudo chmod 600 /etc/ahyc-map.env
sudo systemctl daemon-reload
sudo systemctl enable --now ahyc-api
sudo systemctl enable --now ahyc-kiosk
```

Kiosk opens `http://127.0.0.1:8787/` in Chromium `--kiosk` via `deploy/kiosk.sh`.

## AIS feeds (optional)

- Club radio receiver → [`ais-forwarder/README.md`](ais-forwarder/README.md)
- AISHub station and account, from antenna to `AISHUB_USERNAME` → [`AISHUB.md`](AISHUB.md)

## Supabase (optional)

1. Create a Supabase project.
2. Run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor.
3. Create an admin user (Authentication → Users).
4. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in `/etc/ahyc-map.env`.
5. Restart `ahyc-api`. Sign in at `/admin` and register vessels; the Pi syncs the registry automatically.
