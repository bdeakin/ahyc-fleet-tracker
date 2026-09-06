import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import {
  AHYC_CENTER,
  AIS_SOURCE_LABELS,
  NOAA_CHART_WMS,
  collisionRiskMmsis,
  colorForShipType,
  distanceFromHomeNm,
  formatNm,
  markerNeedsDarkOutline,
  waterwayName,
  type AisSource,
  type ChartLayer,
  type VesselLiveState,
  type VesselProfile,
} from "@ahyc/shared";
import { api, liveSocket, type AishubStatus, type TrackHistorySpan } from "../api";

const HOURS = 48;
const TRACK_HOURS = 24;
const DEFAULT_TRAIL_MINUTES = 10;
/** Track window options for the selected vessel (hours). */
const TRACK_RANGE_OPTIONS: Array<{ hours: number; label: string }> = [
  { hours: 24, label: "24h" },
  { hours: 24 * 7, label: "7d" },
  { hours: 24 * 30, label: "30d" },
];
/** Individual markers at this zoom and closer (harbor/bay overview ≈ 9). */
const CLUSTER_DISABLE_ZOOM = 9;
/** Short trails only when zoomed in enough (and for selected / club). */
const TRAIL_MIN_ZOOM = 11;
const MAX_SHORT_TRAILS = 50;
const VIEWPORT_PAD = 0.2;
const VIEWPORT_DEBOUNCE_MS = 220;
/** Max vessel cards in the bottom tray (FIFO). */
/** Approx card width + gap used to compute how many tray cards fit. */
const TRAY_CARD_SLOT_PX = 168;

const TYPE_LEGEND: Array<{ color: string; label: string }> = [
  { color: "#1f6f8b", label: "AHYC club ★" },
  { color: "#ffffff", label: "Sailing" },
  { color: "#ec4899", label: "Pleasure" },
  { color: "#65a30d", label: "Fishing" },
  { color: "#ea580c", label: "Tug / tow" },
  { color: "#2563eb", label: "Passenger" },
  { color: "#475569", label: "Cargo" },
  { color: "#b91c1c", label: "Tanker" },
  { color: "#0891b2", label: "High speed" },
  { color: "#ca8a04", label: "Pilot / SAR" },
  { color: "#6b7280", label: "Other" },
];

const SOURCE_FILTERS: Array<{ id: AisSource; label: string }> = [
  { id: "radio", label: "Radio" },
  { id: "aishub", label: "AISHub" },
  { id: "aisstream", label: "AISStream" },
];

type TrafficCategory = "club" | "watch" | "other";

const TRAFFIC_CATEGORY_FILTERS: Array<{ id: TrafficCategory; label: string }> = [
  { id: "club", label: "Club boats" },
  { id: "watch", label: "Watch list" },
  { id: "other", label: "All other traffic" },
];

function markerColor(v: VesselLiveState): string {
  if (v.registered) return v.color ?? "#1f6f8b";
  if (v.color) return v.color;
  return colorForShipType(v.shipType);
}

function sourceAllowed(
  v: VesselLiveState,
  filter: Record<AisSource, boolean>,
): boolean {
  const src = (v.source ?? "unknown") as AisSource;
  return filter[src] !== false;
}

function categoryAllowed(
  v: VesselLiveState,
  filter: Record<TrafficCategory, boolean>,
  watched: Set<string>,
): boolean {
  if (v.registered) return filter.club !== false;
  if (v.watched || watched.has(v.mmsi) || watched.has(v.mmsi.padStart(9, "0"))) {
    return filter.watch !== false;
  }
  return filter.other !== false;
}

function mapBbox(map: L.Map): { minLat: number; minLon: number; maxLat: number; maxLon: number } {
  const b = map.getBounds().pad(VIEWPORT_PAD);
  return {
    minLat: b.getSouth(),
    minLon: b.getWest(),
    maxLat: b.getNorth(),
    maxLon: b.getEast(),
  };
}

function inMapBounds(v: VesselLiveState, map: L.Map | null): boolean {
  if (!map) return true;
  return map.getBounds().pad(VIEWPORT_PAD).contains([v.lat, v.lon]);
}

