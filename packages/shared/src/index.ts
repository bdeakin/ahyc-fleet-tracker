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
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  ts: number;
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
