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
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  heading?: number | null;
  ts: number;
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

/** AIS subscription bbox: NY Harbor through Long Island Sound (club cruising range) */
export const DEFAULT_BBOX = {
  minLat: 40.0,
  minLon: -74.5,
  maxLat: 41.5,
  maxLon: -71.8,
} as const;

export const NOAA_CHART_WMS =
  "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/WMSServer";

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
