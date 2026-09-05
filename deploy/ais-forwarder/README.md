# AIS Dispatcher → AHYC Railway forwarder

Point **AIS Dispatcher** at a local UDP port. This small Python service decodes NMEA and POSTs batches to Railway:

`POST /api/ais/ingest` with `Authorization: Bearer $AIS_INGEST_TOKEN`.

## One-time install (Pi)

```bash
sudo mkdir -p /opt/ahyc-ais-forwarder
sudo cp forwarder.py requirements.txt /opt/ahyc-ais-forwarder/
cd /opt/ahyc-ais-forwarder
sudo python3 -m venv venv
sudo ./venv/bin/pip install -r requirements.txt

sudo cp ahyc-ais-forwarder.env.example /etc/ahyc-ais-forwarder.env
sudo nano /etc/ahyc-ais-forwarder.env   # set AHYC_INGEST_URL + AIS_INGEST_TOKEN

sudo cp ahyc-ais-forwarder.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ahyc-ais-forwarder
sudo journalctl -u ahyc-ais-forwarder -f
```

## AIS Dispatcher

Add a UDP output destination:

- Host: `127.0.0.1`
- Port: `10110`

Keep your AISHub destination as well.

## Railway

Set the same secret:

```text
AIS_INGEST_TOKEN=<long random string>
```

Optional:

```text
TRAFFIC_RETENTION_HOURS=24
TRACK_MIN_INTERVAL_SEC=60
```

Harbor traffic outside the NYC bbox is dropped. Non-registered vessels are pruned after 24 hours; registered club MMSIs are kept indefinitely.
