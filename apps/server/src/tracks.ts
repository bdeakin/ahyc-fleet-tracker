import {
  colorForShipType,
  inBbox,
  labelForShipType,
  shipTypeCodeFromLabel,
  TRAFFIC_BBOX,
  type TrackPoint,
  type VesselLiveState,
} from "@ahyc/shared";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { approxMeters } from "./geo.js";
import { activeMmsis, getVesselByMmsi } from "./vessels.js";
import { ensureVesselProfileQueued, getVesselProfile } from "./vesselProfiles.js";

const MIN_MOVE_M = 25;

export type IngestPositionInput = TrackPoint & {
  /** Optional AIS static name for non-registered traffic. */
  name?: string | null;
  /** ITU-R AIS ship and cargo type (0–99). */
  shipType?: number | null;
};

type TrafficMeta = { name: string | null; shipType: number | null };

function trafficMeta(db: Db, mmsi: string): TrafficMeta {
  try {
    const row = db
      .prepare("SELECT name, ship_type AS shipType FROM traffic_names WHERE mmsi = ?")
      .get(mmsi) as { name: string | null; shipType: number | null } | undefined;
    return { name: row?.name ?? null, shipType: row?.shipType ?? null };
  } catch {
    return { name: null, shipType: null };
  }
}

function upsertTrafficMeta(
  db: Db,
  mmsi: string,
  name?: string | null,
  shipType?: number | null,
): void {
  const existing = trafficMeta(db, mmsi);
  const nextName = name?.trim() ? String(name).slice(0, 64) : existing.name;
  const nextType =
    shipType != null && Number.isFinite(shipType) && Number(shipType) > 0
      ? Math.trunc(Number(shipType))
      : existing.shipType;
  if (!nextName && nextType == null) return;
  try {
    db.prepare(
      `INSERT INTO traffic_names (mmsi, name, ship_type, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(mmsi) DO UPDATE SET
         name = COALESCE(excluded.name, traffic_names.name),
         ship_type = COALESCE(excluded.ship_type, traffic_names.ship_type),
         updated_at = excluded.updated_at`,
    ).run(mmsi, nextName ?? mmsi, nextType, Date.now());
  } catch {
    /* migrate may not have run yet in tests */
  }
}

function profileShipType(db: Db, mmsi: string): { code: number | null; label: string | null; name: string | null } {
  try {
    const profile = getVesselProfile(db, mmsi);
    if (!profile || profile.status !== "ok") return { code: null, label: null, name: null };
    const code = shipTypeCodeFromLabel(profile.vesselType);
    return {
      code,
      label: profile.vesselType,
      name: profile.name,
    };
  } catch {
    return { code: null, label: null, name: null };
  }
}

function toLive(
  db: Db,
  point: TrackPoint,
  nameHint?: string | null,
  shipTypeHint?: number | null,
): VesselLiveState {
  const vessel = getVesselByMmsi(db, point.mmsi);
  const registered = Boolean(vessel?.active);
  const meta = trafficMeta(db, point.mmsi);
  const profile = profileShipType(db, point.mmsi);
  const shipType =
    shipTypeHint != null && Number(shipTypeHint) > 0
      ? Math.trunc(Number(shipTypeHint))
      : meta.shipType != null && meta.shipType > 0
        ? meta.shipType
        : profile.code;
  // If AIS numeric type is still unknown, keep scraped class label for the UI.
  const shipTypeLabel =
    shipType != null && shipType > 0
      ? labelForShipType(shipType)
      : profile.label ?? labelForShipType(shipType);
  return {
    mmsi: point.mmsi,
    vesselId: vessel?.id,
    name: vessel?.name ?? nameHint ?? meta.name ?? profile.name ?? undefined,
    color: registered ? vessel?.color : colorForShipType(shipType),
    registered,
    shipType: shipType ?? null,
    shipTypeLabel,
    lat: point.lat,
    lon: point.lon,
    sog: point.sog,
    cog: point.cog,
    heading: point.heading,
    ts: point.ts,
  };
}

