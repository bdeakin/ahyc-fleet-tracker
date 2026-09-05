import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { AHYC_CENTER, NOAA_CHART_WMS, type ChartLayer, type VesselLiveState } from "@ahyc/shared";
import { api, liveSocket } from "../api";

const HOURS = 48;
const TRACK_HOURS = 24;

export function KioskPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<L.Map | null>(null);
  const layerRef = useRef<L.Layer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const tracksRef = useRef<L.LayerGroup | null>(null);

  const [charts, setCharts] = useState<ChartLayer[]>([]);
  const [chartId, setChartId] = useState("noaa-wms");
  const [live, setLive] = useState(true);
  const [rangeEnd, setRangeEnd] = useState(Date.now());
  const [slider, setSlider] = useState(HOURS * 60); // minutes from start of window
  const [aisHint, setAisHint] = useState<string | null>(null);
  const [vesselCount, setVesselCount] = useState(0);
  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const windowStart = useMemo(() => rangeEnd - HOURS * 3600_000, [rangeEnd]);
  const scrubTs = windowStart + slider * 60_000;

  useEffect(() => {
    api.charts().then((c) => {
      setCharts(c);
      if (c.length && !c.find((x) => x.id === chartId)) setChartId(c[0].id);
    });
    const refreshAis = () => {
      api
        .config()
        .then((cfg) => {
          const ais = cfg.ais;
          if (!ais) return;
          if (!ais.apiKeyConfigured && !ais.ingestTokenConfigured) {
            setAisHint(
              "No AIS source configured. Set AISSTREAM_API_KEY and/or AIS_INGEST_TOKEN (Pi Dispatcher forwarder) on Railway.",
            );
          } else if (ais.ingestTokenConfigured && !ais.apiKeyConfigured) {
            setAisHint(null);
          } else if (ais.apiKeyConfigured && !ais.connected) {
            setAisHint(ais.lastError ? `AISStream disconnected: ${ais.lastError}` : "Connecting to AISStream…");
          } else if (ais.apiKeyConfigured && !ais.lastIngestAt) {
            setAisHint(
              `Listening for ${ais.watchingMmsi.join(", ") || "club vessels"} — no AISStream positions yet (Dispatcher feed may still populate traffic).`,
            );
          } else {
            setAisHint(null);
          }
        })
        .catch(() => undefined);
    };
    refreshAis();
    const id = window.setInterval(refreshAis, 15_000);
    return () => window.clearInterval(id);
  }, [chartId]);

  useEffect(() => {
    if (!mapRef.current || mapObj.current) return;
    const map = L.map(mapRef.current, {
      center: [AHYC_CENTER.lat, AHYC_CENTER.lon],
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
    });
    markersRef.current = L.layerGroup().addTo(map);
    tracksRef.current = L.layerGroup().addTo(map);
    mapObj.current = map;
    return () => {
      map.remove();
      mapObj.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapObj.current;
    if (!map) return;
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    const selected = charts.find((c) => c.id === chartId);
    if (!selected || selected.kind === "noaa-wms") {
      layerRef.current = L.tileLayer.wms(NOAA_CHART_WMS, {
        layers: "0,1,2,3,4,5,6,7,8,9,10,11,12",
        format: "image/png",
        transparent: true,
        attribution: "NOAA Chart Display Service",
      });
    } else {
      layerRef.current = L.tileLayer(`/api/charts/${selected.id}/{z}/{x}/{y}.png`, {
        maxZoom: 18,
        attribution: "NOAA NCDS MBTiles (local)",
      });
    }
    layerRef.current.addTo(map);
  }, [chartId, charts]);

  useEffect(() => {
    if (!live) return;
    const ws = liveSocket((msg) => {
      const data = msg as { type: string; vessels?: VesselLiveState[]; vessel?: VesselLiveState };
      if (data.type === "snapshot" && data.vessels) {
        drawMarkers(data.vessels);
      }
      if (data.type === "vessel" && data.vessel) {
        setRangeEnd(Date.now());
        api.live().then(drawMarkers).catch(() => undefined);
      }
    });
    api.live().then(drawMarkers).catch(() => undefined);
    const tick = window.setInterval(() => {
      if (live) setRangeEnd(Date.now());
    }, 60_000);
    return () => {
      ws.close();
      window.clearInterval(tick);
    };
  }, [live]);

  useEffect(() => {
    if (live) return;
    api.replay(scrubTs).then(drawMarkers).catch(() => undefined);
    api
      .tracks(windowStart, scrubTs)
      .then((points) => {
        const group = tracksRef.current;
        if (!group) return;
        group.clearLayers();
        const byMmsi = new Map<string, L.LatLngExpression[]>();
        for (const p of points) {
          const arr = byMmsi.get(p.mmsi) ?? [];
          arr.push([p.lat, p.lon]);
          byMmsi.set(p.mmsi, arr);
        }
        for (const coords of byMmsi.values()) {
          L.polyline(coords, { color: "#3d8b8b", weight: 3, opacity: 0.85 }).addTo(group);
        }
      })
      .catch(() => undefined);
  }, [live, scrubTs, windowStart]);

  useEffect(() => {
    if (!live || !selectedMmsi) return;
    const to = Date.now();
    const from = to - TRACK_HOURS * 3600_000;
    let cancelled = false;
    api
      .tracks(from, to, selectedMmsi)
      .then((points) => {
        if (cancelled) return;
        const group = tracksRef.current;
        if (!group) return;
        group.clearLayers();
        if (points.length < 2) return;
        const coords = points.map((p) => [p.lat, p.lon] as L.LatLngExpression);
        L.polyline(coords, { color: "#c45c26", weight: 4, opacity: 0.9 }).addTo(group);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [live, selectedMmsi, rangeEnd]);

  function clearSelection() {
    setSelectedMmsi(null);
    setSelectedLabel(null);
    tracksRef.current?.clearLayers();
  }

  function drawMarkers(vessels: VesselLiveState[]) {
    setVesselCount(vessels.length);
    const group = markersRef.current;
    if (!group) return;
    group.clearLayers();
    for (const v of vessels) {
      const registered = Boolean(v.registered);
      const color = registered ? (v.color ?? "#1f6f8b") : "#6b7280";
      const size = registered ? 18 : 12;
      const icon = L.divIcon({
        className: registered ? "vessel-marker vessel-marker--club" : "vessel-marker vessel-marker--traffic",
        html: `<span style="background:${color}"></span>`,
        iconSize: [size, size],
      });
      const marker = L.marker([v.lat, v.lon], { icon, zIndexOffset: registered ? 500 : 0 });
      const label = v.name ?? v.mmsi;
      marker.bindTooltip(
        `${label}${registered ? " (club)" : ""}${v.sog != null ? ` · ${v.sog.toFixed(1)} kn` : ""}`,
        { direction: "top", offset: [0, -10] },
      );
      marker.on("click", () => {
        setSelectedMmsi(v.mmsi);
        setSelectedLabel(label);
        if (!live) {
          setLive(true);
          setSlider(HOURS * 60);
          setRangeEnd(Date.now());
        }
      });
      marker.addTo(group);
    }
  }

  return (
    <div className="kiosk">
      <div className="kiosk-brand">
        <h1>Atlantic Highlands Yacht Club</h1>
        <p>Local sailing grounds · club & harbor traffic · NOAA charts</p>
      </div>
      <div className="kiosk-actions">
        <Link to="/adventures">Season adventures</Link>
        <Link to="/admin">Admin</Link>
        {!live && (
          <button
            type="button"
            onClick={() => {
              setLive(true);
              setSlider(HOURS * 60);
              setRangeEnd(Date.now());
              if (!selectedMmsi) tracksRef.current?.clearLayers();
            }}
          >
            Jump to live
          </button>
        )}
        {selectedMmsi && (
          <button type="button" onClick={clearSelection}>
            Clear track{selectedLabel ? `: ${selectedLabel}` : ""}
          </button>
        )}
      </div>
      <div className="chart-select">
        <select value={chartId} onChange={(e) => setChartId(e.target.value)} aria-label="Chart layer">
          {(charts.length
            ? charts
            : [{ id: "noaa-wms", kind: "noaa-wms" as const, label: "NOAA Chart Display (live WMS)" }]
          ).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div ref={mapRef} />
      <div className="timeline">
        <label>
          <span>
            {live ? "Live" : "Replay"}
            {vesselCount ? ` · ${vesselCount} vessel${vesselCount === 1 ? "" : "s"}` : ""}
            {selectedMmsi ? ` · track ${TRACK_HOURS}h` : ""}
          </span>
          <span>{new Date(scrubTs).toLocaleString()}</span>
        </label>
        {aisHint && <p className="ais-hint">{aisHint}</p>}
        <p className="ais-hint">Click a vessel to show its track for the past {TRACK_HOURS} hours.</p>
        <input
          type="range"
          min={0}
          max={HOURS * 60}
          value={slider}
          onChange={(e) => {
            setLive(false);
            setSelectedMmsi(null);
            setSelectedLabel(null);
            setSlider(Number(e.target.value));
          }}
        />
      </div>
    </div>
  );
}
