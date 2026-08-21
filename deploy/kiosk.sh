#!/usr/bin/env bash
# Autostart Chromium in kiosk mode on the Pi display.
set -euo pipefail
URL="${AHYC_KIOSK_URL:-http://127.0.0.1:8787/}"
chromium-browser --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 "$URL"
