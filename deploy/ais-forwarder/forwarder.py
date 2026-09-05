#!/usr/bin/env python3
"""
Forward AIS Dispatcher UDP NMEA to the AHYC Railway HTTPS ingest API.

AIS Dispatcher should send raw NMEA/AIVDM to UDP 127.0.0.1:10110.
This process assembles multipart sentences, decodes with pyais, batches
positions (+ cached name/ship type), and POSTs to:
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
_ship_types: dict[str, int] = {}
# Buffer incomplete multipart AIVDM sentences keyed by (channel, seq_id)
_fragments: dict[tuple[str, str], list[str]] = {}


def _env_ok() -> None:
    if not INGEST_URL:
        raise SystemExit("AHYC_INGEST_URL is required (e.g. https://your-app.up.railway.app)")
    if not INGEST_TOKEN:
        raise SystemExit("AIS_INGEST_TOKEN is required (must match Railway AIS_INGEST_TOKEN)")


def _clean_name(value: Any) -> str | None:
    if value is None:
        return None
    name = str(value).replace("@", " ").strip().strip("\x00").strip()
    if not name:
        return None
    return name[:64]


def _extract_ship_type(msg: Any) -> int | None:
    """Pull ITU ship & cargo type from static AIS (type 5 / 24B).

    Do not read bare ``type`` / ``msg_type`` — those are the AIS message id
    (1–27), not the vessel class, and would paint every Class B boat as type 18.
    """
    for attr in ("ship_type", "shipType", "shiptype", "type_and_cargo"):
        raw = getattr(msg, attr, None)
        if raw is None:
            continue
        # Enum-like objects from pyais (ShipType)
        if hasattr(raw, "value"):
            try:
                raw = raw.value
            except Exception:  # noqa: BLE001
                pass
        try:
            n = int(raw)
        except (TypeError, ValueError):
            continue
        if 0 < n <= 99:
            return n
    # Fallback: asdict() payloads
    asdict = getattr(msg, "asdict", None)
    if callable(asdict):
        try:
            data = asdict()
            raw = data.get("ship_type") or data.get("shipType")
            if raw is not None:
                n = int(getattr(raw, "value", raw))
                if 0 < n <= 99:
                    return n
        except Exception:  # noqa: BLE001
            pass
    return None


def _handle_decoded(msg: Any) -> None:
    mmsi = str(getattr(msg, "mmsi", "") or "")
    if not mmsi:
        return

    name = None
    for attr in ("shipname", "ship_name", "name", "vessel_name"):
        name = _clean_name(getattr(msg, attr, None))
        if name:
            break
    if name:
        _names[mmsi] = name
        LOG.info("learned name mmsi=%s name=%s", mmsi, name)
        with _lock:
            if mmsi in _pending:
                _pending[mmsi]["name"] = name

    ship_type = _extract_ship_type(msg)
    if ship_type is not None:
        _ship_types[mmsi] = ship_type
        LOG.info("learned shipType mmsi=%s type=%s", mmsi, ship_type)
        # Static messages have no lat/lon; stamp type onto any queued position.
        with _lock:
            if mmsi in _pending:
                _pending[mmsi]["shipType"] = ship_type
                if mmsi in _names:
                    _pending[mmsi]["name"] = _names[mmsi]

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
        "shipType": _ship_types.get(mmsi),
    }
    with _lock:
        _pending[mmsi] = pos


def _parse_fragment_header(sentence: str) -> tuple[int, int, str, str] | None:
    """Return (frag_count, frag_num, seq_id, channel) for AIVDM/AIVDO, else None."""
    try:
        body = sentence.split("*", 1)[0]
        parts = body.split(",")
        if len(parts) < 5:
            return None
        talker = parts[0]
        if not talker.endswith("VDM") and not talker.endswith("VDO"):
            return None
        frag_count = int(parts[1])
        frag_num = int(parts[2])
        seq_id = parts[3] or "0"
        channel = parts[4] or "A"
        return frag_count, frag_num, seq_id, channel
    except Exception:  # noqa: BLE001
        return None


def _feed_sentence(sentence: str) -> None:
    header = _parse_fragment_header(sentence)
    if header is None:
        try:
            _handle_decoded(decode(sentence))
        except Exception:
            return
        return

    frag_count, frag_num, seq_id, channel = header
    if frag_count <= 1:
        try:
            _handle_decoded(decode(sentence))
        except Exception:
            return
        return

    key = (channel, seq_id)
    bucket = _fragments.setdefault(key, [])
    # Store by fragment number (1-based)
    while len(bucket) < frag_count:
        bucket.append("")
    if 1 <= frag_num <= frag_count:
        bucket[frag_num - 1] = sentence

    if all(bucket):
        parts = list(bucket)
        _fragments.pop(key, None)
        try:
            _handle_decoded(decode(*parts))
        except Exception:
            # Fall back to decoding individually (rarely useful for type 5)
            for part in parts:
                try:
                    _handle_decoded(decode(part))
                except Exception:
                    continue


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
                "User-Agent": "ahyc-ais-forwarder/1.1",
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
        for sentence in line.replace("\r", "\n").split("\n"):
            sentence = sentence.strip()
            if not sentence.startswith("!"):
                continue
            try:
                _feed_sentence(sentence)
            except Exception as err:  # noqa: BLE001
                LOG.debug("sentence error: %s", err)


if __name__ == "__main__":
    main()
