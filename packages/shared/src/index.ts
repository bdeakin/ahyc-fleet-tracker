export type Vessel = {
  id: string;
  name: string;
  mmsi: string;
  sailNumber?: string | null;
  color: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Where an AIS fix came from. `vesselfinder` is reserved for a future API fallback. */
export type AisSource = "radio" | "aishub" | "aisstream" | "vesselfinder" | "unknown";

export const AIS_SOURCE_LABELS: Record<AisSource, string> = {
  radio: "Terrestrial radio",
  aishub: "AISHub",
  aisstream: "AISStream",
  vesselfinder: "VesselFinder",
  unknown: "Unknown",
};

export type TrackPoint = {
  mmsi: string;
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  ts: number;
  /** AIS data source for this fix. */
  source?: AisSource | null;
};

export type VesselLiveState = {
  mmsi: string;
  vesselId?: string;
  name?: string;
  color?: string;
  /** True when MMSI is in the club vessel registry. */
  registered?: boolean;
  /** True when MMSI is on the kiosk watch list (indefinite track retention). */
  watched?: boolean;
  /** ITU-R AIS ship and cargo type code (0–99), when known. */
  shipType?: number | null;
  shipTypeLabel?: string;
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  ts: number;
  /** AIS data source for the latest fix. */
  source?: AisSource | null;
};

export type VesselProfile = {
  mmsi: string;
  name: string | null;
  flag: string | null;
  callsign: string | null;
  imo: string | null;
  vesselType: string | null;
  lengthM: number | null;
  beamM: number | null;
  source: string | null;
  sourceUrl: string | null;
  status: "pending" | "ok" | "not_found" | "error";
  error: string | null;
  scrapedAt: number | null;
};

/** A photo found for a vessel on a public site. Looked up on demand, never stored locally. */
export type VesselPhoto = {
  mmsi: string;
  status: "ok" | "none" | "error";
  /** How confident the match is: keyed on MMSI, on IMO, or on the vessel name alone. */
  match: "mmsi" | "imo" | "name" | null;
  source: string | null;
  sourceUrl: string | null;
  credit: string | null;
  license: string | null;
  caption: string | null;
  /** Upstream image URL; the kiosk loads it through the server proxy instead. */
  imageUrl: string | null;
  fetchedAt: number;
};

export type BBox = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

export type TripSummary = {
  id: string;
  vesselId: string;
  mmsi: string;
  seasonYear: number;
  startTs: number;
  endTs: number;
  distanceNm: number;
  maxRangeNm: number;
  pointCount: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  farthestLat: number;
  farthestLon: number;
};

export type AdventureNarrative = {
  title: string;
  vessel: Vessel;
  seasonYear: number;
  seasonStart: string;
  seasonEnd: string;
  paragraphs: string[];
  stats: {
    tripCount: number;
    totalDistanceNm: number;
    farthestRangeNm: number;
    firstTripDate: string | null;
    lastTripDate: string | null;
    activeDays: number;
  };
  trips: TripSummary[];
  tracks: Array<{
    tripId: string;
    points: Array<{ lat: number; lon: number; ts: number }>;
  }>;
};

/** One XYZ tile URL, optionally with its own native zoom / opacity. */
export type ChartTileUrl = {
  url: string;
  maxZoom?: number;
  /** Highest zoom with real tiles; Leaflet overzooms beyond this instead of fetching blanks. */
  maxNativeZoom?: number;
  /** Lowest zoom the overlay draws at — keeps dense overlays (seamarks) out of wide views. */
  minZoom?: number;
  opacity?: number;
  /** Leaflet `{s}` subdomain string, e.g. `"abcd"`. */
  subdomains?: string;
};

export type ChartLayer =
  | {
      id: string;
      kind: "noaa-wms";
      label: string;
      /** WMS endpoint; defaults to `NOAA_CHART_WMS`. */
      url?: string;
      /** Comma-separated WMS layer names. */
      layers?: string;
      /** S-52 display parameters passed through on every GetMap. */
      params?: Record<string, string>;
      transparent?: boolean;
      attribution?: string;
      maxZoom?: number;
      /**
       * Lowest zoom the ENC is drawn at. Below this the Maritime Chart Service
       * returns empty tiles, so the kiosk keeps a world basemap visible instead.
       */
      minZoom?: number;
    }
  | {
      id: string;
      kind: "xyz";
      label: string;
      /** One or more XYZ tile URL templates (`{z}/{y}/{x}`). Drawn bottom→top. */
      urls: Array<string | ChartTileUrl>;
      attribution: string;
      maxZoom?: number;
      /** Default native zoom when a URL entry does not set its own. */
      maxNativeZoom?: number;
    }
  | { id: string; kind: "mbtiles"; label: string; path: string };

export function chartTileUrl(entry: string | ChartTileUrl): ChartTileUrl {
  return typeof entry === "string" ? { url: entry } : entry;
}

export const AHYC_CENTER = { lat: 40.4185, lon: -74.0385 } as const;

/**
 * Carto Voyager — sharp through harbor zoom (~z18). Clean land/water and place names
 * without NOAA chart clutter. Pair with OpenSeaMap seamarks for buoys/lights.
 *
 * Public CDN (rate-limited / may require a key in production):
 *   https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png
 * Keyed basemap (Railway: CARTO_API_KEY):
 *   https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=…
 */
export const CARTO_VOYAGER =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";

/** Build a Voyager XYZ template; when `apiKey` is set, use the authenticated endpoint (no `{s}`). */
export function cartoVoyagerUrl(apiKey?: string | null): string {
  const key = apiKey?.trim();
  if (!key) return CARTO_VOYAGER;
  return `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`;
}

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';


/** Esri World Ocean Base — bathymetry shading without dense chart notation. */
export const ESRI_OCEAN_BASE =
  "https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}";

/** Esri World Ocean Reference — place names / coastal labels (e.g. Raritan Bay). */
export const ESRI_OCEAN_REFERENCE =
  "https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}";

export const ESRI_OCEAN_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Sources: GEBCO, NOAA, CHS, OSU, UNH, CSUMB, National Geographic, DeLorme, NAVTEQ, and Esri";

/**
 * Esri Ocean often only has real detail through ~z13; beyond that many coastal tiles
 * are the grey "Map data not yet available" placeholder. Cap native zoom here and
 * let Leaflet overzoom (stretch) those tiles at higher map zooms.
 */
export const ESRI_OCEAN_MAX_NATIVE_ZOOM = 13;

/** OpenSeaMap seamark overlay — buoys, beacons, lights (no full chart clutter). */
export const OPENSEAMAP_SEAMARK =
  "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png";

export const OPENSEAMAP_ATTRIBUTION =
  "Seamarks &copy; <a href=\"https://www.openseamap.org\">OpenSeaMap</a> contributors";

/**
 * Harbor traffic / Dispatcher ingest bbox:
 * Hudson + East River, out toward Fire Island, Ambrose approaches, around Sandy Hook.
 */
export const TRAFFIC_BBOX = {
  minLat: 40.3,
  minLon: -74.3,
  maxLat: 41.05,
  maxLon: -72.85,
} as const satisfies BBox;

/** AISStream club-vessel subscription bbox (includes Long Island Sound cruising range). */
export const DEFAULT_BBOX = {
  minLat: 40.0,
  minLon: -74.5,
  maxLat: 41.5,
  maxLon: -71.8,
} as const satisfies BBox;

/**
 * AISHub coverage regions. One huge Chesapeake→Lakes rectangle often returns
 * 0 records from AISHub with no error, so we poll smaller regions in rotation (NY/NJ first).
 * `NORTHEAST_BBOX` is their union (perimeter / watchlist hysteresis).
 */
export const AISHUB_REGIONS = [
  {
    // Home waters first — smaller box so AISHub returns data (huge NE boxes often come back empty).
    id: "ny-nj-midatlantic",
    label: "NY/NJ Mid-Atlantic (Chesapeake → Long Island)",
    minLat: 37.0,
    minLon: -77.0,
    maxLat: 41.3,
    maxLon: -71.8,
  },
  {
    id: "new-england",
    label: "New England (Long Island Sound → Maine)",
    minLat: 41.0,
    minLon: -72.5,
    maxLat: 45.0,
    maxLon: -66.5,
  },
  {
    id: "great-lakes",
    label: "Great Lakes (Superior → Ontario)",
    minLat: 41.0,
    minLon: -92.5,
    maxLat: 49.5,
    maxLon: -76.0,
  },
] as const satisfies ReadonlyArray<BBox & { id: string; label: string }>;

/** Union of AISHub regions — perimeter detection for club boats. */
export const NORTHEAST_BBOX = {
  minLat: Math.min(...AISHUB_REGIONS.map((r) => r.minLat)),
  minLon: Math.min(...AISHUB_REGIONS.map((r) => r.minLon)),
  maxLat: Math.max(...AISHUB_REGIONS.map((r) => r.maxLat)),
  maxLon: Math.max(...AISHUB_REGIONS.map((r) => r.maxLon)),
} as const satisfies BBox;

/** Default perimeter band (degrees) inside NORTHEAST_BBOX that triggers MMSI watch. ~30 nm. */
export const NORTHEAST_PERIMETER_DEG = 0.5;

/** True when lat/lon is outside bbox or within `marginDeg` of an edge. */
export function nearOrOutsideBbox(
  lat: number,
  lon: number,
  bbox: BBox,
  marginDeg: number = NORTHEAST_PERIMETER_DEG,
): boolean {
  if (!inBbox(lat, lon, bbox)) return true;
  return (
    lat < bbox.minLat + marginDeg ||
    lat > bbox.maxLat - marginDeg ||
    lon < bbox.minLon + marginDeg ||
    lon > bbox.maxLon - marginDeg
  );
}

/** True when safely inside bbox (outside the perimeter band) — hysteresis for watch removal. */
export function deepInsideBbox(
  lat: number,
  lon: number,
  bbox: BBox,
  marginDeg: number = NORTHEAST_PERIMETER_DEG,
): boolean {
  return (
    lat >= bbox.minLat + marginDeg &&
    lat <= bbox.maxLat - marginDeg &&
    lon >= bbox.minLon + marginDeg &&
    lon <= bbox.maxLon - marginDeg
  );
}

export const NOAA_CHART_WMS =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/WMSServer";

/**
 * Smallest Leaflet zoom at which NOAA MCS still returns a chart. GetMap for the
 * eastern US at z6/z7 is a blank PNG; z8 is the first scale with ENC cells.
 * Below this the kiosk shows the ocean basemap underneath instead of empty paper.
 */
export const NOAA_CHART_MIN_ZOOM = 8;

/** Every view group the NOAA Maritime Chart Service publishes (base through overscale warnings). */
export const NOAA_CHART_WMS_LAYERS_ALL = "0,1,2,3,4,5,6,7,8,9,10,11,12";

/**
 * View groups that make up a readable chart: chart info, natural/man-made features,
 * depths, seabed, traffic routes, special areas, aids to navigation, small-craft services.
 * Data-quality, low-accuracy and AIO layers (8–12) are what turn the display into hatching.
 */
export const NOAA_CHART_WMS_LAYERS_PAPER = "0,1,2,3,4,5,6,7";

/**
 * S-52 mariner settings that make the ENC render like a NOAA paper chart:
 * paper-chart point symbols, plain area boundaries, four depth shades with the
 * traditional 12 / 30 / 60 ft tints, soundings in feet, labelled contours.
 * Names are the Maritime Chart Service parameter names (case-sensitive values are codes).
 */
export const NOAA_PAPER_CHART_PARAMS: Record<string, string> = {
  /** 1 = DISPLAYBASE, 2 = STANDARD. Dropping 4 (OTHER) removes the dense hatching. */
  DisplayCategory: "1,2",
  /** 2 = paper chart symbols (1 = simplified ECDIS shapes). */
  PointSymbolizationType: "2",
  /** 1 = plain boundaries, as drawn on paper charts. */
  AreaSymbolizationType: "1",
  /** 1 = four depth shades. */
  TwoDepthShades: "1",
  ShallowContour: "3.6",
  SafetyContour: "9.1",
  DeepContour: "18.3",
  /** 2 = feet, the unit on NOAA's New York Harbor charts. */
  DisplayDepthUnits: "2",
  LabelContours: "2",
  LabelSafetyContours: "2",
  /** 2 = honor SCAMIN so features appear at their intended scale. */
  HonorScamin: "2",
  /** 2 = off; halos are an ECDIS screen convention. */
  TextHalo: "2",
  /** 2 = suppress isolated-danger symbols so the original soundings stay visible. */
  IsolatedDangersOff: "2",
  /** 2 = off; cell outlines are not chart content. */
  DisplayFrames: "2",
  RemoveDuplicateText: "2",
};

export const NOAA_CHART_ATTRIBUTION =
  'Chart data &copy; <a href="https://nauticalcharts.noaa.gov/">NOAA</a> ENC via Maritime Chart Service';

export function inBbox(lat: number, lon: number, bbox: BBox = TRAFFIC_BBOX): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon;
}

