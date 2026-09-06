import {
  AISHUB_REGIONS,
  NORTHEAST_BBOX,
  deepInsideBbox,
  nearOrOutsideBbox,
} from "@ahyc/shared";
import { config } from "./config.js";
import { getDb, type Db } from "./db.js";
import { ingestPosition } from "./tracks.js";
import { activeMmsis } from "./vessels.js";

export type LiveBroadcaster = (payload: unknown) => void;

export type AishubStatus = {
  usernameConfigured: boolean;
  lastCallAt: number | null;
  lastBboxAt: number | null;
  lastMmsiAt: number | null;
  lastError: string | null;
  callCount: number;
  ingestCount: number;
  /** Vessels returned by the last AISHub response. */
  lastFetched: number;
  /** Vessels accepted into live state from the last response. */
  lastIngested: number;
  /** Region id of the last bbox pull (atlantic-ne / great-lakes). */
  lastRegion: string | null;
  watchlist: string[];
  /** Club vessels on AISHub MMSI watch (outside/near NE bbox). */
  outsideBboxClubCount: number;
  /** Earliest time the next AISHub HTTP call may run. */
  nextAllowedCallAt: number | null;
  /** Configured min gap between AISHub calls (ms). */
  intervalMs: number;
};

type AishubVessel = {
  mmsi: string;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  name: string | null;
  shipType: number | null;
  ts: number;
};

