import {
  detectEvasiveManeuvers,
  detectInterceptions,
  detectNoWakeSpeeding,
  detectSpeedRuns,
  detectSuddenStops,
  estimateDraughtM,
  gradeGrounding,
  type NoteworthyEvent,
  type NoteworthyFix,
} from "@ahyc/shared";
import type { Db } from "./db.js";

export type NoteworthyBundle = {
  generatedAt: number;
  from: number;
  to: number;
  fixCount: number;
  events: NoteworthyEvent[];
};

/** Detectors walk every fix in the window, so results are cached rather than recomputed per view. */
const CACHE_TTL_MS = 3 * 60_000;
/** Bundles carry the tracks behind every event, so keep only the windows in current use. */
const CACHE_MAX_WINDOWS = 4;
/** Bathymetry rarely changes; a cached sample is good indefinitely. */
const DEPTH_CELL_DECIMALS = 3;
const DEPTH_LOOKUP_TIMEOUT_MS = 6_000;
/** Cap outbound depth lookups per rebuild so one busy window cannot stall the route. */
const DEPTH_LOOKUPS_PER_BUILD = 12;

const NCEI_DEM_IDENTIFY =
  "https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/identify";

const cache = new Map<number, NoteworthyBundle>();

type FixRow = {
  mmsi: string;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  ts: number;
  name: string | null;
  shipType: number | null;
};

/**
 * The detectors want steady sampling, not every fix: a pilot boarding or a speed run reads
 * the same at one fix per {@link FIX_BUCKET_MS} as it does at the raw ingest rate, and a busy
 * day of raw fixes is millions of rows that will not fit in a small container's memory.
 * Thinning here bounds both the array and everything downstream of it.
 */
const FIX_BUCKET_MS = 15_000;
const MAX_FIXES = 60_000;

function loadFixes(db: Db, from: number, to: number): NoteworthyFix[] {
  // Only the newest fixes survive the cap, so narrow the scan to roughly the span that
  // holds them rather than grouping a whole day of rows and throwing most away. Counting
  // first is one index walk; the group-by that follows is the expensive part.
  const { rows } = db
    .prepare("SELECT COUNT(*) AS rows FROM track_points WHERE ts >= ? AND ts <= ?")
    .get(from, to) as { rows: number };
  if (rows > MAX_FIXES) {
    // Traffic is bursty, so ask for twice the span the average density suggests.
    const keepSpan = Math.ceil(((to - from) * MAX_FIXES * 2) / rows);
    from = Math.max(from, to - keepSpan);
  }

  const fixes = db
    .prepare(
      `SELECT mmsi, ROUND(lat, 5) AS lat, ROUND(lon, 5) AS lon,
              ROUND(sog, 1) AS sog, ROUND(cog, 1) AS cog, ts FROM (
         SELECT mmsi, lat, lon, sog, cog, MIN(ts) AS ts
           FROM track_points
          WHERE ts >= ? AND ts <= ?
          GROUP BY mmsi, ts / ?
          ORDER BY ts DESC
          LIMIT ?
       ) ORDER BY ts ASC`,
    )
    .all(from, to, FIX_BUCKET_MS, MAX_FIXES) as FixRow[];

  // Names come from a per-vessel lookup rather than a join: joined, SQLite hands back a
  // separate copy of the name string on every one of the tens of thousands of fixes.
  const names = new Map<string, { name: string | null; shipType: number | null }>();
  for (const row of db
    .prepare("SELECT mmsi, name, ship_type AS shipType FROM traffic_names")
    .all() as Array<{ mmsi: string; name: string | null; shipType: number | null }>) {
    names.set(row.mmsi, { name: row.name, shipType: row.shipType });
  }
  for (const fix of fixes) {
    const meta = names.get(fix.mmsi);
    fix.name = meta?.name ?? null;
    fix.shipType = meta?.shipType ?? null;
  }
  return fixes;
}

function depthCell(lat: number, lon: number): string {
  return `${lat.toFixed(DEPTH_CELL_DECIMALS)},${lon.toFixed(DEPTH_CELL_DECIMALS)}`;
}

