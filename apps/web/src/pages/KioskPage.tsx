import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { AHYC_CENTER, NOAA_CHART_WMS, type ChartLayer, type VesselLiveState } from "@ahyc/shared";
import { api, liveSocket } from "../api";

const HOURS = 48;

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
          if (!ais.apiKeyConfigured) {
            setAisHint("AISStream API key is not set on the server (Railway variable AISSTREAM_API_KEY).");
          } else if (!ais.connected) {
            setAisHint(ais.lastError ? `AIS disconnected: ${ais.lastError}` : "Connecting to AISStream…");
          } else if (!ais.lastIngestAt) {
            setAisHint(
              `Listening for ${ais.watchingMmsi.join(", ") || "club vessels"} — no position reports yet (AIS may be out of shore-station range).`,
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
        // merge single update by refetching snapshot lightly
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

  function drawMarkers(vessels: VesselLiveState[]) {
    setVesselCount(vessels.length);
    const group = markersRef.current;
    if (!group) return;
    group.clearLayers();
    for (const v of vessels) {
      const color = v.color ?? "#1f6f8b";
      const icon = L.divIcon({
        className: "vessel-marker",
        html: `<span style="background:${color}"></span>`,
        iconSize: [18, 18],
      });
      const marker = L.marker([v.lat, v.lon], { icon });
      marker.bindTooltip(v.name ?? v.mmsi, { direction: "top", offset: [0, -10] });
      marker.addTo(group);
    }
  }

  return (
    <div className="kiosk">
      <div className="kiosk-brand">
        <h1>Atlantic Highlands Yacht Club</h1>
        <p>Local sailing grounds · club vessels · NOAA charts</p>
      </div>
      <div className="kiosk-actions">
        <Link to="/adventures">Season adventures</Link>
        <Link to="/admin">Admin</Link>
        {!live && (
          <button type="button" onClick={() => { setLive(true); setSlider(HOURS * 60); setRangeEnd(Date.now()); tracksRef.current?.clearLayers(); }}>
            Jump to live
          </button>
        )}
      </div>
      <div className="chart-select">
        <select value={chartId} onChange={(e) => setChartId(e.target.value)} aria-label="Chart layer">
          {(charts.length ? charts : [{ id: "noaa-wms", kind: "noaa-wms" as const, label: "NOAA Chart Display (live WMS)" }]).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div ref={mapRef} />
      <div className="timeline">
        <label>
          <span>{live ? "Live" : "Replay"}{vesselCount ? ` · ${vesselCount} vessel${vesselCount === 1 ? "" : "s"}` : ""}</span>
          <span>{new Date(scrubTs).toLocaleString()}</span>
        </label>
        {aisHint && <p className="ais-hint">{aisHint}</p>}
        <input
          type="range"
          min={0}
          max={HOURS * 60}
          value={slider}
          onChange={(e) => {
            setLive(false);
            setSlider(Number(e.target.value));
          }}
        />
      </div>
    </div>
  );
}
