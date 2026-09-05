#!/usr/bin/env python3
"""
Forward AIS Dispatcher UDP NMEA to the AHYC Railway HTTPS ingest API.

AIS Dispatcher (or any source) should send raw NMEA/AIVDM to UDP 127.0.0.1:10110.
This process decodes positions with pyais, batches them, and POSTs to:
  POST {AHYC_INGEST_URL}/api/ais/ingest
  Authorization: Bearer {AIS_INGEST_TOKEN}
"""

from __future__ import annotations

import json
import logging
import os
import socket
import threading
import time
from typing import Any

import urllib.error
import urllib.request

try:
    from pyais import decode  # type: ignore
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "pyais is required. Install with: pip install -r requirements.txt"
    ) from exc

LOG = logging.getLogger("ais-forwarder")

UDP_HOST = os.environ.get("AIS_UDP_HOST", "127.0.0.1")
UDP_PORT = int(os.environ.get("AIS_UDP_PORT", "10110"))
INGEST_URL = os.environ.get("AHYC_INGEST_URL", "").rstrip("/")
INGEST_TOKEN = os.environ.get("AIS_INGEST_TOKEN", "")
FLUSH_SEC = float(os.environ.get("AIS_FLUSH_SEC", "2"))
MAX_BATCH = int(os.environ.get("AIS_MAX_BATCH", "200"))

_lock = threading.Lock()
_pending: dict[str, dict[str, Any]] = {}
_names: dict[str, str] = {}


def _env_ok() -> None:
    if not INGEST_URL:
        raise SystemExit("AHYC_INGEST_URL is required (e.g. https://your-app.up.railway.app)")
    if not INGEST_TOKEN:
        raise SystemExit("AIS_INGEST_TOKEN is required (must match Railway AIS_INGEST_TOKEN)")


def _handle_decoded(msg: Any) -> None:
    mmsi = str(getattr(msg, "mmsi", "") or "")
    if not mmsi:
        return

    # Static / voyage data — cache ship name for later position reports.
    shipname = getattr(msg, "shipname", None) or getattr(msg, "ship_name", None)
    if shipname:
        name = str(shipname).strip()
        if name:
            _names[mmsi] = name

    lat = getattr(msg, "lat", None)
    lon = getattr(msg, "lon", None)
    if lat is None or lon is None:
        return
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        return
    if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
        return
    if lat_f == 91 or lon_f == 181:
        return

    sog = getattr(msg, "speed", None)
    if sog is None:
        sog = getattr(msg, "sog", None)
    cog = getattr(msg, "course", None)
    if cog is None:
        cog = getattr(msg, "cog", None)
    heading = getattr(msg, "heading", None)

    def _num(v: Any) -> float | None:
        try:
            if v is None:
                return None
            n = float(v)
            if n != n:  # NaN
                return None
            return n
        except (TypeError, ValueError):
            return None

    heading_n = _num(heading)
    if heading_n is not None and int(heading_n) == 511:
        heading_n = None

    pos = {
        "mmsi": mmsi,
        "lat": lat_f,
        "lon": lon_f,
        "sog": _num(sog),
        "cog": _num(cog),
        "heading": heading_n,
        "ts": int(time.time() * 1000),
        "name": _names.get(mmsi),
    }
    with _lock:
        _pending[mmsi] = pos


def _flush_loop() -> None:
    url = f"{INGEST_URL}/api/ais/ingest"
    while True:
        time.sleep(FLUSH_SEC)
        with _lock:
            if not _pending:
                continue
            batch = list(_pending.values())[:MAX_BATCH]
            _pending.clear()
        body = json.dumps({"positions": batch}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {INGEST_TOKEN}",
                "User-Agent": "ahyc-ais-forwarder/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                LOG.info("flushed %s positions → %s %s", len(batch), resp.status, raw[:200])
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", errors="replace")[:300]
            LOG.warning("ingest HTTP %s: %s", err.code, detail)
        except Exception as err:  # noqa: BLE001
            LOG.warning("ingest failed: %s", err)


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    _env_ok()
    threading.Thread(target=_flush_loop, name="flush", daemon=True).start()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((UDP_HOST, UDP_PORT))
    LOG.info("listening UDP %s:%s → %s/api/ais/ingest", UDP_HOST, UDP_PORT, INGEST_URL)

    while True:
        data, _addr = sock.recvfrom(65535)
        line = data.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        # Dispatcher may send one or more sentences per datagram.
        for sentence in line.replace("\r", "\n").split("\n"):
            sentence = sentence.strip()
            if not sentence.startswith("!"):
                continue
            try:
                msg = decode(sentence)
            except Exception:
                continue
            try:
                _handle_decoded(msg)
            except Exception as err:  # noqa: BLE001
                LOG.debug("decode handle error: %s", err)


if __name__ == "__main__":
    main()