/** Depth in meters below chart datum, or null when the lookup fails. Land returns 0. */
async function fetchDepthM(lat: number, lon: number): Promise<number | null> {
  const geometry = JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } });
  const url =
    `${NCEI_DEM_IDENTIFY}?geometry=${encodeURIComponent(geometry)}` +
    "&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEPTH_LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { value?: string | number };
    const raw = Number(body?.value);
    if (!Number.isFinite(raw)) return null;
    // NCEI reports elevation: negative below sea level.
    return Math.max(0, -raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function depthAt(db: Db, lat: number, lon: number, budget: { left: number }): Promise<number | null> {
  const cell = depthCell(lat, lon);
  const cached = db.prepare("SELECT depth_m AS depthM FROM depth_samples WHERE cell = ?").get(cell) as
    | { depthM: number | null }
    | undefined;
  if (cached) return cached.depthM;
  if (budget.left <= 0) return null;
  budget.left -= 1;
  const depthM = await fetchDepthM(lat, lon);
  if (depthM == null) return null;
  db.prepare(
    "INSERT INTO depth_samples (cell, depth_m, sampled_at) VALUES (?, ?, ?) ON CONFLICT(cell) DO UPDATE SET depth_m = excluded.depth_m, sampled_at = excluded.sampled_at",
  ).run(cell, depthM, Date.now());
  return depthM;
}

function draughtFor(db: Db, mmsi: string, shipTypeByMmsi: Map<string, number | null>): number {
  const profile = db.prepare("SELECT length_m AS lengthM FROM vessel_profiles WHERE mmsi = ?").get(mmsi) as
    | { lengthM: number | null }
    | undefined;
  return estimateDraughtM(shipTypeByMmsi.get(mmsi) ?? null, profile?.lengthM ?? null);
}

function fresh(hours: number): NoteworthyBundle | null {
  const cached = cache.get(hours);
  return cached && Date.now() - cached.generatedAt < CACHE_TTL_MS ? cached : null;
}

/**
 * Rebuilds run one at a time. Each holds tens of thousands of fixes while the detectors walk
 * them, and the window is a query parameter, so several kiosks on different settings could
 * otherwise put several of those arrays in memory at once — which on a small container is the
 * difference between busy and killed.
 */
let queue: Promise<unknown> = Promise.resolve();

export function buildNoteworthy(db: Db, hours: number): Promise<NoteworthyBundle> {
  const cached = fresh(hours);
  if (cached) return Promise.resolve(cached);

  const run = queue.then(() => fresh(hours) ?? rebuild(db, hours));
  queue = run.catch(() => undefined);
  return run;
}

async function rebuild(db: Db, hours: number): Promise<NoteworthyBundle> {
  const to = Date.now();
  const from = to - hours * 3600_000;
  const fixes = loadFixes(db, from, to);

  const shipTypeByMmsi = new Map<string, number | null>();
  for (const f of fixes) {
    if (!shipTypeByMmsi.has(f.mmsi)) shipTypeByMmsi.set(f.mmsi, f.shipType ?? null);
  }

  const events: NoteworthyEvent[] = [
    ...detectInterceptions(fixes),
    ...detectSpeedRuns(fixes),
    ...detectEvasiveManeuvers(fixes),
    ...detectNoWakeSpeeding(fixes),
  ];

  const budget = { left: DEPTH_LOOKUPS_PER_BUILD };
  for (const stop of detectSuddenStops(fixes)) {
    const depthM = await depthAt(db, stop.lat, stop.lon, budget);
    const graded = gradeGrounding(stop, depthM, draughtFor(db, stop.mmsi, shipTypeByMmsi));
    if (graded) events.push(graded);
  }

  const bundle: NoteworthyBundle = {
    generatedAt: Date.now(),
    from,
    to,
    fixCount: fixes.length,
    events,
  };
  cache.set(hours, bundle);
  // The window is a query parameter, so a handful of kiosks on different settings could
  // otherwise pin one bundle of events and tracks per hour value, up to the 72 the route allows.
  while (cache.size > CACHE_MAX_WINDOWS) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
  return bundle;
}