/**
 * Upsert live state and optionally append a track point.
 * Rejects positions outside TRAFFIC_BBOX.
 * Downsamples track storage to ~trackMinIntervalMs (default 60s) per MMSI.
 */
export function ingestPosition(
  db: Db,
  point: IngestPositionInput,
): { stored: boolean; accepted: boolean; live: VesselLiveState | null } {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
    return { stored: false, accepted: false, live: null };
  }
  if (point.lat === 91 || point.lon === 181) {
    return { stored: false, accepted: false, live: null };
  }
  if (!inBbox(point.lat, point.lon, TRAFFIC_BBOX)) {
    return { stored: false, accepted: false, live: null };
  }

  const last = db
    .prepare("SELECT lat, lon, ts FROM track_points WHERE mmsi = ? ORDER BY ts DESC LIMIT 1")
    .get(point.mmsi) as { lat: number; lon: number; ts: number } | undefined;

  let stored = true;
  if (last) {
    const dt = point.ts - last.ts;
    const dist = approxMeters(last.lat, last.lon, point.lat, point.lon);
    if (dt < config.trackMinIntervalMs && dist < MIN_MOVE_M) {
      stored = false;
    }
  }

  if (stored) {
    db.prepare(
      `INSERT INTO track_points (mmsi, lat, lon, sog, cog, heading, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      point.mmsi,
      point.lat,
      point.lon,
      point.sog ?? null,
      point.cog ?? null,
      point.heading ?? null,
      point.ts,
    );
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
  ).run(
    point.mmsi,
    point.lat,
    point.lon,
    point.sog ?? null,
    point.cog ?? null,
    point.heading ?? null,
    point.ts,
  );

  if (!getVesselByMmsi(db, point.mmsi)) {
    upsertTrafficMeta(db, point.mmsi, point.name, point.shipType);
  }

  // Scrape public MMSI particulars once per vessel; results cached in SQLite.
  ensureVesselProfileQueued(db, point.mmsi);

  return {
    stored,
    accepted: true,
    live: toLive(db, point, point.name, point.shipType),
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
  const live = rows.map((r) =>
    toLive(db, {
      mmsi: r.mmsi,
      lat: r.lat,
      lon: r.lon,
      sog: r.sog,
      cog: r.cog,
      heading: r.heading,
      ts: r.ts,
    }),
  );
  // Backfill colors: queue public profile scrapes for traffic still missing a type.
  for (const v of live) {
    if (!v.registered && (v.shipType == null || v.shipType <= 0)) {
      ensureVesselProfileQueued(db, v.mmsi);
    }
  }
  return live;
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
    out.push(toLive(db, row));
  }
  return out;
}

/** Drop non-registered track points / live rows older than trafficRetentionMs. */
export function pruneTrafficHistory(db: Db, now = Date.now()): { points: number; live: number } {
  const cutoff = now - config.trafficRetentionMs;
  const registered = new Set(activeMmsis(db));

  const candidates = db
    .prepare("SELECT DISTINCT mmsi FROM track_points WHERE ts < ?")
    .all(cutoff) as Array<{ mmsi: string }>;
  const traffic = candidates.map((r) => r.mmsi).filter((m) => !registered.has(m));

  let points = 0;
  const delPoints = db.prepare("DELETE FROM track_points WHERE mmsi = ? AND ts < ?");
  for (const mmsi of traffic) {
    points += delPoints.run(mmsi, cutoff).changes;
  }

  let live = 0;
  const liveRows = db.prepare("SELECT mmsi, ts FROM vessel_state").all() as Array<{
    mmsi: string;
    ts: number;
  }>;
  const delLive = db.prepare("DELETE FROM vessel_state WHERE mmsi = ?");
  for (const row of liveRows) {
    if (registered.has(row.mmsi)) continue;
    if (row.ts < cutoff) {
      delLive.run(row.mmsi);
      live += 1;
    }
  }

  try {
    db.prepare(
      "DELETE FROM traffic_names WHERE mmsi NOT IN (SELECT mmsi FROM vessel_state)",
    ).run();
  } catch {
    /* optional */
  }

  return { points, live };
}
