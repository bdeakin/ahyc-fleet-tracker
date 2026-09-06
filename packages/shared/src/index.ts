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

export type TrackPoint = {
  mmsi: string;
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  ts: number;
};

export type VesselLiveState = {
  mmsi: string;
  vesselId?: string;
  name?: string;
  color?: string;
  /** True when MMSI is in the club vessel registry. */
  registered?: boolean;
  /** ITU-R AIS ship and cargo type code (0–99), when known. */
  shipType?: number | null;
  shipTypeLabel?: string;
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  ts: number;
};

/** Cached vessel particulars scraped once per MMSI (VesselFinder / similar). */
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

export type ChartLayer =
  | { id: string; kind: "noaa-wms"; label: string }
  | {
      id: string;
      kind: "xyz";
      label: string;
      /** One or more XYZ tile URL templates (`{z}/{y}/{x}`). Drawn bottom→top. */
      urls: string[];
      attribution: string;
      maxZoom?: number;
    }
  | { id: string; kind: "mbtiles"; label: string; path: string };

export const AHYC_CENTER = { lat: 40.4185, lon: -74.0385 } as const;

/** Esri World Ocean Base — bathymetry shading without dense chart notation. */
export const ESRI_OCEAN_BASE =
  "https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}";

/** Esri World Ocean Reference — place names / coastal labels (e.g. Raritan Bay). */
export const ESRI_OCEAN_REFERENCE =
  "https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}";

export const ESRI_OCEAN_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Sources: GEBCO, NOAA, CHS, OSU, UNH, CSUMB, National Geographic, DeLorme, NAVTEQ, and Esri";

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
 * AISHub coverage: Chesapeake Bay through Downeast Maine, west through
 * the Great Lakes (Superior → Ontario) for club cruising / race tracking.
 */
export const NORTHEAST_BBOX = {
  minLat: 36.5,   // Cape Henry / southern Chesapeake
  minLon: -92.5,  // western Lake Superior (Duluth)
  maxLat: 49.5,   // northern Lake Superior
  maxLon: -66.5,  // east of Maine / Gulf of Maine
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

