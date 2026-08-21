import { randomUUID } from "node:crypto";
import { seasonBounds, type TripSummary, type Vessel } from "@ahyc/shared";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { haversineNm, seasonYearForTs } from "./geo.js";

type Point = { lat: number; lon: number; ts: number; sog: number | null };

const MIN_TRIP_DISTANCE_NM = 0.35;
const MIN_TRIP_DURATION_MS = 20 * 60_000;
const EXIT_SOG_KN = 1.5;
const RETURN_IDLE_MS = 25 * 60_000;

function loadPoints(db: Db, mmsi: string, from: number, to: number): Point[] {
  return db
    .prepare(
      `SELECT lat, lon, ts, sog FROM track_points
       WHERE mmsi = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC`,
    )
    .all(mmsi, from, to) as Point[];
}

function clearTrips(db: Db, vesselId: string, seasonYear: number) {
  db.prepare("DELETE FROM trips WHERE vessel_id = ? AND season_year = ?").run(vesselId, seasonYear);
}

function insertTrip(db: Db, trip: TripSummary) {
  db.prepare(
    `INSERT INTO trips (
      id, vessel_id, mmsi, season_year, start_ts, end_ts, distance_nm, max_range_nm,
      point_count, start_lat, start_lon, end_lat, end_lon, farthest_lat, farthest_lon
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    trip.id,
    trip.vesselId,
    trip.mmsi,
    trip.seasonYear,
    trip.startTs,
    trip.endTs,
    trip.distanceNm,
    trip.maxRangeNm,
    trip.pointCount,
    trip.startLat,
    trip.startLon,
    trip.endLat,
    trip.endLon,
    trip.farthestLat,
    trip.farthestLon,
  );
}

export function detectTripsForVesselSeason(db: Db, vessel: Vessel, seasonYear: number): TripSummary[] {
  const { seasonStart, seasonEnd } = seasonBounds(seasonYear, config.seasonStart, config.seasonEnd);
  const points = loadPoints(db, vessel.mmsi, seasonStart, seasonEnd);
  clearTrips(db, vessel.id, seasonYear);
  if (points.length < 5) return [];

  const trips: TripSummary[] = [];
  let inTrip = false;
  let tripStartIdx = 0;
  let lastMovingTs = points[0].ts;

  const outsideHome = (p: Point) =>
    haversineNm(p.lat, p.lon, config.homeLat, config.homeLon) > config.homeRadiusNm;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const moving = (p.sog ?? 0) >= EXIT_SOG_KN || haversineNm(prev.lat, prev.lon, p.lat, p.lon) > 0.05;
    if (moving) lastMovingTs = p.ts;

    if (!inTrip) {
      if (outsideHome(p) && moving) {
        inTrip = true;
        tripStartIdx = Math.max(0, i - 1);
      }
      continue;
    }

    const idleTooLong = p.ts - lastMovingTs >= RETURN_IDLE_MS;
    const backHome = !outsideHome(p) && idleTooLong;
    const isLast = i === points.length - 1;

    if (backHome || isLast) {
      const slice = points.slice(tripStartIdx, i + 1);
      const built = summarizeTrip(vessel, seasonYear, slice);
      if (
        built &&
        built.distanceNm >= MIN_TRIP_DISTANCE_NM &&
        built.endTs - built.startTs >= MIN_TRIP_DURATION_MS
      ) {
        insertTrip(db, built);
        trips.push(built);
      }
      inTrip = false;
    }
  }

  return trips;
}

function summarizeTrip(vessel: Vessel, seasonYear: number, slice: Point[]): TripSummary | null {
  if (slice.length < 2) return null;
  let distanceNm = 0;
  let maxRangeNm = 0;
  let farthest = slice[0];
  for (let i = 1; i < slice.length; i++) {
    distanceNm += haversineNm(slice[i - 1].lat, slice[i - 1].lon, slice[i].lat, slice[i].lon);
    const range = haversineNm(slice[i].lat, slice[i].lon, config.homeLat, config.homeLon);
    if (range > maxRangeNm) {
      maxRangeNm = range;
      farthest = slice[i];
    }
  }
  const start = slice[0];
  const end = slice[slice.length - 1];
  return {
    id: randomUUID(),
    vesselId: vessel.id,
    mmsi: vessel.mmsi,
    seasonYear,
    startTs: start.ts,
    endTs: end.ts,
    distanceNm: Number(distanceNm.toFixed(2)),
    maxRangeNm: Number(maxRangeNm.toFixed(2)),
    pointCount: slice.length,
    startLat: start.lat,
    startLon: start.lon,
    endLat: end.lat,
    endLon: end.lon,
    farthestLat: farthest.lat,
    farthestLon: farthest.lon,
  };
}

export function listTrips(db: Db, vesselId: string, seasonYear: number): TripSummary[] {
  return db
    .prepare(
      `SELECT id, vessel_id as vesselId, mmsi, season_year as seasonYear, start_ts as startTs,
              end_ts as endTs, distance_nm as distanceNm, max_range_nm as maxRangeNm,
              point_count as pointCount, start_lat as startLat, start_lon as startLon,
              end_lat as endLat, end_lon as endLon, farthest_lat as farthestLat,
              farthest_lon as farthestLon
       FROM trips WHERE vessel_id = ? AND season_year = ? ORDER BY start_ts ASC`,
    )
    .all(vesselId, seasonYear) as TripSummary[];
}

export function availableSeasons(db: Db, vesselId: string): number[] {
  const vessel = db.prepare("SELECT mmsi FROM vessels WHERE id = ?").get(vesselId) as
    | { mmsi: string }
    | undefined;
  if (!vessel) return [];
  const rows = db
    .prepare("SELECT DISTINCT ts FROM track_points WHERE mmsi = ?")
    .all(vessel.mmsi) as Array<{ ts: number }>;
  const years = new Set<number>();
  for (const { ts } of rows) {
    const y = seasonYearForTs(ts, config.seasonStart, config.seasonEnd);
    if (y != null) years.add(y);
  }
  // Also include years that already have trip rows
  const tripYears = db
    .prepare("SELECT DISTINCT season_year as y FROM trips WHERE vessel_id = ?")
    .all(vesselId) as Array<{ y: number }>;
  for (const { y } of tripYears) years.add(y);
  return [...years].sort((a, b) => b - a);
}