export function KioskPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<L.Map | null>(null);
  const layerRef = useRef<L.Layer | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | L.LayerGroup | null>(null);
  const clubLayerRef = useRef<L.LayerGroup | null>(null);
  const tracksRef = useRef<L.LayerGroup | null>(null);
  const liveVesselsRef = useRef<VesselLiveState[]>([]);
  const liveModeRef = useRef(true);
  const sourceFilterRef = useRef<Record<AisSource, boolean>>({
    radio: true,
    aishub: true,
    aisstream: true,
    vesselfinder: true,
    unknown: true,
  });
  const viewportTimerRef = useRef<number | null>(null);
  const viewportReqRef = useRef(0);
  const trackFitKeyRef = useRef<string | null>(null);

  const [charts, setCharts] = useState<ChartLayer[]>([]);
  const [chartId, setChartId] = useState("ocean-simple");
  const [live, setLive] = useState(true);
  const [rangeEnd, setRangeEnd] = useState(Date.now());
  const [slider, setSlider] = useState(HOURS * 60); // minutes from start of window
  const [aisHint, setAisHint] = useState<string | null>(null);
  const [vesselCount, setVesselCount] = useState(0);
  const [liveVessels, setLiveVessels] = useState<VesselLiveState[]>([]);
  const [selectedMmsi, setSelectedMmsi] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [trackRangeHours, setTrackRangeHours] = useState(TRACK_HOURS);
  const [trackPointCount, setTrackPointCount] = useState(0);
  const [vesselProfile, setVesselProfile] = useState<VesselProfile | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [mapZoom, setMapZoom] = useState(12);
  const [sourceFilter, setSourceFilter] = useState<Record<AisSource, boolean>>({
    radio: true,
    aishub: true,
    aisstream: true,
    vesselfinder: true,
    unknown: true,
  });
  const [trayMmsis, setTrayMmsis] = useState<string[]>([]);
  const trayCapacityRef = useRef(1);
  const trayMeasureRef = useRef<HTMLDivElement | null>(null);
  const [alertMmsis, setAlertMmsis] = useState<Set<string>>(() => new Set());
  const alertMmsisRef = useRef<Set<string>>(new Set());
  const [aishubStatus, setAishubStatus] = useState<AishubStatus | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const [categoryFilter, setCategoryFilter] = useState<Record<TrafficCategory, boolean>>({
    club: true,
    watch: true,
    other: true,
  });
  const categoryFilterRef = useRef(categoryFilter);
  const [watchMmsis, setWatchMmsis] = useState<Set<string>>(() => new Set());
  const watchMmsisRef = useRef<Set<string>>(new Set());
  const [historySpan, setHistorySpan] = useState<TrackHistorySpan | null>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const windowStart = useMemo(() => rangeEnd - HOURS * 3600_000, [rangeEnd]);
  const scrubTs = windowStart + slider * 60_000;

  sourceFilterRef.current = sourceFilter;
  categoryFilterRef.current = categoryFilter;
  watchMmsisRef.current = watchMmsis;
  liveModeRef.current = live;

  const selectedVessel = useMemo(
    () => liveVessels.find((v) => v.mmsi === selectedMmsi) ?? null,
    [liveVessels, selectedMmsi],
  );

  const selectedIsWatched = useMemo(() => {
    if (!selectedMmsi) return false;
    if (selectedVessel?.watched) return true;
    return watchMmsis.has(selectedMmsi) || watchMmsis.has(selectedMmsi.padStart(9, "0"));
  }, [selectedMmsi, selectedVessel, watchMmsis]);

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

  const trayCards = useMemo(() => {
    const byMmsi = new Map(liveVessels.map((v) => [v.mmsi, v]));
    return trayMmsis
      .map((mmsi) => byMmsi.get(mmsi))
      .filter((v): v is VesselLiveState => Boolean(v));
  }, [trayMmsis, liveVessels]);

  const aishubCountdownSec = useMemo(() => {
    if (!aishubStatus?.usernameConfigured) return null;
    const next = aishubStatus.nextAllowedCallAt;
    if (next == null) return 0;
    return Math.max(0, Math.ceil((next - nowTs) / 1000));
  }, [aishubStatus, nowTs]);

  function makeVesselMarker(v: VesselLiveState): L.Marker {
    const registered = Boolean(v.registered);
    const color = markerColor(v);
    const atRisk = alertMmsisRef.current.has(v.mmsi);
    const sog = v.sog ?? 0;
    const course =
      v.heading != null && Number.isFinite(v.heading) && v.heading >= 0 && v.heading < 360
        ? v.heading
        : v.cog != null && Number.isFinite(v.cog) && v.cog >= 0 && v.cog < 360
          ? v.cog
          : null;
    const moving = sog >= 0.5 && course != null;
    const size = moving ? (registered ? 28 : 22) : registered ? 18 : 12;
    const outlineStroke = markerNeedsDarkOutline(color) ? "#0f172a" : "#ffffff";
    const riskClass = atRisk ? " vessel-marker--alert" : "";
    const shapeClass = moving ? " vessel-marker--moving" : " vessel-marker--stopped";
    const pulse = atRisk
      ? `<span class="vessel-marker-pulse" aria-hidden="true"></span>`
      : "";
    const star = registered
      ? `<span class="vessel-marker-star" aria-hidden="true">★</span>`
      : "";
    // AIS-style shapes: circle when stopped; course arrow when moving (nose = heading/COG).
    const shape = moving
      ? `<svg class="vessel-marker-shape vessel-marker-arrow" viewBox="0 0 24 32" width="${size}" height="${Math.round(size * 1.25)}" style="transform:rotate(${course}deg)" aria-hidden="true">
          <path d="M12 1.5 L22 28.5 L12 23.5 L2 28.5 Z" fill="${color}" stroke="${outlineStroke}" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>`
      : `<svg class="vessel-marker-shape vessel-marker-circle" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="${color}" stroke="${outlineStroke}" stroke-width="2"/>
        </svg>`;
    const icon = L.divIcon({
      className:
        (registered ? "vessel-marker vessel-marker--club" : "vessel-marker vessel-marker--traffic") +
        shapeClass +
        riskClass,
      html: `${pulse}${star}${shape}`,
      iconSize: [size, moving ? Math.round(size * 1.25) : size],
      iconAnchor: [size / 2, moving ? Math.round(size * 1.25) / 2 : size / 2],
    });
    const marker = L.marker([v.lat, v.lon], {
      icon,
      zIndexOffset: atRisk ? 900 : registered ? 500 : 0,
      riseOnHover: true,
    });
    const label = v.name ?? v.mmsi;
    const typeBit = registered ? "AHYC club" : (v.shipTypeLabel ?? "traffic");
    const sourceBit = AIS_SOURCE_LABELS[(v.source ?? "unknown") as AisSource];
    marker.bindTooltip(
      `${label} (${typeBit} · ${sourceBit})${v.sog != null ? ` · ${v.sog.toFixed(1)} kn` : ""}`,
      { direction: "top", offset: [0, -10] },
    );
    marker.on("click", () => focusVessel(v));
    return marker;
  }

  function drawMarkers(vessels: VesselLiveState[]) {
    setVesselCount(vessels.length);
    setLiveVessels(vessels);
    liveVesselsRef.current = vessels;
    const cluster = clusterRef.current;
    const clubLayer = clubLayerRef.current;
    const map = mapObj.current;
    if (!cluster || !clubLayer) return;

    const filter = sourceFilterRef.current;
    const visible = vessels.filter((v) => sourceAllowed(v, filter));
    const risk = collisionRiskMmsis(visible);
    alertMmsisRef.current = risk;
    setAlertMmsis(risk);

    cluster.clearLayers();
    clubLayer.clearLayers();

    const traffic: L.Layer[] = [];
    const catFilter = categoryFilterRef.current;
    const watched = watchMmsisRef.current;
    for (const v of vessels) {
      if (!sourceAllowed(v, filter)) continue;
      if (!categoryAllowed(v, catFilter, watched)) continue;
      // Club boats outside the padded view still come from the API; skip drawing them until visible.
      if (v.registered && map && !inMapBounds(v, map) && v.mmsi !== selectedMmsi) continue;
      const marker = makeVesselMarker(v);
      if (v.registered) clubLayer.addLayer(marker);
      else traffic.push(marker);
    }
    if (traffic.length) {
      if ("addLayers" in cluster && typeof (cluster as L.MarkerClusterGroup).addLayers === "function") {
        (cluster as L.MarkerClusterGroup).addLayers(traffic);
      } else {
        for (const layer of traffic) cluster.addLayer(layer);
      }
    }
  }

  function fetchViewportLive() {
    const map = mapObj.current;
    if (!map || !liveModeRef.current) return;
    const reqId = ++viewportReqRef.current;
    const bbox = mapBbox(map);
    api
      .live(bbox)
      .then((vessels) => {
        if (reqId !== viewportReqRef.current) return;
        drawMarkers(vessels);
      })
      .catch(() => undefined);
  }

  function scheduleViewportLive() {
    if (viewportTimerRef.current != null) window.clearTimeout(viewportTimerRef.current);
    viewportTimerRef.current = window.setTimeout(() => {
      viewportTimerRef.current = null;
      fetchViewportLive();
    }, VIEWPORT_DEBOUNCE_MS);
  }

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
    // leaflet.markercluster expects a global L when bundled via Vite ESM.
    (window as unknown as { L: typeof L }).L = L;
    const map = L.map(mapRef.current, {
      center: [AHYC_CENTER.lat, AHYC_CENTER.lon],
      zoom: 12,
      // leaflet.markercluster requires maxZoom when disableClusteringAtZoom is set
      // (otherwise: "Map has no maxZoom specified" → blank kiosk).
      maxZoom: 18,
      minZoom: 3,
      zoomControl: false,
      attributionControl: true,
    });
    const clusterFactory = (L as unknown as { markerClusterGroup?: (opts?: object) => L.MarkerClusterGroup })
      .markerClusterGroup;
    const clusterOpts = {
      showCoverageOnHover: false,
      // Keep clusters small when zoomed out; at zoom ≥ 10 show every ship.
      maxClusterRadius: (zoom: number) => (zoom < 7 ? 55 : zoom < 9 ? 32 : 18),
      disableClusteringAtZoom: CLUSTER_DISABLE_ZOOM,
      spiderfyOnMaxZoom: true,
      chunkedLoading: true,
      removeOutsideVisibleBounds: true,
    };
    const cluster: L.MarkerClusterGroup | L.LayerGroup =
      typeof clusterFactory === "function" ? clusterFactory(clusterOpts) : L.layerGroup();
    if (typeof clusterFactory !== "function") {
      console.error("[kiosk] leaflet.markercluster failed to load — using plain layerGroup");
    }
    const clubLayer = L.layerGroup();
    cluster.addTo(map);
    clubLayer.addTo(map);
    tracksRef.current = L.layerGroup().addTo(map);
    clusterRef.current = cluster;
    clubLayerRef.current = clubLayer;
    mapObj.current = map;
    L.control.zoom({ position: "bottomright" }).addTo(map);
    setMapZoom(map.getZoom());

    const onViewChange = () => {
      setMapZoom(map.getZoom());
      scheduleViewportLive();
    };
    map.on("moveend", onViewChange);
    map.on("zoomend", onViewChange);

    return () => {
      map.off("moveend", onViewChange);
      map.off("zoomend", onViewChange);
      if (viewportTimerRef.current != null) window.clearTimeout(viewportTimerRef.current);
      map.remove();
      mapObj.current = null;
      clusterRef.current = null;
      clubLayerRef.current = null;
      tracksRef.current = null;
    };
    // scheduleViewportLive closes over live; map init runs once — live subscription handles fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapObj.current;
    if (!map) return;
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    const selected = charts.find((c) => c.id === chartId);
    if (selected?.kind === "xyz") {
      const group = L.layerGroup();
      selected.urls.forEach((url, i) => {
        L.tileLayer(url, {
          maxZoom: selected.maxZoom ?? 18,
          // Stretch last good tiles instead of fetching Esri's "Map data not yet available" blanks.
          maxNativeZoom: selected.maxNativeZoom ?? selected.maxZoom ?? 18,
          attribution: i === 0 ? selected.attribution : "",
        }).addTo(group);
      });
      layerRef.current = group;
    } else if (selected?.kind === "mbtiles") {
      layerRef.current = L.tileLayer(`/api/charts/${selected.id}/{z}/{x}/{y}.png`, {
        maxZoom: 18,
        attribution: "NOAA NCDS MBTiles (local)",
      });
    } else {
      layerRef.current = L.tileLayer.wms(NOAA_CHART_WMS, {
        layers: "0,1,2,3,4,5,6,7,8,9,10,11,12",
        format: "image/png",
        transparent: true,
        attribution: "NOAA Chart Display Service",
      });
    }
    layerRef.current.addTo(map);
  }, [chartId, charts]);

  useEffect(() => {
    if (!live) return;
    const ws = liveSocket((msg) => {
      const data = msg as { type: string; vessels?: VesselLiveState[]; vessel?: VesselLiveState };
      if (data.type === "snapshot" || data.type === "vessel" || data.type === "vessels") {
        scheduleViewportLive();
      }
    });
    fetchViewportLive();
    const tick = window.setInterval(() => {
      if (live) setRangeEnd(Date.now());
    }, 60_000);
    const refresh = window.setInterval(fetchViewportLive, 5_000);
    return () => {
      ws.close();
      window.clearInterval(tick);
      window.clearInterval(refresh);
      if (viewportTimerRef.current != null) window.clearTimeout(viewportTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  useEffect(() => {
    drawMarkers(liveVesselsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter, categoryFilter, watchMmsis]);

  useEffect(() => {
    if (live) return;
    api.replay(scrubTs).then(drawMarkers).catch(() => undefined);
    api
      .tracks(windowStart, scrubTs)
      .then((points) => {
        const group = tracksRef.current;
        const map = mapObj.current;
        if (!group) return;
        group.clearLayers();
        const bounds = map?.getBounds().pad(VIEWPORT_PAD);
        const byMmsi = new Map<string, L.LatLngExpression[]>();
        for (const p of points) {
          if (bounds && !bounds.contains([p.lat, p.lon])) continue;
          const arr = byMmsi.get(p.mmsi) ?? [];
          arr.push([p.lat, p.lon]);
          byMmsi.set(p.mmsi, arr);
        }
        for (const coords of byMmsi.values()) {
          L.polyline(coords, { color: "#3d8b8b", weight: 3, opacity: 0.85 }).addTo(group);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, scrubTs, windowStart]);

  // Live mode: short trails for nearby vessels when zoomed in; selected vessel uses chosen range.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;

    async function refreshTrails() {
      const group = tracksRef.current;
      const map = mapObj.current;
      if (!group) return;
      const vessels = liveVesselsRef.current.filter((v) => sourceAllowed(v, sourceFilterRef.current));
      const to = Date.now();
      const shortFrom = to - DEFAULT_TRAIL_MINUTES * 60_000;
      const longFrom = to - trackRangeHours * 3600_000;
      const zoom = map?.getZoom() ?? 0;

      const colorByMmsi = new Map(vessels.map((v) => [v.mmsi, markerColor(v)]));

      try {
        group.clearLayers();

        if (selectedMmsi) {
          const longPoints = await api.tracks(longFrom, to, selectedMmsi);
          if (cancelled) return;
          setTrackPointCount(longPoints.length);
          if (longPoints.length >= 2) {
            const coords = longPoints.map((p) => [p.lat, p.lon] as L.LatLngExpression);
            L.polyline(coords, {
              color: colorByMmsi.get(selectedMmsi) ?? "#c45c26",
              weight: 4,
              opacity: 0.92,
            }).addTo(group);
            const fitKey = `${selectedMmsi}:${trackRangeHours}`;
            if (map && trackFitKeyRef.current !== fitKey) {
              trackFitKeyRef.current = fitKey;
              try {
                map.fitBounds(L.latLngBounds(coords as L.LatLngTuple[]), {
                  padding: [48, 48],
                  maxZoom: 14,
                  animate: true,
                });
              } catch {
                /* ignore fit errors */
              }
            }
          }
        } else if (!cancelled) {
          setTrackPointCount(0);
        }

        const wantShort = zoom >= TRAIL_MIN_ZOOM;
        if (!wantShort) return;

        const trailCandidates = vessels
          .filter((v) => v.mmsi !== selectedMmsi)
          .filter((v) => v.registered || inMapBounds(v, map))
          .slice(0, MAX_SHORT_TRAILS);
        if (trailCandidates.length === 0) return;

        const points = await api.tracks(
          shortFrom,
          to,
          undefined,
          trailCandidates.map((v) => v.mmsi),
        );
        if (cancelled) return;

        const byMmsi = new Map<string, L.LatLngExpression[]>();
        for (const p of points) {
          if (!colorByMmsi.has(p.mmsi)) continue;
          const arr = byMmsi.get(p.mmsi) ?? [];
          arr.push([p.lat, p.lon]);
          byMmsi.set(p.mmsi, arr);
        }

        for (const [mmsi, coords] of byMmsi) {
          if (coords.length < 2) continue;
          L.polyline(coords, {
            color: colorByMmsi.get(mmsi) ?? "#6b7280",
            weight: 2,
            opacity: 0.55,
          }).addTo(group);
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
  }, [live, selectedMmsi, trackRangeHours, rangeEnd, vesselCount, mapZoom]);

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
    setTrackRangeHours(TRACK_HOURS);
    setTrackPointCount(0);
    trackFitKeyRef.current = null;
  }

  function focusVessel(v: VesselLiveState, opts?: { keepSearch?: boolean }) {
    const label = v.name ?? v.mmsi;
    setSelectedMmsi(v.mmsi);
    setSelectedLabel(label);
    setTrackRangeHours(TRACK_HOURS);
    setTrackPointCount(0);
    trackFitKeyRef.current = null;
    setTrayMmsis((prev) => {
      // Build left→right (oldest→newest). Drop oldest on the left when full.
      const next = prev.filter((m) => m !== v.mmsi);
      next.push(v.mmsi);
      const cap = Math.max(0, trayCapacityRef.current);
      while (cap > 0 && next.length > cap) next.shift();
      if (cap === 0) return [];
      return next;
    });
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

  const trailsNote =
    mapZoom >= TRAIL_MIN_ZOOM
      ? ` · trails ${DEFAULT_TRAIL_MINUTES}m`
      : " · trails when zoomed in";

  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      api
        .aishubStatus()
        .then((s) => {
          if (!cancelled) setAishubStatus(s);
        })
        .catch(() => undefined);
      api
        .watchlist()
        .then((rows) => {
          if (cancelled) return;
          setWatchMmsis(new Set(rows.map((r) => r.mmsi)));
        })
        .catch(() => undefined);
      api
        .trackHistory()
        .then((h) => {
          if (!cancelled) setHistorySpan(h);
        })
        .catch(() => undefined);
    };
    pull();
    const poll = window.setInterval(pull, 15_000);
    const tick = window.setInterval(() => setNowTs(Date.now()), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, []);

  function formatCountdown(sec: number | null): string {
    if (sec == null) return "—";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
  }

  function formatDuration(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
    const mins = Math.round(ms / 60_000);
    if (mins < 60) return `${mins}m`;
    const hours = ms / 3_600_000;
    if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
    const days = hours / 24;
    return `${days.toFixed(days < 10 ? 1 : 0)}d`;
  }

  async function toggleWatchlist() {
    if (!selectedVessel || watchBusy) return;
    const mmsi = selectedVessel.mmsi;
    setWatchBusy(true);
    try {
      if (selectedIsWatched) {
        await api.removeWatch(mmsi);
        setWatchMmsis((prev) => {
          const next = new Set(prev);
          next.delete(mmsi);
          next.delete(mmsi.padStart(9, "0"));
          return next;
        });
      } else {
        await api.addWatch(mmsi, selectedVessel.name ?? null);
        setWatchMmsis((prev) => new Set(prev).add(mmsi));
      }
      // Refresh markers so watched styling / filters update.
      drawMarkers(liveVesselsRef.current);
    } catch {
      /* ignore */
    } finally {
      setWatchBusy(false);
    }
  }


  useEffect(() => {
    const el = trayMeasureRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const applyCapacity = (width: number) => {
      const cap = Math.max(0, Math.floor(width / TRAY_CARD_SLOT_PX));
      trayCapacityRef.current = cap;
      // Window got narrower — rightmost cards fall off.
      setTrayMmsis((prev) => (prev.length > cap ? prev.slice(0, cap) : prev));
    };

    applyCapacity(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      applyCapacity(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function removeTrayMmsi(mmsi: string) {
    setTrayMmsis((prev) => prev.filter((m) => m !== mmsi));
  }

  return (
    <div className="kiosk">
      <div className="kiosk-brand">
        <h1>Atlantic Highlands Yacht Club</h1>
      </div>
      <p className="kiosk-tagline">Local sailing grounds · club & harbor traffic</p>
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
            : [
                {
                  id: "ocean-simple",
                  kind: "xyz" as const,
                  label: "Simplified ocean (depth + place names)",
                  urls: [],
                  attribution: "",
                  maxNativeZoom: 13,
                },
              ]
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
            <span
              className={`type-swatch${markerNeedsDarkOutline(item.color) ? " type-swatch--light" : ""}`}
              style={{ background: item.color }}
            />
            <span>{item.label}</span>
          </div>
        ))}
      </aside>
      <div className="map-filters" aria-label="Map filters">
        <aside className="source-filter" aria-label="AIS source filters">
          <div className="source-filter-title">AIS source</div>
          {SOURCE_FILTERS.map((item) => (
            <label key={item.id} className="source-filter-row">
              <input
                type="checkbox"
                checked={sourceFilter[item.id]}
                onChange={() =>
                  setSourceFilter((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                }
              />
              <span>{item.label}</span>
            </label>
          ))}
        </aside>
        <aside className="category-filter" aria-label="Traffic category filters">
          <div className="source-filter-title">Show</div>
          {TRAFFIC_CATEGORY_FILTERS.map((item) => (
            <label key={item.id} className="source-filter-row">
              <input
                type="checkbox"
                checked={categoryFilter[item.id]}
                onChange={() =>
                  setCategoryFilter((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                }
              />
              <span>{item.label}</span>
            </label>
          ))}
        </aside>
      <div className="vessel-tray-slot" ref={trayMeasureRef} aria-hidden={trayCards.length === 0}>
        {trayCards.length > 0 && (
        <aside className="vessel-tray" aria-label="Selected vessels">
          <div className="vessel-tray-cards">
            {trayCards.map((v) => {
              const nm = distanceFromHomeNm(v.lat, v.lon);
              const area = waterwayName(v.lat, v.lon);
              const alert = alertMmsis.has(v.mmsi);
              return (
                <div
                  key={v.mmsi}
                  className={alert ? "vessel-tray-card vessel-tray-card--alert" : "vessel-tray-card"}
                >
                  <button
                    type="button"
                    className="vessel-tray-card-main"
                    onClick={() => focusVessel(v)}
                  >
                    <span className="vessel-tray-name">{v.name || v.mmsi}</span>
                    <span className="vessel-tray-meta">
                      {v.sog != null ? `${v.sog.toFixed(1)} kn` : "— kn"} · {formatNm(nm)} from home
                    </span>
                    <span className="vessel-tray-area">{area}</span>
                  </button>
                  <button
                    type="button"
                    className="vessel-tray-remove"
                    aria-label={`Remove ${v.name || v.mmsi} from tray`}
                    onClick={() => removeTrayMmsi(v.mmsi)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      )}
      </div>
      </div>
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
                  <span
                    className={`type-swatch${markerNeedsDarkOutline(markerColor(v)) ? " type-swatch--light" : ""}`}
                    style={{ background: markerColor(v) }}
                  />
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
          <p className="vessel-search-empty">No vessels match in this view.</p>
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
          <div className="track-range" role="group" aria-label="Track history range">
            {TRACK_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.hours}
                type="button"
                className={trackRangeHours === opt.hours ? "track-range-btn active" : "track-range-btn"}
                onClick={() => setTrackRangeHours(opt.hours)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="track-range-meta">
            {trackPointCount > 0
              ? `Showing stored track · ${trackPointCount} point${trackPointCount === 1 ? "" : "s"}`
              : "No stored track points in this window"}
          </p>
          {!selectedVessel.registered && (
            <button
              type="button"
              className={selectedIsWatched ? "watch-toggle watch-toggle--on" : "watch-toggle"}
              onClick={() => void toggleWatchlist()}
              disabled={watchBusy}
            >
              {selectedIsWatched ? "Remove from watch list" : "Add to watch list"}
            </button>
          )}
          {selectedVessel.registered && (
            <p className="watch-toggle-note">Club vessel — tracks kept indefinitely.</p>
          )}
          {selectedIsWatched && !selectedVessel.registered && (
            <p className="watch-toggle-note">Watch list — track history kept indefinitely.</p>
          )}

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
              <dt>Source</dt>
              <dd>{AIS_SOURCE_LABELS[(selectedVessel.source ?? "unknown") as AisSource]}</dd>
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
              <dd>Last {trackRangeHours >= 24 ? `${trackRangeHours / 24} day${trackRangeHours / 24 === 1 ? "" : "s"}` : `${trackRangeHours} hours`}</dd>
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
            {vesselCount ? ` · ${vesselCount} in view` : ""}
            {selectedMmsi ? ` · track ${trackRangeHours >= 24 && trackRangeHours % 24 === 0 ? `${trackRangeHours / 24}d` : `${trackRangeHours}h`}` : trailsNote}
          </span>
          <span>{new Date(scrubTs).toLocaleString()}</span>
        </label>
        {aisHint && <p className="ais-hint">{aisHint}</p>}
        <p className="ais-hint ais-hint--status">
          {aishubStatus?.usernameConfigured ? (
            <>
              AISHub next refresh in <strong>{formatCountdown(aishubCountdownSec)}</strong>
              {aishubStatus.lastRegion ? ` · last ${aishubStatus.lastRegion}` : ""}
              {aishubStatus.lastFetched ? ` · ${aishubStatus.lastFetched} vessels` : ""}
              {" · "}
              {aishubStatus.outsideBboxClubCount === 0
                ? "no club vessels tracked outside the NE bbox"
                : `${aishubStatus.outsideBboxClubCount} club vessel${aishubStatus.outsideBboxClubCount === 1 ? "" : "s"} tracked outside the NE bbox`}
            </>
          ) : (
            <>AISHub not configured (set AISHUB_USERNAME for Northeast coverage).</>
          )}
        </p>
        <p className="ais-hint ais-hint--status">
          {historySpan ? (
            <>
              Stored AIS history: traffic {formatDuration(historySpan.trafficSpanMs)}
              {historySpan.trafficOldestTs
                ? ` (back to ${new Date(historySpan.trafficOldestTs).toLocaleString()})`
                : ""}
              {" · "}
              club/watch {formatDuration(historySpan.clubSpanMs)}
              {historySpan.clubOldestTs
                ? ` (back to ${new Date(historySpan.clubOldestTs).toLocaleString()})`
                : " (none yet)"}
              {" · "}
              other-traffic retention {formatDuration(historySpan.trafficRetentionMs)} · watch list kept forever
            </>
          ) : (
            <>Loading stored AIS history…</>
          )}
        </p>

        <p className="ais-hint">
          AIS refreshes every 5 seconds for the visible map area. Far overview still clusters lightly; from bay scale in, every ship is drawn.
          Short trails appear when zoomed in; click or search for a {TRACK_HOURS}-hour track and details.
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