export function seasonBounds(year: number, start = "04-01", end = "10-31") {
  const [sm, sd] = start.split("-").map(Number);
  const [em, ed] = end.split("-").map(Number);
  const seasonStart = Date.UTC(year, sm - 1, sd, 0, 0, 0);
  const seasonEnd = Date.UTC(year, em - 1, ed, 23, 59, 59);
  return { seasonStart, seasonEnd };
}

export function adventureTitle(vesselName: string, seasonYear: number): string {
  const name = vesselName.trim();
  return `The ${seasonYear} Adventures of the ${name}`;
}

/** Coarse AIS ship-type buckets for map coloring / labels. */
export type ShipTypeCategory =
  | "sailing"
  | "pleasure"
  | "fishing"
  | "tug"
  | "passenger"
  | "cargo"
  | "tanker"
  | "highSpeed"
  | "pilotSar"
  | "military"
  | "other";

export function shipTypeCategory(code: number | null | undefined): ShipTypeCategory {
  if (code == null || !Number.isFinite(code) || code <= 0) return "other";
  const n = Math.trunc(code);
  if (n === 36) return "sailing";
  if (n === 37) return "pleasure";
  if (n === 30) return "fishing";
  if (n === 31 || n === 32 || n === 52) return "tug";
  if (n >= 60 && n <= 69) return "passenger";
  if (n >= 70 && n <= 79) return "cargo";
  if (n >= 80 && n <= 89) return "tanker";
  if (n >= 40 && n <= 49) return "highSpeed";
  if (n === 50 || n === 51 || n === 53 || n === 55) return "pilotSar";
  if (n === 35) return "military";
  return "other";
}

