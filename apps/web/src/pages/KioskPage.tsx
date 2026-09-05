import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AHYC_CENTER,
  NOAA_CHART_WMS,
  colorForShipType,
  type ChartLayer,
  type VesselLiveState,
  type VesselProfile,
} from "@ahyc/shared";
import { api, liveSocket } from "../api";

const HOURS = 48;
const TRACK_HOURS = 24;
const DEFAULT_TRAIL_MINUTES = 10;

const TYPE_LEGEND: Array<{ color: string; label: string }> = [
  { color: "#1f6f8b", label: "AHYC club ★" },
  { color: "#0f766e", label: "Sailing" },
  { color: "#d97706", label: "Pleasure" },
  { color: "#65a30d", label: "Fishing" },
  { color: "#ea580c", label: "Tug / tow" },
  { color: "#2563eb", label: "Passenger" },
  { color: "#475569", label: "Cargo" },
  { color: "#b91c1c", label: "Tanker" },
  { color: "#0891b2", label: "High speed" },
  { color: "#ca8a04", label: "Pilot / SAR" },
  { color: "#6b7280", label: "Other" },
];

function markerColor(v: VesselLiveState): string {
  if (v.registered) return v.color ?? "#1f6f8b";
  if (v.color) return v.color;
  return colorForShipType(v.shipType);
}

