import type { TrackPoint, VesselLiveState } from "@ahyc/shared";
import type { Db } from "./db.js";
import { approxMeters } from "./geo.js";
import { getVesselByMmsi } from "./vessels.js";

const MIN_MOVE_M = 25;
const MIN_INTERVAL_MS = 30_000;

export function ingestPosition(
  db: Db,
  point: TrackPoint,
): { stored: boolean; live: VesselLiveState } {
  const last = db
    .prepare("SELECT lat, lon, ts FROM track_points WHERE mmsi = ? ORDER BY ts DESC LIMIT 1")
    .get(point.mmsi) as { lat: number; lon: number; ts: number } | undefined;

  let stored = true;
  if (last) {
    const dt = point.ts - last.ts;
    const dist = approxMeters(last.lat, last.lon, point.lat, point.lon);
    if (dt < MIN_INTERVAL_MS && dist < MIN_MOVE_M) {
      stored = false;
    }
  }

  if (stored) {
    db.prepare(
      `INSERT INTO track_points (mmsi, lat, lon, sog, cog, heading, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(point.mmsi, point.lat, point.lon, point.sog ?? null, point.cog ?? null, point.heading ?? null, point.ts);
  }

  db.prepare(
    `INSERT INTO vessel_state (mmsi, lat, lon, sog, cog, heading, ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mmsi) DO UPDATE SET
       lat = excluded.lat,
       lon = excluded.lon,
       sog = excluded.sog,
       cog = excluded.cog,
       heading = excluded.heading,
       ts = excluded.ts`,
  ).run(point.mmsi, point.lat, point.lon, point.sog ?? null, point.cog ?? null, point.heading ?? null, point.ts);

  const vessel = getVesselByMmsi(db, point.mmsi);
  return {
    stored,
    live: {
      mmsi: point.mmsi,
      vesselId: vessel?.id,
      name: vessel?.name,
      color: vessel?.color,
      lat: point.lat,
      lon: point.lon,
      sog: point.sog,
      cog: point.cog,
      heading: point.heading,
      ts: point.ts,
    },
  };
}

export function listLiveStates(db: Db): VesselLiveState[] {
  const rows = db.prepare("SELECT * FROM vessel_state").all() as Array<{
    mmsi: string;
    lat: number;
    lon: number;
    sog: number | null;
    cog: number | null;
    heading: number | null;
    ts: number;
  }>;
  return rows.map((r) => {
    const vessel = getVesselByMmsi(db, r.mmsi);
    return {
      mmsi: r.mmsi,
      vesselId: vessel?.id,
      name: vessel?.name,
      color: vessel?.color,
      lat: r.lat,
      lon: r.lon,
      sog: r.sog,
      cog: r.cog,
      heading: r.heading,
      ts: r.ts,
    };
  });
}

export function queryTracks(
  db: Db,
  opts: { mmsi?: string; from: number; to: number },
): TrackPoint[] {
  if (opts.mmsi) {
    return db
      .prepare(
        `SELECT mmsi, lat, lon, sog, cog, heading, ts FROM track_points
         WHERE mmsi = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC`,
      )
      .all(opts.mmsi, opts.from, opts.to) as TrackPoint[];
  }
  return db
    .prepare(
      `SELECT mmsi, lat, lon, sog, cog, heading, ts FROM track_points
       WHERE ts >= ? AND ts <= ? ORDER BY ts ASC`,
    )
    .all(opts.from, opts.to) as TrackPoint[];
}

export function positionsAt(db: Db, at: number): VesselLiveState[] {
  const mmsis = db.prepare("SELECT DISTINCT mmsi FROM track_points").all() as Array<{ mmsi: string }>;
  const out: VesselLiveState[] = [];
  const stmt = db.prepare(
    `SELECT mmsi, lat, lon, sog, cog, heading, ts FROM track_points
     WHERE mmsi = ? AND ts <= ? ORDER BY ts DESC LIMIT 1`,
  );
  for (const { mmsi } of mmsis) {
    const row = stmt.get(mmsi, at) as TrackPoint | undefined;
    if (!row) continue;
    const vessel = getVesselByMmsi(db, mmsi);
    out.push({
      mmsi,
      vesselId: vessel?.id,
      name: vessel?.name,
      color: vessel?.color,
      lat: row.lat,
      lon: row.lon,
      sog: row.sog,
      cog: row.cog,
      heading: row.heading,
      ts: row.ts,
    });
  }
  return out;
}
