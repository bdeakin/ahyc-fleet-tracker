import {
  colorForShipType,
  inBbox,
  labelForShipType,
  shipTypeCodeFromLabel,
  TRAFFIC_BBOX,
  type AisSource,
  type TrackPoint,
  type VesselLiveState,
} from "@ahyc/shared";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { approxMeters } from "./geo.js";
import { activeMmsis, getVesselByMmsi } from "./vessels.js";
import { isWatched, watchedMmsis } from "./watchlist.js";
import { ensureVesselProfileQueued, getVesselProfile } from "./vesselProfiles.js";

const MIN_MOVE_M = 25;

export type IngestPositionInput = TrackPoint & {
  /** Optional AIS static name for non-registered traffic. */
  name?: string | null;
  /** ITU-R AIS ship and cargo type (0–99). */
  shipType?: number | null;
  /** Where this fix came from (radio / aishub / aisstream / …). */
  source?: AisSource | null;
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
  sourceHint?: AisSource | null,
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
    watched: isWatched(db, point.mmsi),
    shipType: shipType ?? null,
    shipTypeLabel,
    lat: point.lat,
    lon: point.lon,
    sog: point.sog,
    cog: point.cog,
    heading: point.heading,
    ts: point.ts,
    source: sourceHint ?? point.source ?? null,
  };
}

/**
 * Upsert live state and optionally append a track point.
 * Rejects non-club positions outside TRAFFIC_BBOX.
 * Club vessels (and explicit allowOutsideTrafficBbox) may be stored anywhere
 * so AISHub can track Bermuda-race departures beyond the Northeast box.
 * Downsamples track storage to ~trackMinIntervalMs (default 60s) per MMSI.
 */