export function KioskPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<L.Map | null>(null);
  const layerRef = useRef<L.Layer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const tracksRef = useRef<L.LayerGroup | null>(null);
  const liveVesselsRef = useRef<VesselLiveState[]>([]);

  const [charts, setCharts] = useState<ChartLayer[]>([]);
  const [chartId, setChartId] = useState("noaa-wms");
  const [live, setLive] = useState(true);
  const [rangeEnd, setRangeEnd] = useState(Date.now());
  const [slider, setSlider] = useState(HOURS * 60); // minutes from start of window
  const [aisHint, setAisHint] = useState<string | null>(null);
  const [vesselCount, setVesselCount] = useState(0);
  const [liveVessels, setLiveVessels] = useState<VesselLiveState[]>([]);
  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [vesselProfile, setVesselProfile] = useState<VesselProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const windowStart = useMemo(() => rangeEnd - HOURS * 3600_000, [rangeEnd]);
  const scrubTs = windowStart + slider * 60_000;

  const selectedVessel = useMemo(
    () => liveVessels.find((v) => v.mmsi === selectedMmsi) ?? null,
    [liveVessels, selectedMmsi],
  );

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return liveVessels
      .filter((v) => {
        const name = (v.name ?? "").toLowerCase();
        return name.includes(q) || v.mmsi.includes(q);
      })
      .slice(0, 8);
  }, [liveVessels, searchQuery]);

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

  // Live mode: 10-minute trails for every vessel; selected vessel gets 24h.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;

    async function refreshTrails() {
      const group = tracksRef.current;
      if (!group) return;
      const vessels = liveVesselsRef.current;
      const to = Date.now();
      const shortFrom = to - DEFAULT_TRAIL_MINUTES * 60_000;
      const longFrom = to - TRACK_HOURS * 3600_000;

      const colorByMmsi = new Map(vessels.map((v) => [v.mmsi, markerColor(v)]));
      const mmsis = vessels.map((v) => v.mmsi);
      if (mmsis.length === 0) {
        group.clearLayers();
        return;
      }

      try {
        const points = await api.tracks(shortFrom, to);
        if (cancelled) return;
        group.clearLayers();

        const byMmsi = new Map<string, L.LatLngExpression[]>();
        for (const p of points) {
          if (!colorByMmsi.has(p.mmsi)) continue;
          const arr = byMmsi.get(p.mmsi) ?? [];
          arr.push([p.lat, p.lon]);
          byMmsi.set(p.mmsi, arr);
        }

        for (const [mmsi, coords] of byMmsi) {
          if (coords.length < 2) continue;
          if (selectedMmsi && mmsi === selectedMmsi) continue;
          L.polyline(coords, {
            color: colorByMmsi.get(mmsi) ?? "#6b7280",
            weight: 2,
            opacity: 0.55,
          }).addTo(group);
        }

        if (selectedMmsi) {
          const longPoints = await api.tracks(longFrom, to, selectedMmsi);
          if (cancelled) return;
          if (longPoints.length >= 2) {
            const coords = longPoints.map((p) => [p.lat, p.lon] as L.LatLngExpression);
            L.polyline(coords, {
              color: colorByMmsi.get(selectedMmsi) ?? "#c45c26",
              weight: 4,
              opacity: 0.92,
            }).addTo(group);
          }
        }
      } catch {
        /* ignore trail errors */
      }
    }

    void refreshTrails();
    const id = window.setInterval(refreshTrails, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [live, selectedMmsi, rangeEnd, vesselCount]);


  useEffect(() => {
    if (!selectedMmsi) {
      setVesselProfile(null);
      return;
    }
    let cancelled = false;
    setVesselProfile(null);
    const load = () => {
      api
        .vesselProfile(selectedMmsi)
        .then((p) => {
          if (!cancelled) setVesselProfile(p);
        })
        .catch(() => {
          if (!cancelled) setVesselProfile(null);
        });
    };
    load();
    // Poll while pending so scrape results appear without reselecting.
    const id = window.setInterval(() => {
      if (cancelled) return;
      api
        .vesselProfile(selectedMmsi)
        .then((p) => {
          if (cancelled) return;
          setVesselProfile(p);
          if (p.status === "ok" || p.status === "not_found" || p.status === "error") {
            window.clearInterval(id);
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedMmsi]);

  function clearSelection() {
    setSelectedMmsi(null);
    setSelectedLabel(null);
    setSearchQuery("");
    setVesselProfile(null);
  }

  function focusVessel(v: VesselLiveState, opts?: { keepSearch?: boolean }) {
    const label = v.name ?? v.mmsi;
    setSelectedMmsi(v.mmsi);
    setSelectedLabel(label);
    if (!opts?.keepSearch) setSearchQuery("");
    if (!live) {
      setLive(true);
      setSlider(HOURS * 60);
      setRangeEnd(Date.now());
    }
    const map = mapObj.current;
    if (map && Number.isFinite(v.lat) && Number.isFinite(v.lon)) {
      map.flyTo([v.lat, v.lon], Math.max(map.getZoom(), 14), { duration: 0.85 });
    }
  }

  function drawMarkers(vessels: VesselLiveState[]) {
    setVesselCount(vessels.length);
    setLiveVessels(vessels);
    liveVesselsRef.current = vessels;
    const group = markersRef.current;
    if (!group) return;
    group.clearLayers();
    for (const v of vessels) {
      const registered = Boolean(v.registered);
      const color = markerColor(v);
      const size = registered ? 22 : 12;
      const icon = L.divIcon({
        className: registered ? "vessel-marker vessel-marker--club" : "vessel-marker vessel-marker--traffic",
        html: registered
          ? `<span class="vessel-marker-star" aria-hidden="true">★</span><span class="vessel-marker-dot" style="background:${color}"></span>`
          : `<span class="vessel-marker-dot" style="background:${color}"></span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const marker = L.marker([v.lat, v.lon], { icon, zIndexOffset: registered ? 500 : 0 });
      const label = v.name ?? v.mmsi;
      const typeBit = registered ? "AHYC club" : (v.shipTypeLabel ?? "traffic");
      marker.bindTooltip(
        `${label} (${typeBit})${v.sog != null ? ` · ${v.sog.toFixed(1)} kn` : ""}`,
        { direction: "top", offset: [0, -10] },
      );
      marker.on("click", () => focusVessel(v));
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
      <aside className="type-legend" aria-label="Vessel type colors">
        {TYPE_LEGEND.map((item) => (
          <div key={item.label} className="type-legend-row">
            <span className="type-swatch" style={{ background: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </aside>
      <div className="vessel-search">
        <label className="vessel-search-label" htmlFor="vessel-search-input">
          Find vessel
        </label>
        <input
          id="vessel-search-input"
          type="search"
          placeholder="Name or MMSI…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoComplete="off"
        />
        {searchMatches.length > 0 && (
          <ul className="vessel-search-results">
            {searchMatches.map((v) => (
              <li key={v.mmsi}>
                <button type="button" onClick={() => focusVessel(v)}>
                  <span className="type-swatch" style={{ background: markerColor(v) }} />
                  <span className="vessel-search-name">{v.name || v.mmsi}</span>
                  <span className="vessel-search-meta">
                    {v.registered ? "AHYC" : v.shipTypeLabel || "Traffic"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {searchQuery.trim().length >= 2 && searchMatches.length === 0 && (
          <p className="vessel-search-empty">No vessels match.</p>
        )}
      </div>
      {selectedVessel && (
        <aside className="vessel-pane" aria-live="polite">
          <header>
            <h2>{selectedVessel.name || selectedVessel.mmsi}</h2>
            <button type="button" className="vessel-pane-close" onClick={clearSelection} aria-label="Close">
              ×
            </button>
          </header>
          <dl>
            <div>
              <dt>MMSI</dt>
              <dd>{selectedVessel.mmsi}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{selectedVessel.registered ? "AHYC fleet" : selectedVessel.shipTypeLabel || "Unknown"}</dd>
            </div>
            <div>
              <dt>SOG</dt>
              <dd>{selectedVessel.sog != null ? `${selectedVessel.sog.toFixed(1)} kn` : "—"}</dd>
            </div>
            <div>
              <dt>COG</dt>
              <dd>{selectedVessel.cog != null ? `${selectedVessel.cog.toFixed(0)}°` : "—"}</dd>
            </div>
            <div>
              <dt>Position</dt>
              <dd>
                {selectedVessel.lat.toFixed(4)}, {selectedVessel.lon.toFixed(4)}
              </dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{new Date(selectedVessel.ts).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Track</dt>
              <dd>Last {TRACK_HOURS} hours</dd>
            </div>
            {vesselProfile?.status === "pending" && (
              <div>
                <dt>Details</dt>
                <dd>Looking up vessel…</dd>
              </div>
            )}
            {vesselProfile?.status === "ok" && (
              <>
                {vesselProfile.flag && (
                  <div>
                    <dt>Flag</dt>
                    <dd>{vesselProfile.flag}</dd>
                  </div>
                )}
                {vesselProfile.callsign && (
                  <div>
                    <dt>Call sign</dt>
                    <dd>{vesselProfile.callsign}</dd>
                  </div>
                )}
                {vesselProfile.imo && (
                  <div>
                    <dt>IMO</dt>
                    <dd>{vesselProfile.imo}</dd>
                  </div>
                )}
                {vesselProfile.vesselType && (
                  <div>
                    <dt>Class</dt>
                    <dd>{vesselProfile.vesselType}</dd>
                  </div>
                )}
                {(vesselProfile.lengthM != null || vesselProfile.beamM != null) && (
                  <div>
                    <dt>Size</dt>
                    <dd>
                      {vesselProfile.lengthM != null ? `${vesselProfile.lengthM} m` : "—"}
                      {" × "}
                      {vesselProfile.beamM != null ? `${vesselProfile.beamM} m` : "—"}
                    </dd>
                  </div>
                )}
                {vesselProfile.name && vesselProfile.name !== selectedVessel.name && (
                  <div>
                    <dt>Registry</dt>
                    <dd>{vesselProfile.name}</dd>
                  </div>
                )}
              </>
            )}
            {vesselProfile?.status === "not_found" && (
              <div>
                <dt>Details</dt>
                <dd>No public record found</dd>
              </div>
            )}
            {vesselProfile?.status === "error" && (
              <div>
                <dt>Details</dt>
                <dd>Lookup failed (will retry)</dd>
              </div>
            )}
          </dl>
        </aside>
      )}
      <div ref={mapRef} />
      <div className="timeline">
        <label>
          <span>
            {live ? "Live" : "Replay"}
            {vesselCount ? ` · ${vesselCount} vessel${vesselCount === 1 ? "" : "s"}` : ""}
            {selectedMmsi ? ` · track ${TRACK_HOURS}h` : ` · trails ${DEFAULT_TRAIL_MINUTES}m`}
          </span>
          <span>{new Date(scrubTs).toLocaleString()}</span>
        </label>
        {aisHint && <p className="ais-hint">{aisHint}</p>}
        <p className="ais-hint">
          Markers are colored by AIS ship type. Live view shows the last {DEFAULT_TRAIL_MINUTES} minutes of
          track for each vessel; click or search one for a {TRACK_HOURS}-hour track and details.
        </p>
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