/**
 * Map free-text vessel class labels (AIS static / VesselFinder scrape) to a
 * representative ITU ship-type code so markers can be colored when the numeric
 * AIS ship type has not arrived yet.
 */
export function shipTypeCodeFromLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const t = label.toLowerCase();
  if (/sail|yacht.?sail|sailing/.test(t)) return 36;
  if (/pleasure|yacht|motor.?yacht|recreational|cabin.?cruiser/.test(t)) return 37;
  if (/fish/.test(t)) return 30;
  if (/tug|tow|pusher/.test(t)) return 52;
  if (/pilot/.test(t)) return 50;
  if (/sar|search.?and.?rescue|rescue|coast.?guard/.test(t)) return 51;
  if (/military|warship|naval/.test(t)) return 35;
  if (/high.?speed|hsc|catamaran.?ferry/.test(t)) return 40;
  if (/passenger|ferry|cruise/.test(t)) return 60;
  if (/tanker|oil|lng|lpg|chemical/.test(t)) return 80;
  if (/cargo|container|bulk|carrier|freighter|general.?cargo|ro-?ro|vehicle/.test(t)) return 70;
  return null;
}

export function labelForShipType(code: number | null | undefined): string {
  switch (shipTypeCategory(code)) {
    case "sailing":
      return "Sailing";
    case "pleasure":
      return "Pleasure";
    case "fishing":
      return "Fishing";
    case "tug":
      return "Tug / tow";
    case "passenger":
      return "Passenger";
    case "cargo":
      return "Cargo";
    case "tanker":
      return "Tanker";
    case "highSpeed":
      return "High speed";
    case "pilotSar":
      return "Pilot / SAR";
    case "military":
      return "Military";
    default:
      return "Other / unknown";
  }
}

