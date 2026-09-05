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
  | { id: string; kind: "mbtiles"; label: string; path: string };

export const AHYC_CENTER = { lat: 40.4185, lon: -74.0385 } as const;

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
      return "#0f766e"; // teal
    case "pleasure":
      return "#d97706"; // amber
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