export function ingestPosition(
  db: Db,
  point: IngestPositionInput & { allowOutsideTrafficBbox?: boolean },
): { stored: boolean; accepted: boolean; live: VesselLiveState | null } {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
    return { stored: false, accepted: false, live: null };
  }
  if (point.lat === 91 || point.lon === 181) {
    return { stored: false, accepted: false, live: null };
  }
  const club = activeMmsis(db).includes(point.mmsi) || activeMmsis(db).includes(point.mmsi.padStart(9, "0"));
  if (!point.allowOutsideTrafficBbox && !club && !inBbox(point.lat, point.lon, TRAFFIC_BBOX)) {
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
      `INSERT INTO track_points (mmsi, lat, lon, sog, cog, heading, ts, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      point.mmsi,
      point.lat,
      point.lon,
      point.sog ?? null,
      point.cog ?? null,
      point.heading ?? null,
      point.ts,
      point.source ?? null,
    );
  }

  // Prefer newer fixes; equal timestamps keep an existing radio fix over network sources.
  const prev = db
    .prepare("SELECT ts, source FROM vessel_state WHERE mmsi = ?")
    .get(point.mmsi) as { ts: number; source: string | null } | undefined;
  const incomingSource = point.source ?? "unknown";
  if (prev && point.ts < prev.ts) {
    return {
      stored: false,
      accepted: true,
      live: toLive(db, { ...point, ts: prev.ts, source: (prev.source as AisSource) ?? null }, point.name, point.shipType, (prev.source as AisSource) ?? null),
    };
  }
  if (
    prev &&
    point.ts === prev.ts &&
    prev.source === "radio" &&
    incomingSource !== "radio"
  ) {
    return {
      stored: false,
      accepted: true,
      live: toLive(db, { ...point, source: "radio" }, point.name, point.shipType, "radio"),
    };
  }

  db.prepare(
    `INSERT INTO vessel_state (mmsi, lat, lon, sog, cog, heading, ts, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mmsi) DO UPDATE SET
       lat = excluded.lat,
       lon = excluded.lon,
       sog = excluded.sog,
       cog = excluded.cog,
       heading = excluded.heading,
       ts = excluded.ts,
       source = excluded.source`,
  ).run(
    point.mmsi,
    point.lat,
    point.lon,
    point.sog ?? null,
    point.cog ?? null,
    point.heading ?? null,
    point.ts,
    incomingSource,
  );

  if (!getVesselByMmsi(db, point.mmsi)) {
    upsertTrafficMeta(db, point.mmsi, point.name, point.shipType);
  }

  // Scrape public MMSI particulars once per vessel; results cached in SQLite.
  ensureVesselProfileQueued(db, point.mmsi);

  return {
    stored,
    accepted: true,
    live: toLive(db, point, point.name, point.shipType, point.source ?? incomingSource),
  };
}

export type LiveBbox = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

export type ListLiveOptions = {
  /** When set, only vessels inside this box (plus optional club boats) are returned. */
  bbox?: LiveBbox;
  /** Include active registry vessels even if outside the bbox (default true with bbox). */
  includeRegisteredOutside?: boolean;
  /** Always return these mmsis, in or out of the bbox (tray cards, open detail pane). */
  pinned?: string[];
};

function rowToLive(
  db: Db,
  r: {
    mmsi: string;
    lat: number;
    lon: number;
    sog: number | null;
    cog: number | null;
    heading: number | null;
    ts: number;
    source: string | null;
  },
): VesselLiveState {
  return toLive(
    db,
    {
      mmsi: r.mmsi,
      lat: r.lat,
      lon: r.lon,
      sog: r.sog,
      cog: r.cog,
      heading: r.heading,
      ts: r.ts,
      source: (r.source as AisSource) ?? null,
    },
    null,
    null,
    (r.source as AisSource) ?? null,
  );
}

export function listLiveStates(db: Db, opts: ListLiveOptions = {}): VesselLiveState[] {
  const bbox = opts.bbox;
  type Row = {
    mmsi: string;
    lat: number;
    lon: number;
    sog: number | null;
    cog: number | null;
    heading: number | null;
    ts: number;
    source: string | null;
  };

  let rows: Row[];
  if (bbox) {
    const includeRegistered = opts.includeRegisteredOutside !== false;
    // Pinned mmsis come back regardless of the viewport so cards the user parked in the
    // tray keep updating after the map is panned away from them.
    const pinned = [...new Set((opts.pinned ?? []).filter((m) => /^\d{7,9}$/.test(m)))].slice(0, 40);
    const pinnedFilter = pinned.length > 0 ? `OR vs.mmsi IN (${pinned.map(() => "?").join(",")})` : "";
    rows = db
      .prepare(
        `SELECT vs.mmsi, vs.lat, vs.lon, vs.sog, vs.cog, vs.heading, vs.ts, vs.source
         FROM vessel_state vs
         LEFT JOIN vessels v ON v.mmsi = vs.mmsi AND v.active = 1
         WHERE (vs.lat BETWEEN ? AND ? AND vs.lon BETWEEN ? AND ?)
            OR (? = 1 AND v.mmsi IS NOT NULL)
            ${pinnedFilter}`,
      )
      .all(
        bbox.minLat,
        bbox.maxLat,
        bbox.minLon,
        bbox.maxLon,
        includeRegistered ? 1 : 0,
        ...pinned,
      ) as Row[];
  } else {
    rows = db.prepare("SELECT * FROM vessel_state").all() as Row[];
  }

  const live = rows.map((r) => rowToLive(db, r));
  // Backfill colors: queue public profile scrapes for traffic still missing a type.
  for (const v of live) {
    if (!v.registered && (v.shipType == null || v.shipType <= 0)) {
      ensureVesselProfileQueued(db, v.mmsi);
    }
  }
  return live;
}

/**
 * Track reads are the biggest allocation the server makes. A day of harbour traffic is
 * millions of rows, and handing all of them to the map both stalls the response and pushes
 * the container past its memory limit, so every query thins to at most one fix per vessel
 * per time bucket and stops at a hard row cap. Buckets are sized from the requested span,
 * which leaves short windows at full resolution and only coarsens long ones.
 */
const TRACK_POINT_BUDGET = {
  /** One vessel asked for by name: enough for a smooth line over a month of history. */
  single: { perVessel: 4_000, maxRows: 12_000 },
  /** A named handful, i.e. the short trails behind the vessels on screen. */
  named: { perVessel: 600, maxRows: 24_000 },
  /** Every vessel in the window, i.e. the timeline scrub. Coarse on purpose. */
  all: { perVessel: 150, maxRows: 24_000 },
};
const MIN_BUCKET_MS = 1_000;
/** Replay marker positions are one indexed lookup per vessel, so cap how many we walk. */
const REPLAY_VESSEL_CAP = 600;

function bucketMs(from: number, to: number, perVessel: number): number {
  const span = Math.max(0, to - from);
  return Math.max(MIN_BUCKET_MS, Math.ceil(span / Math.max(1, perVessel)));
}

/**
 * `MIN(ts)` with bare columns is SQLite's documented "pick the row that owns the minimum"
 * form, so each bucket yields a real fix rather than a blend of several. The inner query
 * takes the newest rows when the cap bites; the outer one puts them back in time order.
 */
function thinnedTrackQuery(scope: string): string {
  return `SELECT mmsi, lat, lon, sog, cog, heading, ts FROM (
            SELECT mmsi, lat, lon, sog, cog, heading, MIN(ts) AS ts
              FROM track_points
             WHERE ${scope} ts >= ? AND ts <= ?
             GROUP BY mmsi, ts / ?
             ORDER BY ts DESC
             LIMIT ?
          ) ORDER BY ts ASC`;
}

export function queryTracks(
  db: Db,
  opts: { mmsi?: string; mmsis?: string[]; from: number; to: number },
): TrackPoint[] {
  if (opts.mmsi) {
    const { perVessel, maxRows } = TRACK_POINT_BUDGET.single;
    return db
      .prepare(thinnedTrackQuery("mmsi = ? AND"))
      .all(opts.mmsi, opts.from, opts.to, bucketMs(opts.from, opts.to, perVessel), maxRows) as TrackPoint[];
  }
  if (opts.mmsis && opts.mmsis.length > 0) {
    const unique = [...new Set(opts.mmsis.map((m) => m.trim()).filter(Boolean))].slice(0, 120);
    if (unique.length === 0) return [];
    const { perVessel, maxRows } = TRACK_POINT_BUDGET.named;
    const placeholders = unique.map(() => "?").join(",");
    return db
      .prepare(thinnedTrackQuery(`mmsi IN (${placeholders}) AND`))
      .all(
        ...unique,
        opts.from,
        opts.to,
        bucketMs(opts.from, opts.to, perVessel),
        maxRows,
      ) as TrackPoint[];
  }
  const { perVessel, maxRows } = TRACK_POINT_BUDGET.all;
  return db
    .prepare(thinnedTrackQuery(""))
    .all(opts.from, opts.to, bucketMs(opts.from, opts.to, perVessel), maxRows) as TrackPoint[];
}

export function positionsAt(db: Db, at: number): VesselLiveState[] {
  const mmsis = db
    .prepare("SELECT DISTINCT mmsi FROM track_points WHERE ts <= ? LIMIT ?")
    .all(at, REPLAY_VESSEL_CAP) as Array<{ mmsi: string }>;
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


/** Oldest/newest stored track points for traffic vs registered club vessels. */
export function trackHistorySpan(db: Db, now = Date.now()): {
  trafficOldestTs: number | null;
  trafficNewestTs: number | null;
  trafficSpanMs: number | null;
  clubOldestTs: number | null;
  clubNewestTs: number | null;
  clubSpanMs: number | null;
  trafficRetentionMs: number;
  pointCount: number;
} {
  const club = new Set(activeMmsis(db));
  const watched = new Set(watchedMmsis(db));
  const rows = db
    .prepare("SELECT mmsi, MIN(ts) AS oldest, MAX(ts) AS newest, COUNT(*) AS n FROM track_points GROUP BY mmsi")
    .all() as Array<{ mmsi: string; oldest: number; newest: number; n: number }>;

  let trafficOldest: number | null = null;
  let trafficNewest: number | null = null;
  let clubOldest: number | null = null;
  let clubNewest: number | null = null;
  let pointCount = 0;

  for (const row of rows) {
    pointCount += row.n;
    const isClub = club.has(row.mmsi) || club.has(row.mmsi.padStart(9, "0"));
    const isWatchedVessel =
      watched.has(row.mmsi) || watched.has(row.mmsi.padStart(9, "0"));
    // Club + watch list are kept indefinitely; report them in the club/long-term bucket.
    if (isClub || isWatchedVessel) {
      clubOldest = clubOldest == null ? row.oldest : Math.min(clubOldest, row.oldest);
      clubNewest = clubNewest == null ? row.newest : Math.max(clubNewest, row.newest);
    } else {
      trafficOldest = trafficOldest == null ? row.oldest : Math.min(trafficOldest, row.oldest);
      trafficNewest = trafficNewest == null ? row.newest : Math.max(trafficNewest, row.newest);
    }
  }

  return {
    trafficOldestTs: trafficOldest,
    trafficNewestTs: trafficNewest,
    trafficSpanMs:
      trafficOldest != null && trafficNewest != null ? Math.max(0, trafficNewest - trafficOldest) : null,
    clubOldestTs: clubOldest,
    clubNewestTs: clubNewest,
    clubSpanMs: clubOldest != null && clubNewest != null ? Math.max(0, clubNewest - clubOldest) : null,
    trafficRetentionMs: config.trafficRetentionMs,
    pointCount,
  };
}

/** Drop non-registered track points / live rows older than trafficRetentionMs. */
export function pruneTrafficHistory(db: Db, now = Date.now()): { points: number; live: number } {
  const cutoff = now - config.trafficRetentionMs;
  const registered = new Set(activeMmsis(db));
  const watched = new Set(watchedMmsis(db));
  const keepForever = (mmsi: string) =>
    registered.has(mmsi) ||
    registered.has(mmsi.padStart(9, "0")) ||
    watched.has(mmsi) ||
    watched.has(mmsi.padStart(9, "0"));

  const candidates = db
    .prepare("SELECT DISTINCT mmsi FROM track_points WHERE ts < ?")
    .all(cutoff) as Array<{ mmsi: string }>;
  const traffic = candidates.map((r) => r.mmsi).filter((m) => !keepForever(m));

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
    if (keepForever(row.mmsi)) continue;
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