/** Map colors for traffic by AIS type. Club vessels keep their registered color. */
export function colorForShipType(code: number | null | undefined): string {
  switch (shipTypeCategory(code)) {
    case "sailing":
      return "#ffffff"; // white (common AIS app convention)
    case "pleasure":
      return "#ec4899"; // pink
    case "fishing":
      return "#65a30d"; // lime/olive
    case "tug":
      return "#ea580c"; // orange
    case "passenger":
      return "#2563eb"; // blue
    case "cargo":
      return "#475569"; // slate
    case "tanker":
      return "#b91c1c"; // red
    case "highSpeed":
      return "#0891b2"; // cyan
    case "pilotSar":
      return "#ca8a04"; // gold
    case "military":
      return "#3f6212"; // dark green
    default:
      return "#6b7280"; // gray
  }
}

/** True when a marker fill needs a dark outline (e.g. white sailing vessels). */
export function markerNeedsDarkOutline(color: string): boolean {
  const hex = color.trim().replace(/^#/, "");
  if (hex.length !== 3 && hex.length !== 6) return false;
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Perceived luminance (sRGB-ish); white/near-white fills need a dark border.
  return (0.299 * r + 0.587 * g + 0.114 * b) >= 200;
}

export function colorForShipTypeLabel(label: string | null | undefined): string {
  return colorForShipType(shipTypeCodeFromLabel(label));
}

export {
  HOME_STATION,
  HARBOR_WATERWAYS,
  PLACE_LANDMARKS,
  haversineNm,
  distanceFromHomeNm,
  formatNm,
  bearingDeg,
  bearingToCardinal,
  describePlace,
  placeLabel,
  waterwayName,
  collisionRiskMmsis,
  cpaBetween,
  relativeVesselNav,
  relativeBearingDeg,
  describeRelativeBearing,
  formatCourseDeg,
  type MotionFix,
  type CollisionRisk,
  type CpaResult,
  type PlaceDescription,
  type RelativeVesselNav,
} from "./harborGeo.js";

export {
  PILOT_BOARDING_AREAS,
  DRAUGHT_ESTIMATE_M,
  IMPLAUSIBLE_SOG_KN,
  SPEED_RUN_KN,
  cogDeltaDeg,
  detectEvasiveManeuvers,
  detectInterceptions,
  detectNoWakeSpeeding,
  detectSpeedRuns,
  detectSuddenStops,
  estimateDraughtM,
  gradeGrounding,
  plausibleSog,
  speedTrackColor,
  type EvasiveManeuverEvent,
  type SpeedRunEvent,
  type InterceptionEvent,
  type InterceptionParty,
  type NearbyVesselSnapshot,
  type NoWakeSpeedingEvent,
  type NoteworthyEvent,
  type NoteworthyFix,
  noteworthyPlaybackTracks,
  noteworthyPlaybackWindow,
  positionAt,
  type NoteworthyPlaybackTrack,
  type SuspectedGroundingEvent,
  type TrackSegmentPoint,
} from "./noteworthyTraffic.js";

export {
  HISTORICAL_CHARTS,
  HISTORICAL_TILE_SIZE,
  boundsIntersect,
  historicalChartById,
  historicalChartsForView,
  historicalMinNativeZoom,
  historicalNativeZoom,
  historicalTileUrl,
  historicalTileZooms,
  type GeoBounds,
  type HistoricalChart,
} from "./historicalCharts.js";