const AISHUB_URL = "https://data.aishub.net/ws.php";
const LAST_BBOX_KEY = "aishub_last_bbox_at";
/** AISHub returns an empty body when called more than once per minute. */
const HARD_MIN_INTERVAL_MS = 60_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseTs(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string") {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 1e9) return asNum > 1e12 ? asNum : asNum * 1000;
    const parsed = Date.parse(raw.replace(/ GMT$/i, "Z"));
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function asFinite(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeVessel(row: Record<string, unknown>): AishubVessel | null {
  const mmsi = String(row.MMSI ?? row.mmsi ?? "").trim();
  if (!mmsi) return null;
  const lat = asFinite(row.LATITUDE ?? row.latitude ?? row.lat);
  const lon = asFinite(row.LONGITUDE ?? row.longitude ?? row.lon);
  if (lat == null || lon == null) return null;
  if (lat === 91 || lon === 181) return null;

  const sog = asFinite(row.SOG ?? row.sog);
  const cog = asFinite(row.COG ?? row.cog);
  const heading = asFinite(row.HEADING ?? row.heading);
  const shipType = asFinite(row.TYPE ?? row.type ?? row.shipType);
  const nameRaw = row.NAME ?? row.name;
  const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim().slice(0, 64) : null;

  return {
    mmsi,
    lat,
    lon,
    sog,
    cog,
    heading: heading != null && heading !== 511 ? heading : null,
    name,
    shipType: shipType != null && shipType > 0 ? Math.trunc(shipType) : null,
    ts: parseTs(row.TIME ?? row.TSTAMP ?? row.time ?? row.tstamp),
  };
}

function extractVessels(payload: unknown): AishubVessel[] {
  // Documented JSON shape: [ { ERROR:false, ... }, [ { MMSI, LATITUDE, ... }, ... ] ]
  if (Array.isArray(payload) && payload.length >= 2 && Array.isArray(payload[1])) {
    const meta = payload[0] as Record<string, unknown>;
    if (meta && (meta.ERROR === true || meta.error === true)) {
      throw new Error(String(meta.ERRMSG ?? meta.message ?? "AISHub ERROR"));
    }
    return (payload[1] as Record<string, unknown>[])
      .map((row) => normalizeVessel(row))
      .filter((v): v is AishubVessel => v != null);
  }
  if (Array.isArray(payload)) {
    return payload
      .filter((row) => row && typeof row === "object" && !Array.isArray(row))
      .map((row) => normalizeVessel(row as Record<string, unknown>))
      .filter((v): v is AishubVessel => v != null);
  }
  return [];
}

function getSetting(db: Db, key: string): string | null {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function setSetting(db: Db, key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

function listWatch(db: Db): string[] {
  try {
    return (
      db.prepare("SELECT mmsi FROM aishub_watch ORDER BY added_at").all() as Array<{ mmsi: string }>
    ).map((r) => r.mmsi);
  } catch {
    return [];
  }
}

function upsertWatch(
  db: Db,
  mmsi: string,
  reason: string,
  lat?: number,
  lon?: number,
  ts?: number,
) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO aishub_watch (mmsi, reason, added_at, last_lat, last_lon, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(mmsi) DO UPDATE SET
       reason = excluded.reason,
       last_lat = COALESCE(excluded.last_lat, aishub_watch.last_lat),
       last_lon = COALESCE(excluded.last_lon, aishub_watch.last_lon),
       last_seen_at = COALESCE(excluded.last_seen_at, aishub_watch.last_seen_at)`,
  ).run(mmsi, reason, now, lat ?? null, lon ?? null, ts ?? null);
}

function removeWatch(db: Db, mmsi: string) {
  db.prepare("DELETE FROM aishub_watch WHERE mmsi = ?").run(mmsi);
}

function updateWatchSeen(db: Db, mmsi: string, lat: number, lon: number, ts: number) {
  db.prepare(
    `UPDATE aishub_watch SET last_lat = ?, last_lon = ?, last_seen_at = ? WHERE mmsi = ?`,
  ).run(lat, lon, ts, mmsi);
}

function isClubMmsi(club: Set<string>, mmsi: string): boolean {
  return club.has(mmsi) || club.has(mmsi.padStart(9, "0"));
}

/**
 * AISHub poller with a hard one-call-per-minute budget shared by:
 * - daily Northeast bbox sweep (club vessels)
 * - MMSI watchlist for club boats near/outside the NE perimeter (e.g. Bermuda race)
 */
export class AishubWorker {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private inFlight = false;
  private lastCallAt: number | null = null;
  private lastBboxAt: number | null = null;
  private lastMmsiAt: number | null = null;
  private lastError: string | null = null;
  private callCount = 0;
  private ingestCount = 0;
  private lastFetched = 0;
  private lastIngested = 0;
  private lastRegion: string | null = null;
  private regionIndex = 0;
  /** When a watchlist is active, alternate bbox ↔ MMSI on each allowed slot. */
  private preferMmsiNext = false;

  constructor(private broadcast: LiveBroadcaster) {}

  getStatus(): AishubStatus {
    const minInterval = Math.max(HARD_MIN_INTERVAL_MS, config.aishubMinIntervalMs);
    const watchlist = listWatch(getDb());
    return {
      usernameConfigured: Boolean(config.aishubUsername),
      lastCallAt: this.lastCallAt,
      lastBboxAt: this.lastBboxAt,
      lastMmsiAt: this.lastMmsiAt,
      lastError: this.lastError,
      callCount: this.callCount,
      ingestCount: this.ingestCount,
      lastFetched: this.lastFetched,
      lastIngested: this.lastIngested,
      lastRegion: this.lastRegion,
      watchlist,
      outsideBboxClubCount: watchlist.length,
      nextAllowedCallAt: this.lastCallAt == null ? Date.now() : this.lastCallAt + minInterval,
      intervalMs: minInterval,
    };
  }

  start() {
    this.stopped = false;
    if (!config.aishubUsername) {
      console.warn("[aishub] AISHUB_USERNAME not set — Northeast bbox / MMSI watch disabled");
      return;
    }
    const raw = getSetting(getDb(), LAST_BBOX_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n)) this.lastBboxAt = n;
    }
    console.log(
      `[aishub] enabled user=${config.aishubUsername} bboxEverySec=${(
        config.aishubBboxIntervalMs / 1000
      ).toFixed(1)} minIntervalSec=${Math.ceil(
        Math.max(HARD_MIN_INTERVAL_MS, config.aishubMinIntervalMs) / 1000,
      )}`,
    );
    this.timer = setTimeout(() => void this.tick(), 15_000);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private minInterval() {
    return Math.max(HARD_MIN_INTERVAL_MS, config.aishubMinIntervalMs);
  }

  private async tick() {
    if (this.stopped) return;
    if (!config.aishubUsername) {
      this.scheduleNext(60_000);
      return;
    }
    if (this.inFlight) {
      this.scheduleNext(5_000);
      return;
    }

    const db = getDb();
    this.reconcileWatchFromLive(db);

    const sinceCall =
      this.lastCallAt == null ? Number.POSITIVE_INFINITY : Date.now() - this.lastCallAt;
    if (sinceCall < this.minInterval()) {
      this.scheduleNext(this.minInterval() - sinceCall + 50);
      return;
    }

    const watch = listWatch(db);
    const bboxDue =
      this.lastBboxAt == null || Date.now() - this.lastBboxAt >= config.aishubBboxIntervalMs;

    try {
      this.inFlight = true;
      // One call per slot. Keep full Northeast traffic fresh on the bbox cadence;
      // when club boats are on the offshore watchlist, alternate MMSI pulls.
      const runMmsi = watch.length > 0 && (this.preferMmsiNext || !bboxDue);
      if (runMmsi) {
        await this.runMmsiPull(db, watch);
        this.preferMmsiNext = false;
      } else if (bboxDue || watch.length === 0) {
        await this.runBboxPull(db);
        this.preferMmsiNext = watch.length > 0;
      }
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.warn("[aishub] tick failed:", this.lastError);
    } finally {
      this.inFlight = false;
      // Empty region responses are common for oversized bboxes — rotate sooner (AISHub floor: 1/min).
      const delay =
        this.lastFetched === 0
          ? Math.max(HARD_MIN_INTERVAL_MS + 1_000, 65_000)
          : this.minInterval();
      this.scheduleNext(delay);
    }
  }

  /** Promote/demote club boats using whatever live positions we already have. */
  private reconcileWatchFromLive(db: Db) {
    const club = new Set(activeMmsis(db));
    if (club.size === 0) return;
    const margin = config.aishubPerimeterDeg;

    const rows = db.prepare("SELECT mmsi, lat, lon, ts FROM vessel_state").all() as Array<{
      mmsi: string;
      lat: number;
      lon: number;
      ts: number;
    }>;

    for (const row of rows) {
      if (!isClubMmsi(club, row.mmsi)) continue;
      if (nearOrOutsideBbox(row.lat, row.lon, NORTHEAST_BBOX, margin)) {
        upsertWatch(db, row.mmsi, "perimeter", row.lat, row.lon, row.ts);
      } else if (deepInsideBbox(row.lat, row.lon, NORTHEAST_BBOX, margin)) {
        removeWatch(db, row.mmsi);
      }
    }
  }

  private async runBboxPull(db: Db) {
    const region = AISHUB_REGIONS[this.regionIndex % AISHUB_REGIONS.length]!;
    this.regionIndex = (this.regionIndex + 1) % AISHUB_REGIONS.length;
    this.lastRegion = region.id;

    const vessels = await this.fetchAishub({
      latmin: region.minLat,
      latmax: region.maxLat,
      lonmin: region.minLon,
      lonmax: region.maxLon,
    });
    this.lastBboxAt = Date.now();
    setSetting(db, LAST_BBOX_KEY, String(this.lastBboxAt));
    this.lastFetched = vessels.length;

    const club = new Set(activeMmsis(db));
    const seenClub = new Set<string>();
    let ingested = 0;
    let clubIngested = 0;

    // Ingest every AISHub fix in this region (not just club MMSIs).
    for (const v of vessels) {
      if (!this.ingestVessel(db, v)) continue;
      ingested += 1;
      if (!isClubMmsi(club, v.mmsi)) continue;
      clubIngested += 1;
      seenClub.add(club.has(v.mmsi) ? v.mmsi : v.mmsi.padStart(9, "0"));
      this.applyWatchRules(db, v, club);
    }
    this.lastIngested = ingested;

    // Club boat last seen near the perimeter but absent from this pull → keep MMSI-watching.
    for (const mmsi of club) {
      if (seenClub.has(mmsi) || seenClub.has(mmsi.padStart(9, "0"))) continue;
      const live = db.prepare("SELECT lat, lon, ts FROM vessel_state WHERE mmsi = ?").get(mmsi) as
        | { lat: number; lon: number; ts: number }
        | undefined;
      if (!live) continue;
      if (nearOrOutsideBbox(live.lat, live.lon, NORTHEAST_BBOX, config.aishubPerimeterDeg)) {
        upsertWatch(db, mmsi, "missing_from_bbox", live.lat, live.lon, live.ts);
      }
    }

    console.log(
      `[aishub] bbox region=${region.id} vessels=${vessels.length} ingested=${ingested} club=${clubIngested} watch=${listWatch(db).length}`,
    );
  }

  private async runMmsiPull(db: Db, mmsis: string[]) {
    // Multiple MMSIs in one request — still a single call against the 1/min budget.
    const vessels = await this.fetchAishub({ mmsi: mmsis.join(",") });
    this.lastMmsiAt = Date.now();
    this.lastFetched = vessels.length;
    const club = new Set(activeMmsis(db));
    let ingested = 0;

    for (const v of vessels) {
      if (this.ingestVessel(db, v)) ingested += 1;
      this.applyWatchRules(db, v, club);
    }
    this.lastIngested = ingested;

    console.log(
      `[aishub] mmsi asked=${mmsis.length} returned=${vessels.length} ingested=${ingested} watch=${listWatch(db).length}`,
    );
  }

  /** Perimeter / return-home watchlist is club vessels only. */
  private applyWatchRules(db: Db, v: AishubVessel, club: Set<string>) {
    if (!isClubMmsi(club, v.mmsi)) return;
    const margin = config.aishubPerimeterDeg;
    if (nearOrOutsideBbox(v.lat, v.lon, NORTHEAST_BBOX, margin)) {
      upsertWatch(db, v.mmsi, "perimeter", v.lat, v.lon, v.ts);
      updateWatchSeen(db, v.mmsi, v.lat, v.lon, v.ts);
    } else if (deepInsideBbox(v.lat, v.lon, NORTHEAST_BBOX, margin)) {
      removeWatch(db, v.mmsi);
    } else {
      updateWatchSeen(db, v.mmsi, v.lat, v.lon, v.ts);
    }
  }

  private ingestVessel(db: Db, v: AishubVessel): boolean {
    const { live, accepted } = ingestPosition(db, {
      mmsi: v.mmsi,
      lat: v.lat,
      lon: v.lon,
      sog: v.sog,
      cog: v.cog,
      heading: v.heading,
      ts: v.ts,
      name: v.name,
      shipType: v.shipType,
      source: "aishub",
      // Coverage regions are larger than the harbor TRAFFIC_BBOX.
      allowOutsideTrafficBbox: true,
    });
    if (!accepted || !live) return false;
    this.ingestCount += 1;
    this.broadcast({ type: "vessel", vessel: live });
    return true;
  }

  private async fetchAishub(params: Record<string, string | number>): Promise<AishubVessel[]> {
    if (this.lastCallAt != null) {
      const wait = this.minInterval() - (Date.now() - this.lastCallAt);
      if (wait > 0) await sleep(wait);
    }

    const url = new URL(AISHUB_URL);
    url.searchParams.set("username", config.aishubUsername);
    url.searchParams.set("format", "1"); // human-readable degrees / knots
    url.searchParams.set("output", "json");
    url.searchParams.set("compress", "0");
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    this.lastCallAt = Date.now();
    this.callCount += 1;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`AISHub HTTP ${res.status}`);

    const text = await res.text();
    if (!text.trim()) {
      // Empty body is the usual symptom of calling more than once per minute.
      throw new Error("AISHub empty response (rate limited or no data)");
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`AISHub non-JSON response: ${text.slice(0, 120)}`);
    }
    return extractVessels(json);
  }
}
