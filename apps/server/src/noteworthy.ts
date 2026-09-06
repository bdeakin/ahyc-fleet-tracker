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

function loadFixes(db: Db, from: number, to: number): NoteworthyFix[] {
  const rows = db
    .prepare(
      `SELECT p.mmsi, p.lat, p.lon, p.sog, p.cog, p.ts, n.name AS name, n.ship_type AS shipType
         FROM track_points p
         LEFT JOIN traffic_names n ON n.mmsi = p.mmsi
        WHERE p.ts >= ? AND p.ts <= ?
        ORDER BY p.ts ASC`,
    )
    .all(from, to) as FixRow[];
  return rows.map((r) => ({
    mmsi: r.mmsi,
    lat: r.lat,
    lon: r.lon,
    sog: r.sog,
    cog: r.cog,
    ts: r.ts,
    name: r.name,
    shipType: r.shipType,
  }));
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

export async function buildNoteworthy(db: Db, hours: number): Promise<NoteworthyBundle> {
  const cached = cache.get(hours);
  if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) return cached;

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
  return bundle;
}
