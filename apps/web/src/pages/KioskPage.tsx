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
  HISTORICAL_CHARTS,
  NOAA_CHART_WMS,
  NOAA_CHART_WMS_LAYERS_ALL,
  bearingToCardinal,
  chartTileUrl,
  collisionRiskMmsis,
  colorForShipType,
  describeRelativeBearing,
  distanceFromHomeNm,
  formatCourseDeg,
  formatNm,
  HISTORICAL_TILE_SIZE,
  historicalChartById,
  historicalMinNativeZoom,
  historicalNativeZoom,
  historicalTileUrl,
  noteworthyPlaybackTracks,
  noteworthyPlaybackWindow,
  positionAt,
  historicalChartsForView,
  markerNeedsDarkOutline,
  relativeVesselNav,
  speedTrackColor,
  SPEED_RUN_KN,
  waterwayName,
  type AisSource,
  type ChartLayer,
  type CpaResult,
  type GeoBounds,
  type NoteworthyEvent,
  type VesselLiveState,
  type VesselPhoto,
  type VesselProfile,
} from "@ahyc/shared";
import { burgeeSvg } from "../burgee";
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

const TYPE_LEGEND: Array<{ color: string; label: string; burgee?: boolean }> = [
  { color: "#1f6f8b", label: "AHYC club", burgee: true },
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

/** The club flag, drawn from the same markup the map markers use. */
function BurgeeGlyph({ height }: { height: number }) {
  return (
    <span
      className="burgee-glyph"
      role="img"
      aria-label="AHYC club boat"
      title="AHYC club boat"
      dangerouslySetInnerHTML={{ __html: burgeeSvg(height) }}
    />
  );
}

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

const NOTEWORTHY_HOURS = 24;
const NOTEWORTHY_REFRESH_MS = 3 * 60_000;

const NOTEWORTHY_KIND_LABEL: Record<NoteworthyEvent["kind"], string> = {
  interception: "Interceptions — vessels that converged",
  grounding: "Suspected groundings",
  speed: `Need for speed — over ${SPEED_RUN_KN} kn`,
  evasive: "Evasive maneuvers",
  nowake: "No-wake speeding",
};

/** Kind order in the picker: the rarer and more consequential first. */
const NOTEWORTHY_KIND_ORDER: Array<NoteworthyEvent["kind"]> = [
  "interception",
  "grounding",
  "speed",
  "evasive",
  "nowake",
];

function clockLabel(ts: number, withSeconds = false): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

function noteworthyLabel(e: NoteworthyEvent): string {
  switch (e.kind) {
    case "interception": {
      const a = e.a.name || e.a.mmsi;
      const b = e.b.name || e.b.mmsi;
      const lead = e.pilotTransfer ? "Pilot transfer" : "Rendezvous";
      return `${lead}: ${a} ↔ ${b} · ${e.place} · ${clockLabel(e.ts)}`;
    }
    case "grounding": {
      const depth = e.chartedDepthM != null ? `${(e.chartedDepthM * 3.281).toFixed(0)} ft` : "depth unknown";
      return `${e.name || e.mmsi} · ${e.confidence} · ${depth} · ${e.place} · ${clockLabel(e.ts)}`;
    }
    case "speed":
      return `${e.name || e.mmsi} · ${e.maxSogKn.toFixed(1)} kn · ${e.place} · ${clockLabel(e.ts)}`;
    case "evasive":
      return `${e.name || e.mmsi} · ${Math.round(e.cogDeltaDeg)}° turn at ${e.sogKn.toFixed(1)} kn · ${clockLabel(e.ts)}`;
    case "nowake":
      return `${e.name || e.mmsi} · ${e.maxSogKn.toFixed(1)} kn through a no-wake pocket · ${clockLabel(e.ts)}`;
  }
}

/** CPA range below which the pair is worth a second look at kiosk scale. */
const HISTORICAL_UNDERLAY_PANE = "historical-underlay";
const MOBILE_BREAKPOINT = 760;

function isPhoneLayout(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= MOBILE_BREAKPOINT;
}
/** Whole event window replays in about this long, whatever its real duration. */
const PLAYBACK_DURATION_MS = 14_000;
const PLAYBACK_COLORS = ["#5ec8ff", "#f6c26b"];

/** How far the playhead sits from the moment the event was logged. */
function playbackOffsetLabel(event: NoteworthyEvent, playhead: number | null): string {
  if (playhead == null) return "";
  const deltaSec = Math.round((playhead - event.ts) / 1000);
  if (Math.abs(deltaSec) < 20) return "at the event";
  const mins = Math.abs(deltaSec) / 60;
  const span = mins < 1 ? `${Math.abs(deltaSec)}s` : `${mins.toFixed(mins < 10 ? 1 : 0)} min`;
  return deltaSec < 0 ? `${span} before` : `${span} after`;
}
const CPA_WARN_NM = 0.15;
const CPA_WARN_TCPA_MIN = 15;

function cpaIsClose(cpa: CpaResult): boolean {
  if (cpa.tcpaMin == null || cpa.tcpaMin <= 0) return false;
  return cpa.dcpaNm <= CPA_WARN_NM && cpa.tcpaMin <= CPA_WARN_TCPA_MIN;
}

function formatCpa(cpa: CpaResult): string {
  if (cpa.tcpaMin == null) return `${formatNm(cpa.rangeNm)} (holding station)`;
  if (cpa.passed) return `${formatNm(cpa.rangeNm)} (opening)`;
  return formatNm(cpa.dcpaNm);
}

function formatTcpa(cpa: CpaResult): string {
  if (cpa.tcpaMin == null) return "no relative motion";
  if (cpa.tcpaMin <= 0) return "passed";
  if (cpa.tcpaMin < 1) return `${Math.round(cpa.tcpaMin * 60)}s`;
  if (cpa.tcpaMin < 60) return `${cpa.tcpaMin.toFixed(1)} min`;
  return `${(cpa.tcpaMin / 60).toFixed(1)} h`;
}

/** Live age since the vessel's last AIS / track timestamp (ticks with `nowMs`). */
function formatElapsedSince(ts: number, nowMs: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const sec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 48) return `${h}h ${rm}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function KioskPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<L.Map | null>(null);
  const layerRef = useRef<L.Layer | null>(null);
  const historicalLayerRef = useRef<L.TileLayer | null>(null);
  const playbackLayerRef = useRef<L.LayerGroup | null>(null);
  const noteworthyLayerRef = useRef<L.LayerGroup | null>(null);
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
  const [chartId, setChartId] = useState("noaa-paper");
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
  const [vesselPhoto, setVesselPhoto] = useState<VesselPhoto | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoBroken, setPhotoBroken] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mapZoom, setMapZoom] = useState(12);
  const [mapBounds, setMapBounds] = useState<GeoBounds | null>(null);
  /** When set, replaces the modern basemap with a georeferenced historical chart image. */
  const [historicalChartId, setHistoricalChartId] = useState<string | null>(null);
  const [noteworthyEvents, setNoteworthyEvents] = useState<NoteworthyEvent[]>([]);
  const [noteworthyId, setNoteworthyId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<Record<AisSource, boolean>>({
    radio: true,
    aishub: true,
    aisstream: true,
    vesselfinder: true,
    unknown: true,
  });
  /** Bottom tray stacks — each stack is one or more MMSIs (drag cards together to compare). */
  const [trayStacks, setTrayStacks] = useState<string[][]>([]);
  const [dragMmsi, setDragMmsi] = useState<string | null>(null);
  const [dropTargetMmsi, setDropTargetMmsi] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"layers" | "vessels" | null>(null);
  // Status lines are useful on a kiosk screen but eat a phone screen, so start folded there.
  const [ribbonOpen, setRibbonOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > MOBILE_BREAKPOINT,
  );
  const skipPanelOpenRef = useRef(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!selectedMmsi && trayStacks.length === 0) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [selectedMmsi, trayStacks.length]);
  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen]);

  /*
   * The live feed is viewport-scoped, but tray cards and the open detail pane must keep
   * updating after the map is panned or flown elsewhere, so those MMSIs ride along as
   * "pinned" on every request.
   */
  const pinnedMmsisRef = useRef<string[]>([]);
  useEffect(() => {
    const pinned = new Set<string>();
    for (const stack of trayStacks) for (const mmsi of stack) pinned.add(mmsi);
    if (selectedMmsi) pinned.add(selectedMmsi);
    pinnedMmsisRef.current = [...pinned];
  }, [trayStacks, selectedMmsi]);

  const trayCapacityRef = useRef(1);
  const trayMeasureRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const layersPanelRef = useRef<HTMLDivElement | null>(null);
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

  const trayStackCards = useMemo(() => {
    const byMmsi = new Map(liveVessels.map((v) => [v.mmsi, v]));
    return trayStacks
      .map((mmsis) =>
        mmsis
          .map((mmsi) => byMmsi.get(mmsi))
          .filter((v): v is VesselLiveState => Boolean(v)),
      )
      .filter((stack) => stack.length > 0);
  }, [trayStacks, liveVessels]);

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
    const moving = sog >= 1 && course != null;
    const size = moving ? (registered ? 28 : 22) : registered ? 18 : 12;
    const outlineStroke = markerNeedsDarkOutline(color) ? "#0f172a" : "#ffffff";
    const riskClass = atRisk ? " vessel-marker--alert" : "";
    const shapeClass = moving ? " vessel-marker--moving" : " vessel-marker--stopped";
    const pulse = atRisk
      ? `<span class="vessel-marker-pulse" aria-hidden="true"></span>`
      : "";
    // Club boats fly the burgee clear above their marker, whatever shape it is.
    const markerH = moving ? Math.round(size * 1.25) : size;
    const burgee = registered
      ? `<span class="vessel-marker-burgee" style="transform:translate(-50%,calc(-100% - ${Math.round(markerH / 2)}px))" aria-hidden="true">${burgeeSvg(22)}</span>`
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
      html: `${pulse}${burgee}${shape}`,
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
      .live(bbox, pinnedMmsisRef.current)
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

    const syncView = () => {
      setMapZoom(map.getZoom());
      const b = map.getBounds();
      setMapBounds({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      });
      scheduleViewportLive();
    };
    syncView();
    map.on("moveend", syncView);
    map.on("zoomend", syncView);

    return () => {
      map.off("moveend", syncView);
      map.off("zoomend", syncView);
      if (viewportTimerRef.current != null) window.clearTimeout(viewportTimerRef.current);
      map.remove();
      mapObj.current = null;
      clusterRef.current = null;
      clubLayerRef.current = null;
      tracksRef.current = null;
      historicalLayerRef.current = null;
      noteworthyLayerRef.current = null;
    };
    // scheduleViewportLive closes over live; map init runs once — live subscription handles fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableHistoricalCharts = useMemo(() => {
    if (!mapBounds) return [];
    return historicalChartsForView(mapBounds, mapZoom);
  }, [mapBounds, mapZoom]);

  /** Pick a historical chart, moving the map to its coverage when it is out of view. */
  function selectHistoricalChart(id: string | null) {
    setHistoricalChartId(id);
    if (!id) return;
    const chart = historicalChartById(id);
    const map = mapObj.current;
    if (!chart || !map) return;
    const inView = availableHistoricalCharts.some((c) => c.id === id);
    if (inView) return;
    map.flyToBounds(
      [
        [chart.bounds.south, chart.bounds.west],
        [chart.bounds.north, chart.bounds.east],
      ],
      { duration: 0.9, maxZoom: chart.maxZoom ?? 14 },
    );
  }

  const selectedNoteworthy = useMemo(
    () => noteworthyEvents.find((e) => e.id === noteworthyId) ?? null,
    [noteworthyEvents, noteworthyId],
  );

  /*
   * The bottom ribbon grows with AIS hint lines and the layer panel grows when an event is
   * selected, so the left-hand stack is positioned from measured heights instead of guesses.
   * Without this the pickers ended up underneath the ribbon and were unreachable.
   */
  useEffect(() => {
    const targets = [
      { el: timelineRef.current, prop: "--ribbon-h" },
      { el: layersPanelRef.current, prop: "--layers-h" },
    ].filter((t): t is { el: HTMLDivElement; prop: string } => Boolean(t.el));
    if (targets.length === 0 || typeof ResizeObserver === "undefined") return;

    const apply = () => {
      for (const { el, prop } of targets) {
        document.documentElement.style.setProperty(
          prop,
          `${Math.round(el.getBoundingClientRect().height)}px`,
        );
      }
    };
    apply();
    const observer = new ResizeObserver(apply);
    for (const { el } of targets) observer.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [aisHint, historySpan, selectedNoteworthy]);

  useEffect(() => {
    const load = () =>
      api
        .noteworthy(NOTEWORTHY_HOURS)
        .then((bundle) => setNoteworthyEvents(bundle.events))
        .catch(() => undefined);
    load();
    const id = window.setInterval(load, NOTEWORTHY_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  /*
   * Replay: the stored fixes an event was built from are played back as moving transponders,
   * so you can watch the approach instead of reading a static line on the chart.
   */
  const playbackWindow = useMemo(
    () => (selectedNoteworthy ? noteworthyPlaybackWindow(selectedNoteworthy) : null),
    [selectedNoteworthy],
  );

  useEffect(() => {
    if (!playbackWindow) {
      setPlayhead(null);
      setPlaying(false);
      return;
    }
    setPlayhead(playbackWindow.from);
    setPlaying(true);
  }, [playbackWindow]);

  useEffect(() => {
    if (!playing || !playbackWindow) return;
    const span = playbackWindow.to - playbackWindow.from;
    const rate = span / PLAYBACK_DURATION_MS;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const advance = (now - last) * rate;
      last = now;
      setPlayhead((cur) => {
        const next = (cur ?? playbackWindow.from) + advance;
        // Hold on the last frame for a beat, then run it again.
        return next >= playbackWindow.to ? playbackWindow.from : next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, playbackWindow]);

  // Transponders at the scrub time, redrawn in place as the playhead moves.
  useEffect(() => {
    const map = mapObj.current;
    if (!map) return;
    const event = selectedNoteworthy;
    if (!event || playhead == null) {
      if (playbackLayerRef.current) {
        map.removeLayer(playbackLayerRef.current);
        playbackLayerRef.current = null;
      }
      return;
    }
    const group = playbackLayerRef.current ?? L.layerGroup().addTo(map);
    playbackLayerRef.current = group;
    group.clearLayers();

    noteworthyPlaybackTracks(event).forEach((track, i) => {
      const at = positionAt(track.points, playhead);
      if (!at) return;
      const color = PLAYBACK_COLORS[i % PLAYBACK_COLORS.length]!;
      const label = track.name || track.mmsi;
      const speed = at.sog != null ? `${at.sog.toFixed(1)} kn` : "—";
      // Trail behind the transponder so the direction of travel reads at a glance.
      const trail = track.points
        .filter((p) => p.ts <= playhead)
        .map((p) => [p.lat, p.lon] as L.LatLngExpression);
      trail.push([at.lat, at.lon]);
      if (trail.length > 1) {
        L.polyline(trail, { color, weight: 3, opacity: 0.95 }).addTo(group);
      }
      L.marker([at.lat, at.lon], {
        icon: L.divIcon({
          className: `playback-marker${at.stale ? " playback-marker--stale" : ""}`,
          html: `<svg viewBox="0 0 24 32" width="22" height="28" style="transform:rotate(${at.cog ?? 0}deg)" aria-hidden="true">
              <path d="M12 1.5 L22 28.5 L12 23.5 L2 28.5 Z" fill="${color}" stroke="#0b1622" stroke-width="1.6" stroke-linejoin="round"/>
            </svg><span class="playback-marker-label">${label} · ${speed}</span>`,
          iconSize: [22, 28],
          iconAnchor: [11, 14],
        }),
        interactive: false,
        zIndexOffset: 1200,
      }).addTo(group);
    });

    return undefined;
  }, [selectedNoteworthy, playhead]);

  // Draw the selected event: both tracks, the moment it happened, and fit the view to it.
  useEffect(() => {
    const map = mapObj.current;
    if (!map) return;
    if (noteworthyLayerRef.current) {
      map.removeLayer(noteworthyLayerRef.current);
      noteworthyLayerRef.current = null;
    }
    const event = selectedNoteworthy;
    if (!event) return;

    const group = L.layerGroup();
    const latlngs: L.LatLngExpression[] = [];

    const addTrack = (track: Array<{ lat: number; lon: number; sog: number | null }>, color: string, label: string) => {
      if (track.length === 0) return;
      const coords = track.map((p) => [p.lat, p.lon] as L.LatLngExpression);
      latlngs.push(...coords);
      L.polyline(coords, { color, weight: 4, opacity: 0.9 }).bindTooltip(label).addTo(group);
    };

    if (event.kind === "interception") {
      addTrack(event.a.track, "#5ec8ff", event.a.name || event.a.mmsi);
      addTrack(event.b.track, "#f6c26b", event.b.name || event.b.mmsi);
      L.circle([event.lat, event.lon], {
        radius: Math.max(60, event.closestNm * 1852),
        color: "#f87171",
        weight: 2,
        fillOpacity: 0.12,
      })
        .bindTooltip(`Closest approach ${formatNm(event.closestNm)} at ${clockLabel(event.ts)}`)
        .addTo(group);
      latlngs.push([event.lat, event.lon]);
    } else if (event.kind === "grounding") {
      addTrack(event.track, "#f87171", event.name || event.mmsi);
      L.circleMarker([event.lat, event.lon], {
        radius: 10,
        color: "#f87171",
        fillColor: "#7f1d1d",
        fillOpacity: 0.8,
        weight: 3,
      })
        .bindTooltip(`Stopped from ${event.sogBeforeKn.toFixed(1)} kn at ${clockLabel(event.ts)}`)
        .addTo(group);
      latlngs.push([event.lat, event.lon]);
    } else if (event.kind === "speed") {
      for (let i = 1; i < event.track.length; i++) {
        const prev = event.track[i - 1]!;
        const cur = event.track[i]!;
        L.polyline(
          [
            [prev.lat, prev.lon],
            [cur.lat, cur.lon],
          ],
          { color: speedTrackColor(cur.sog ?? prev.sog ?? 0, SPEED_RUN_KN, 45), weight: 5, opacity: 0.95 },
        ).addTo(group);
        latlngs.push([prev.lat, prev.lon], [cur.lat, cur.lon]);
      }
      L.circleMarker([event.lat, event.lon], {
        radius: 8,
        color: "#facc15",
        fillColor: "#b45309",
        fillOpacity: 0.85,
        weight: 3,
      })
        .bindTooltip(`${event.maxSogKn.toFixed(1)} kn at ${clockLabel(event.ts)}`)
        .addTo(group);
    } else if (event.kind === "evasive") {
      addTrack(event.track, "#facc15", event.name || event.mmsi);
      for (const other of event.nearby) {
        L.circleMarker([other.lat, other.lon], {
          radius: 6,
          color: "#94a3b8",
          fillOpacity: 0.7,
          weight: 2,
        })
          .bindTooltip(`${other.name || other.mmsi} · ${formatNm(other.distanceNm)} off`)
          .addTo(group);
        latlngs.push([other.lat, other.lon]);
      }
      latlngs.push([event.lat, event.lon]);
    } else {
      // Speed-coloured segments make the run through the no-wake pocket obvious.
      for (let i = 1; i < event.track.length; i++) {
        const prev = event.track[i - 1]!;
        const cur = event.track[i]!;
        L.polyline(
          [
            [prev.lat, prev.lon],
            [cur.lat, cur.lon],
          ],
          { color: speedTrackColor(cur.sog ?? prev.sog ?? 0), weight: 5, opacity: 0.95 },
        ).addTo(group);
        latlngs.push([prev.lat, prev.lon], [cur.lat, cur.lon]);
      }
      latlngs.push([event.lat, event.lon]);
    }

    group.addTo(map);
    noteworthyLayerRef.current = group;
    if (latlngs.length > 0) {
      map.flyToBounds(L.latLngBounds(latlngs).pad(0.35), { duration: 0.9, maxZoom: 15 });
    }
  }, [selectedNoteworthy]);

  useEffect(() => {
    const map = mapObj.current;
    if (!map) return;
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
    if (historicalLayerRef.current) {
      map.removeLayer(historicalLayerRef.current);
      historicalLayerRef.current = null;
    }

    const historical = historicalChartById(historicalChartId);
    if (historical) {
      const { south, west, north, east } = historical.bounds;
      /*
       * Served as tiles rather than one imageOverlay: a 20-megapixel scan scaled past about
       * ten thousand pixels stops being painted by the browser, leaving bare paper behind.
       */
      const overlay = L.tileLayer(historicalTileUrl(historical.id), {
        bounds: L.latLngBounds([south, west], [north, east]),
        minNativeZoom: historicalMinNativeZoom(historical),
        maxNativeZoom: historicalNativeZoom(historical),
        maxZoom: 18,
        tileSize: HISTORICAL_TILE_SIZE,
        noWrap: true,
        attribution: historical.attribution,
      });
      /*
       * Neutral paper behind the sheet, in its own pane below the tile pane — as a normal
       * overlay it would sit above the tiles and hide the chart entirely.
       */
      if (!map.getPane(HISTORICAL_UNDERLAY_PANE)) {
        const pane = map.createPane(HISTORICAL_UNDERLAY_PANE);
        pane.style.zIndex = "150";
        pane.style.pointerEvents = "none";
      }
      const underlay = L.rectangle(
        [
          [south, west],
          [north, east],
        ],
        {
          stroke: false,
          fillColor: "#d8c9a8",
          fillOpacity: 1,
          interactive: false,
          pane: HISTORICAL_UNDERLAY_PANE,
        },
      );
      const group = L.layerGroup([underlay, overlay]);
      group.addTo(map);
      layerRef.current = group;
      historicalLayerRef.current = overlay;
      return;
    }

    const selected = charts.find((c) => c.id === chartId);
    if (selected?.kind === "xyz") {
      const group = L.layerGroup();
      selected.urls.forEach((entry, i) => {
        const tile = chartTileUrl(entry);
        L.tileLayer(tile.url, {
          maxZoom: tile.maxZoom ?? selected.maxZoom ?? 18,
          // Per-URL native zoom: Esri Ocean caps ~z13; Carto/OpenSeaMap stay sharp at harbor zoom.
          maxNativeZoom:
            tile.maxNativeZoom ?? selected.maxNativeZoom ?? tile.maxZoom ?? selected.maxZoom ?? 18,
          // Seamark labels are baked into the tiles, so that overlay waits for close zooms.
          minZoom: tile.minZoom ?? 0,
          opacity: tile.opacity ?? 1,
          subdomains: tile.subdomains ?? "abc",
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
      // NOAA ENC via the Maritime Chart Service. The layer's S-52 parameters decide whether
      // it draws like a paper chart or the full ECDIS display.
      layerRef.current = L.tileLayer.wms(selected?.url ?? NOAA_CHART_WMS, {
        layers: selected?.layers ?? NOAA_CHART_WMS_LAYERS_ALL,
        format: "image/png",
        transparent: selected?.transparent ?? true,
        maxZoom: selected?.maxZoom ?? 18,
        attribution: selected?.attribution ?? "NOAA Chart Display Service",
        ...(selected?.params ?? {}),
      });
    }
    layerRef.current.addTo(map);
  }, [chartId, charts, historicalChartId]);

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

  /*
   * Tapping a ship on a phone should show its card; picking one from the search list inside
   * the drawer should not, because the point of that tap is to look at the map.
   */
  useEffect(() => {
    if (!selectedMmsi) return;
    if (skipPanelOpenRef.current) {
      skipPanelOpenRef.current = false;
      return;
    }
    if (isPhoneLayout()) setMobilePanel("vessels");
  }, [selectedMmsi]);

  /*
   * Photo lookup runs on click only, and the server scrapes it fresh each time (nothing is
   * stored locally), so the pane shows a placeholder while the public sources are queried.
   */
  useEffect(() => {
    if (!selectedMmsi) {
      setVesselPhoto(null);
      setPhotoBroken(false);
      setPhotoLoading(false);
      return;
    }
    let cancelled = false;
    setVesselPhoto(null);
    setPhotoBroken(false);
    setPhotoLoading(true);
    api
      .vesselPhoto(selectedMmsi, selectedVessel?.name ?? null)
      .then((photo) => {
        if (cancelled) return;
        setVesselPhoto(photo);
      })
      .catch(() => {
        if (!cancelled) setVesselPhoto(null);
      })
      .finally(() => {
        if (!cancelled) setPhotoLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The name is only a lookup hint; re-running on every live update would spam the sources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMmsi]);

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
    setTrayStacks((prev) => {
      // Remove this MMSI from any existing stack, then append as its own card (newest on the right).
      const without = prev
        .map((stack) => stack.filter((m) => m !== v.mmsi))
        .filter((stack) => stack.length > 0);
      const next = [...without, [v.mmsi]];
      const cap = Math.max(0, trayCapacityRef.current);
      let total = next.reduce((n, s) => n + s.length, 0);
      while (cap > 0 && total > cap && next.length) {
        const first = next[0]!;
        first.shift();
        if (first.length === 0) next.shift();
        total -= 1;
      }
      if (cap === 0) return [];
      return next;
    });
    if (!opts?.keepSearch) setSearchQuery("");
    if (isPhoneLayout()) {
      skipPanelOpenRef.current = true;
      setMobilePanel(null);
    }
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
      setTrayStacks((prev) => {
        let total = prev.reduce((n, s) => n + s.length, 0);
        if (total <= cap) return prev;
        const next = prev.map((s) => [...s]);
        while (total > cap && next.length) {
          const first = next[0]!;
          first.shift();
          if (first.length === 0) next.shift();
          total -= 1;
        }
        return next;
      });
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
    setTrayStacks((prev) =>
      prev
        .map((stack) => stack.filter((m) => m !== mmsi))
        .filter((stack) => stack.length > 0),
    );
  }

  function unstackTray(mmsi: string) {
    setTrayStacks((prev) => {
      const next: string[][] = [];
      for (const stack of prev) {
        if (!stack.includes(mmsi) || stack.length < 2) {
          next.push(stack);
          continue;
        }
        for (const m of stack) next.push([m]);
      }
      return next;
    });
  }

  function stackTrayMmsis(fromMmsi: string, ontoMmsi: string) {
    if (!fromMmsi || !ontoMmsi || fromMmsi === ontoMmsi) return;
    setTrayStacks((prev) => {
      const srcIdx = prev.findIndex((s) => s.includes(fromMmsi));
      const dstIdx = prev.findIndex((s) => s.includes(ontoMmsi));
      if (srcIdx < 0 || dstIdx < 0) return prev;
      if (srcIdx === dstIdx) return prev;
      const next = prev.map((s) => [...s]);
      const src = next[srcIdx]!;
      const dst = next[dstIdx]!;
      // Move the dragged MMSI onto the target stack (keep relative order of the rest).
      next[srcIdx] = src.filter((m) => m !== fromMmsi);
      if (!dst.includes(fromMmsi)) dst.push(fromMmsi);
      return next.filter((s) => s.length > 0);
    });
  }


  function renderNoteworthyDetail(event: NoteworthyEvent) {
    const playback = playbackWindow;
    const rows: Array<[string, string]> = [];
    let title = "";
    if (event.kind === "interception") {
      title = event.pilotTransfer ? "Suspected pilot transfer" : "Vessels converged";
      rows.push(
        [event.a.name || event.a.mmsi, `${event.a.sogKn?.toFixed(1) ?? "—"} kn · ${formatCourseDeg(event.a.cogDeg)}${event.a.pilot ? " · pilot" : ""}`],
        [event.b.name || event.b.mmsi, `${event.b.sogKn?.toFixed(1) ?? "—"} kn · ${formatCourseDeg(event.b.cogDeg)}${event.b.pilot ? " · pilot" : ""}`],
        ["Closest", `${formatNm(event.closestNm)} at ${clockLabel(event.ts)}`],
        ["Closed from", formatNm(event.approachFromNm)],
        ["Course match", event.matchedCourse ? `yes (${Math.round(event.courseAlignDeg)}° apart)` : `no (${Math.round(event.courseAlignDeg)}° apart)`],
        ["Where", event.pilotArea ?? event.place],
      );
    } else if (event.kind === "grounding") {
      title = event.confidence === "likely" ? "Likely grounding" : "Possible grounding";
      const depthFt = event.chartedDepthM != null ? `${(event.chartedDepthM * 3.281).toFixed(0)} ft` : "unknown";
      const draughtFt = event.draughtM != null ? `${(event.draughtM * 3.281).toFixed(0)} ft est.` : "unknown";
      rows.push(
        ["Vessel", event.name || event.mmsi],
        ["Stopped", `${event.sogBeforeKn.toFixed(1)} kn → 0 at ${clockLabel(event.ts)}`],
        ["Stayed put", `${Math.round(event.stoppedForMs / 60_000)} min`],
        ["Surveyed depth", depthFt],
        ["Draught", draughtFt],
        ["Under keel", event.clearanceM != null ? `${(event.clearanceM * 3.281).toFixed(1)} ft` : "unknown"],
        ["Where", event.place],
      );
    } else if (event.kind === "speed") {
      title = "Need for speed";
      rows.push(
        ["Vessel", event.name || event.mmsi],
        ["Top speed", `${event.maxSogKn.toFixed(1)} kn`],
        ["Average", `${event.meanSogKn.toFixed(1)} kn`],
        ["Held for", `${Math.max(1, Math.round(event.durationMs / 60_000))} min · ${formatNm(event.distanceNm)}`],
        ["Where", event.place],
        ["Time", clockLabel(event.ts)],
      );
    } else if (event.kind === "evasive") {
      title = "Evasive maneuver";
      rows.push(
        ["Vessel", event.name || event.mmsi],
        ["Turn", `${Math.round(event.cogDeltaDeg)}° at ${event.sogKn.toFixed(1)} kn`],
        ["Rate", `${Math.round(event.turnRateDegPerMin)}°/min`],
        ["Time", clockLabel(event.ts)],
        ["Traffic nearby", event.nearby.length > 0 ? `${event.nearby.length} within 0.45 nm` : "none reported"],
      );
    } else {
      title = "No-wake speeding";
      rows.push(
        ["Vessel", event.name || event.mmsi],
        ["Peak speed", `${event.maxSogKn.toFixed(1)} kn`],
        ["Average", `${event.meanSogKn.toFixed(1)} kn`],
        ["Time", clockLabel(event.ts)],
      );
    }
    return (
      <>
        <div className="noteworthy-detail-title">{title}</div>
        {rows.map(([label, value]) => (
          <div key={label} className="noteworthy-detail-row">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
        {playback && (
          <div className="noteworthy-scrub">
            <div className="noteworthy-scrub-head">
              <button
                type="button"
                className="noteworthy-scrub-play"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? "Pause replay" : "Play replay"}
              >
                {playing ? "❚❚" : "▶"}
              </button>
              <span className="noteworthy-scrub-clock">{clockLabel(playhead ?? playback.from, true)}</span>
              <span className="noteworthy-scrub-offset">{playbackOffsetLabel(event, playhead)}</span>
            </div>
            <input
              type="range"
              className="noteworthy-scrub-range"
              min={playback.from}
              max={playback.to}
              step={1000}
              value={playhead ?? playback.from}
              aria-label="Scrub through the event"
              onChange={(e) => {
                setPlaying(false);
                setPlayhead(Number(e.target.value));
              }}
            />
            <div className="noteworthy-scrub-legend">
              {noteworthyPlaybackTracks(event).map((track, i) => (
                <span key={track.mmsi}>
                  <i style={{ background: PLAYBACK_COLORS[i % PLAYBACK_COLORS.length] }} />
                  {track.name || track.mmsi}
                </span>
              ))}
            </div>
          </div>
        )}
        <button type="button" className="noteworthy-clear" onClick={() => setNoteworthyId(null)}>
          Clear event
        </button>
      </>
    );
  }

  function renderRelativeNav(a: VesselLiveState, b: VesselLiveState) {
    const nav = relativeVesselNav(
      { lat: a.lat, lon: a.lon, sog: a.sog, cog: a.cog, heading: a.heading },
      { lat: b.lat, lon: b.lon, sog: b.sog, cog: b.cog, heading: b.heading },
    );
    const nameA = a.name || a.mmsi;
    const nameB = b.name || b.mmsi;
    return (
      <div className="vessel-tray-compare" aria-label={`Relative navigation ${nameA} and ${nameB}`}>
        <div className="vessel-tray-compare-title">
          {nameA} ↔ {nameB}
        </div>
        <div className="vessel-tray-compare-row">
          <span>Distance</span>
          <strong>{formatNm(nav.distanceNm)}</strong>
        </div>
        <div
          className={`vessel-tray-compare-row${cpaIsClose(nav.cpa) ? " vessel-tray-compare-row--warn" : ""}`}
        >
          <span>CPA</span>
          <strong>{formatCpa(nav.cpa)}</strong>
        </div>
        <div className="vessel-tray-compare-row">
          <span>TCPA</span>
          <strong>{formatTcpa(nav.cpa)}</strong>
        </div>
        <div className="vessel-tray-compare-row">
          <span>{nameA} → {nameB}</span>
          <strong>
            {formatCourseDeg(nav.bearingAbDeg)} {bearingToCardinal(nav.bearingAbDeg)}
          </strong>
        </div>
        <div className="vessel-tray-compare-row">
          <span>{nameB} → {nameA}</span>
          <strong>
            {formatCourseDeg(nav.bearingBaDeg)} {bearingToCardinal(nav.bearingBaDeg)}
          </strong>
        </div>
        <div className="vessel-tray-compare-row">
          <span>COG</span>
          <strong>
            {nameA} {formatCourseDeg(nav.cogA)}
            {nav.sogA != null ? ` ${nav.sogA.toFixed(1)} kn` : ""} · {nameB} {formatCourseDeg(nav.cogB)}
            {nav.sogB != null ? ` ${nav.sogB.toFixed(1)} kn` : ""}
          </strong>
        </div>
        {nav.relativeFromADeg != null && (
          <div className="vessel-tray-compare-row">
            <span>Rel from {nameA}</span>
            <strong>
              {formatCourseDeg(nav.relativeFromADeg)} ({describeRelativeBearing(nav.relativeFromADeg)})
            </strong>
          </div>
        )}
        {nav.relativeFromBDeg != null && (
          <div className="vessel-tray-compare-row">
            <span>Rel from {nameB}</span>
            <strong>
              {formatCourseDeg(nav.relativeFromBDeg)} ({describeRelativeBearing(nav.relativeFromBDeg)})
            </strong>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`kiosk${mobilePanel ? ` kiosk--drawer-${mobilePanel}` : ""}`}>
      <div className="kiosk-brand">
        <h1>Atlantic Highlands Yacht Club</h1>
      </div>
      <p className="kiosk-tagline">Local sailing grounds · club & harbor traffic</p>
      <div className="kiosk-actions">
        <button
          type="button"
          className="kiosk-help-btn"
          aria-label="Help — how to use this map"
          title="Help"
          onClick={() => setHelpOpen(true)}
        >
          ?
        </button>
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
      {/* Phone layout: the panels ride in drawers so the chart is not buried under them. */}
      <div className="mobile-tabs">
        <button
          type="button"
          className={mobilePanel === "layers" ? "mobile-tab mobile-tab--on" : "mobile-tab"}
          aria-expanded={mobilePanel === "layers"}
          onClick={() => setMobilePanel((cur) => (cur === "layers" ? null : "layers"))}
        >
          Layers
        </button>
        <button
          type="button"
          className={mobilePanel === "vessels" ? "mobile-tab mobile-tab--on" : "mobile-tab"}
          aria-expanded={mobilePanel === "vessels"}
          onClick={() => setMobilePanel((cur) => (cur === "vessels" ? null : "vessels"))}
        >
          Vessels
        </button>
      </div>
      {mobilePanel && (
        <button
          type="button"
          className="mobile-scrim"
          aria-label="Close panel"
          onClick={() => setMobilePanel(null)}
        />
      )}
      <div className="drawer drawer--left">
      <div className="drawer-head">
        <span>Layers &amp; filters</span>
        <button type="button" onClick={() => setMobilePanel(null)} aria-label="Close panel">
          ×
        </button>
      </div>
      <div className="map-layers" role="region" aria-label="Chart and event layers" ref={layersPanelRef}>
        <div className="map-layers-row">
          <label className="map-layers-field">
            <span>Chart</span>
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
          </label>
          <label className="map-layers-field">
            <span>Historical chart</span>
            <select
              value={historicalChartId ?? ""}
              aria-label="Historical chart overlay"
              onChange={(e) => selectHistoricalChart(e.target.value || null)}
            >
              <option value="">Modern chart</option>
              {HISTORICAL_CHARTS.map((c) => {
                const inView = availableHistoricalCharts.some((x) => x.id === c.id);
                return (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {inView ? "" : " — jump to coverage"}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="map-layers-field">
            <span>Noteworthy traffic</span>
            <select
              value={noteworthyId ?? ""}
              aria-label="Noteworthy traffic events"
              onChange={(e) => setNoteworthyId(e.target.value || null)}
            >
              <option value="">
                {noteworthyEvents.length > 0
                  ? `None — ${noteworthyEvents.length} in last ${NOTEWORTHY_HOURS}h`
                  : "None found in stored traffic"}
              </option>
              {NOTEWORTHY_KIND_ORDER.map((kind) => {
                const group = noteworthyEvents.filter((e) => e.kind === kind);
                if (group.length === 0) return null;
                return (
                  <optgroup key={kind} label={`${NOTEWORTHY_KIND_LABEL[kind]} (${group.length})`}>
                    {group.map((e) => (
                      <option key={e.id} value={e.id}>
                        {noteworthyLabel(e)}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>
        </div>
        {selectedNoteworthy && (
          <div className="noteworthy-detail">{renderNoteworthyDetail(selectedNoteworthy)}</div>
        )}
      </div>
      <aside className="type-legend" aria-label="Vessel type colors">
        {TYPE_LEGEND.map((item) => (
          <div key={item.label} className="type-legend-row">
            <span
              className={`type-swatch${markerNeedsDarkOutline(item.color) ? " type-swatch--light" : ""}`}
              style={{ background: item.color }}
            />
            <span>{item.label}</span>
            {item.burgee && <BurgeeGlyph height={18} />}
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
      <div className="vessel-tray-slot" ref={trayMeasureRef} aria-hidden={trayStackCards.length === 0}>
        {trayStackCards.length > 0 && (
        <aside className="vessel-tray" aria-label="Selected vessels">
          <div className="vessel-tray-hint">Drag a card onto another to compare distance, bearing &amp; COG</div>
          <div className="vessel-tray-cards">
            {trayStackCards.map((stack) => {
              const primary = stack[0]!;
              const alert = stack.some((v) => alertMmsis.has(v.mmsi));
              const isDropTarget = dropTargetMmsi != null && stack.some((v) => v.mmsi === dropTargetMmsi);
              const stacked = stack.length > 1;
              return (
                <div
                  key={stack.map((v) => v.mmsi).join("-")}
                  className={[
                    "vessel-tray-stack",
                    alert ? "vessel-tray-stack--alert" : "",
                    stacked ? "vessel-tray-stack--paired" : "",
                    isDropTarget ? "vessel-tray-stack--drop" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropTargetMmsi(primary.mmsi);
                  }}
                  onDragLeave={() => {
                    setDropTargetMmsi((cur) => (cur === primary.mmsi ? null : cur));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = e.dataTransfer.getData("text/mmsi") || dragMmsi;
                    setDropTargetMmsi(null);
                    setDragMmsi(null);
                    if (from) stackTrayMmsis(from, primary.mmsi);
                  }}
                >
                  {stack.map((v, idx) => {
                    const nm = distanceFromHomeNm(v.lat, v.lon);
                    const area = waterwayName(v.lat, v.lon);
                    return (
                      <div
                        key={v.mmsi}
                        className={
                          alertMmsis.has(v.mmsi)
                            ? "vessel-tray-card vessel-tray-card--alert"
                            : "vessel-tray-card"
                        }
                        style={idx > 0 ? { marginTop: "-0.35rem" } : undefined}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/mmsi", v.mmsi);
                          e.dataTransfer.effectAllowed = "move";
                          setDragMmsi(v.mmsi);
                        }}
                        onDragEnd={() => {
                          setDragMmsi(null);
                          setDropTargetMmsi(null);
                        }}
                      >
                        <button
                          type="button"
                          className="vessel-tray-card-main"
                          onClick={() => focusVessel(v)}
                        >
                          <span className="vessel-tray-name">{v.name || v.mmsi}</span>
                          <span className="vessel-tray-meta">
                            {v.sog != null ? `${v.sog.toFixed(1)} kn` : "— kn"}
                            {v.cog != null ? ` · COG ${formatCourseDeg(v.cog)}` : ""}
                            {" · "}
                            {formatNm(nm)} from home
                          </span>
                          <span
                            className="vessel-tray-age"
                            title={new Date(v.ts).toLocaleString()}
                          >
                            Last report {formatElapsedSince(v.ts, nowMs)}
                          </span>
                          <span className="vessel-tray-area">{area}</span>
                        </button>
                        <div className="vessel-tray-card-actions">
                          {stacked && (
                            <button
                              type="button"
                              className="vessel-tray-unstack"
                              aria-label={`Unstack ${v.name || v.mmsi}`}
                              title="Separate stacked cards"
                              onClick={() => unstackTray(v.mmsi)}
                            >
                              ⧉
                            </button>
                          )}
                          <button
                            type="button"
                            className="vessel-tray-remove"
                            aria-label={`Remove ${v.name || v.mmsi} from tray`}
                            onClick={() => removeTrayMmsi(v.mmsi)}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {stacked &&
                    stack.slice(1).map((other) => (
                      <div key={`cmp-${primary.mmsi}-${other.mmsi}`}>{renderRelativeNav(primary, other)}</div>
                    ))}
                </div>
              );
            })}
          </div>
        </aside>
      )}
      </div>
      </div>
      </div>
      <div className="drawer drawer--right">
      <div className="drawer-head">
        <span>Vessels</span>
        <button type="button" onClick={() => setMobilePanel(null)} aria-label="Close panel">
          ×
        </button>
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
                    {v.registered ? <BurgeeGlyph height={16} /> : v.shipTypeLabel || "Traffic"}
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
            <h2>
              {selectedVessel.name || selectedVessel.mmsi}
              {selectedVessel.registered && <BurgeeGlyph height={18} />}
            </h2>
            <button type="button" className="vessel-pane-close" onClick={clearSelection} aria-label="Close">
              ×
            </button>
          </header>
          {photoLoading && <p className="vessel-photo-note">Looking for a photo…</p>}
          {!photoLoading && vesselPhoto?.status === "ok" && !photoBroken && (
            <figure className="vessel-photo">
              <img
                src={api.vesselPhotoImageUrl(selectedVessel.mmsi)}
                alt={`${selectedVessel.name || selectedVessel.mmsi} photo`}
                loading="lazy"
                onError={() => setPhotoBroken(true)}
              />
              <figcaption>
                {vesselPhoto.sourceUrl ? (
                  <a href={vesselPhoto.sourceUrl} target="_blank" rel="noreferrer noopener">
                    {vesselPhoto.credit ?? vesselPhoto.source}
                  </a>
                ) : (
                  (vesselPhoto.credit ?? vesselPhoto.source)
                )}
                {vesselPhoto.match === "name" && (
                  <span className="vessel-photo-hedge" title="Matched on vessel name, not MMSI">
                    {" "}
                    · likely match
                  </span>
                )}
              </figcaption>
            </figure>
          )}
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
              <dt>Last report</dt>
              <dd
                className="vessel-age"
                title={new Date(selectedVessel.ts).toLocaleString()}
                aria-live="polite"
              >
                {formatElapsedSince(selectedVessel.ts, nowMs)}
              </dd>
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
      </div>
      <div ref={mapRef} />
      <div className={`timeline${ribbonOpen ? "" : " timeline--collapsed"}`} ref={timelineRef}>
        <button
          type="button"
          className="timeline-toggle"
          aria-expanded={ribbonOpen}
          onClick={() => setRibbonOpen((open) => !open)}
        >
          {ribbonOpen ? "Hide status" : "Status"}
        </button>
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

      {helpOpen && (
        <div
          className="help-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kiosk-help-title"
          onClick={() => setHelpOpen(false)}
        >
          <div className="help-panel" onClick={(e) => e.stopPropagation()}>
            <header className="help-panel-header">
              <h2 id="kiosk-help-title">How to use this map</h2>
              <button
                type="button"
                className="help-panel-close"
                aria-label="Close help"
                onClick={() => setHelpOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="help-panel-body">
              <section>
                <h3>Map &amp; vessels</h3>
                <ul>
                  <li>Live AIS refreshes about every 5 seconds for the visible area.</li>
                  <li>Tap a vessel (or search by name/MMSI) to select it, open details, and add a card to the tray.</li>
                  <li>
                    <strong>Last report</strong> on the detail pane (and tray cards) is a live counter of time since the latest AIS point for that vessel.
                  </li>
                  <li>Club boats fly the AHYC burgee; colors follow AIS ship type.</li>
                  <li>Use the chart picker for a sharp harbor map (coast + buoys), regional ocean depths, or full NOAA charts.</li>
                  <li>
                    When the view covers a charted area, a <strong>Historical chart</strong> menu appears — pick Dudley 1646 (eastern seaboard at regional zoom), or 1776 / 1845 / 1895 / 1910 harbor sheets to replace the modern basemap (choose <em>Modern map</em> to return).
                  </li>
                </ul>
              </section>
              <section>
                <h3>Filters</h3>
                <ul>
                  <li>
                    <strong>AIS source</strong> — Radio (Pi), AISHub, AISStream.
                  </li>
                  <li>
                    <strong>Show</strong> — Club boats, Watch list, or all other traffic.
                  </li>
                </ul>
              </section>
              <section>
                <h3>Watch list</h3>
                <ul>
                  <li>In the right-hand vessel pane, add a boat to the watch list to keep its track history indefinitely (same as club vessels).</li>
                  <li>Other harbor traffic is only kept for the configured retention window (default 24h).</li>
                </ul>
              </section>
              <section>
                <h3>Vessel cards (bottom tray)</h3>
                <ul>
                  <li>Selecting vessels fills the tray (left = older, right = newer).</li>
                  <li>
                    <strong>Drag one card onto another</strong> to stack them. The stack shows distance between the boats, true bearings both ways, each COG/speed, and relative bearings (ahead / beam / quarter) from each vessel&apos;s heading.
                  </li>
                  <li>Use ⧉ to unstack, or × to remove a card.</li>
                  <li>Red outlines mark vessels with a close CPA / collision-risk geometry.</li>
                </ul>
              </section>
              <section>
                <h3>Tracks &amp; timeline</h3>
                <ul>
                  <li>Selected vessel: 24h / 7d / 30d track buttons use whatever history is stored.</li>
                  <li>The bottom ribbon shows AISHub refresh countdown, club boats tracked outside the NE box, and how far back stored AIS goes.</li>
                  <li>Scrub the timeline to replay earlier positions.</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
