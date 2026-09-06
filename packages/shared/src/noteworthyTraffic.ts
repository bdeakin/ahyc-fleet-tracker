import { haversineNm, placeLabel } from "./harborGeo.js";

/** One AIS fix used by noteworthy-traffic detectors. */
export type NoteworthyFix = {
  mmsi: string;
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  ts: number;
  name?: string | null;
  /** AIS ship type code — 50 marks a pilot vessel. */
  shipType?: number | null;
};

export type TrackSegmentPoint = {
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  ts: number;
};

export type NearbyVesselSnapshot = {
  mmsi: string;
  name: string | null;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  distanceNm: number;
};

export type EvasiveManeuverEvent = {
  id: string;
  kind: "evasive";
  mmsi: string;
  name: string | null;
  ts: number;
  lat: number;
  lon: number;
  sogKn: number;
  cogBefore: number;
  cogAfter: number;
  cogDeltaDeg: number;
  turnRateDegPerMin: number;
  /** Track window around the turn for map drawing. */
  track: TrackSegmentPoint[];
  nearby: NearbyVesselSnapshot[];
};

export type NoWakeSpeedingEvent = {
  id: string;
  kind: "nowake";
  mmsi: string;
  name: string | null;
  /** Representative point (highest speed in the segment). */
  ts: number;
  lat: number;
  lon: number;
  maxSogKn: number;
  meanSogKn: number;
  /** Cluster size that defined the no-wake pocket. */
  clusterSize: number;
  track: TrackSegmentPoint[];
};

/** One side of an interception. */
export type InterceptionParty = {
  mmsi: string;
  name: string | null;
  /** Speed / course at the moment of closest approach. */
  sogKn: number | null;
  cogDeg: number | null;
  /** Slowest speed seen through the rendezvous window. */
  minSogKn: number | null;
  /** True when AIS ship type or name marks this as a pilot vessel. */
  pilot: boolean;
  track: TrackSegmentPoint[];
};

export type InterceptionEvent = {
  id: string;
  kind: "interception";
  /** Time of closest approach. */
  ts: number;
  /** Midpoint of the two vessels at closest approach. */
  lat: number;
  lon: number;
  a: InterceptionParty;
  b: InterceptionParty;
  closestNm: number;
  /** Range at the start of the approach window — how far they closed to meet. */
  approachFromNm: number;
  /** COG difference at closest approach (0 = same course). */
  courseAlignDeg: number;
  /** True when both were making way on nearly the same course — a transfer, not a crossing. */
  matchedCourse: boolean;
  /** Named waterway / landmark for the rendezvous. */
  place: string;
  /** Set when the meeting happened inside a known pilot boarding area. */
  pilotArea: string | null;
  /** Pilot boat + ship, by ship type, name, or boarding area. */
  pilotTransfer: boolean;
};

export type SuspectedGroundingEvent = {
  id: string;
  kind: "grounding";
  mmsi: string;
  name: string | null;
  /** Time the vessel came to a stop. */
  ts: number;
  lat: number;
  lon: number;
  /** Speed just before the stop. */
  sogBeforeKn: number;
  /** How hard it came off that speed. */
  decelKnPerMin: number;
  /** How long it stayed stopped inside the AIS window. */
  stoppedForMs: number;
  /** Other vessels that have also stopped in this cell — a berth or anchorage, not a grounding. */
  otherStoppedNearby: number;
  place: string;
  track: TrackSegmentPoint[];
  /** Charted / surveyed depth in meters, filled in when a bathymetry lookup is available. */
  chartedDepthM: number | null;
  /** Estimated draught in meters (AIS static draught is not carried in our feed). */
  draughtM: number | null;
  /** chartedDepthM − draughtM; negative means the vessel needs more water than there is. */
  clearanceM: number | null;
  confidence: "possible" | "likely";
};

export type SpeedRunEvent = {
  id: string;
  kind: "speed";
  mmsi: string;
  name: string | null;
  /** Time of the fastest fix in the run. */
  ts: number;
  lat: number;
  lon: number;
  maxSogKn: number;
  meanSogKn: number;
  /** How long it held above the threshold. */
  durationMs: number;
  /** Distance covered while above the threshold. */
  distanceNm: number;
  place: string;
  track: TrackSegmentPoint[];
};

export type NoteworthyEvent =
  | EvasiveManeuverEvent
  | NoWakeSpeedingEvent
  | InterceptionEvent
  | SuspectedGroundingEvent
  | SpeedRunEvent;

/**
 * Above this the fix is an AIS error, not a boat: SOG 102.3 is the "not available"
 * sentinel and garbled messages routinely decode into three-digit speeds.
 */
export const IMPLAUSIBLE_SOG_KN = 70;

/** True when a reported speed can be believed for a surface vessel. */
export function plausibleSog(sog: number | null | undefined): boolean {
  if (sog == null || !Number.isFinite(sog)) return false;
  return sog >= 0 && sog < IMPLAUSIBLE_SOG_KN;
}

/** Absolute smallest heading change between two COG values (0–180). */
export function cogDeltaDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/** Map SOG (kn) → CSS color for no-wake speeding tracks (green→red). */
export function speedTrackColor(sogKn: number, minKn = 5, maxKn = 25): string {
  const t = Math.max(0, Math.min(1, (sogKn - minKn) / (maxKn - minKn)));
  // green (120°) → yellow (60°) → red (0°)
  const hue = 120 * (1 - t);
  return `hsl(${hue.toFixed(0)} 85% 45%)`;
}

const EVASIVE_MIN_SOG_KN = 8;
const EVASIVE_MIN_COG_DELTA_DEG = 50;
const EVASIVE_MAX_GAP_MS = 3 * 60_000;
const EVASIVE_MIN_TURN_RATE_DEG_PER_MIN = 18;
const EVASIVE_NEARBY_NM = 0.45;
const EVASIVE_NEARBY_TIME_MS = 2 * 60_000;
const EVASIVE_TRACK_PAD_MS = 8 * 60_000;
const EVASIVE_MAX_EVENTS = 30;

const STOPPED_SOG_KN = 0.5;
const NOWAKE_SPEED_KN = 5;
const NOWAKE_GRID_NM = 0.12;
const NOWAKE_MIN_CLUSTER = 4;
/** A pocket needs several different boats sitting still — one boat alone is moored or aground. */
const NOWAKE_MIN_STOPPED_VESSELS = 2;
const NOWAKE_MAX_EVENTS = 40;

function gridKey(lat: number, lon: number, cellNm: number): string {
  const latCell = Math.floor(lat / (cellNm / 60));
  const lonCell = Math.floor(lon / (cellNm / (60 * Math.cos((lat * Math.PI) / 180) || 1e-6)));
  return `${latCell}:${lonCell}`;
}

function groupByMmsi(fixes: NoteworthyFix[]): Map<string, NoteworthyFix[]> {
  const by = new Map<string, NoteworthyFix[]>();
  for (const f of fixes) {
    const arr = by.get(f.mmsi) ?? [];
    arr.push(f);
    by.set(f.mmsi, arr);
  }
  for (const arr of by.values()) {
    arr.sort((a, b) => a.ts - b.ts);
  }
  return by;
}

function nameFor(fixes: NoteworthyFix[], mmsi: string): string | null {
  for (let i = fixes.length - 1; i >= 0; i--) {
    const n = fixes[i]?.name;
    if (n) return n;
  }
  // fall through — callers may also pass names on other vessels
  void mmsi;
  return null;
}

/**
 * Detect sudden large COG changes while making way (≥ ~8 kn).
 * Nearby vessels at the maneuver time are attached for context.
 */
export function detectEvasiveManeuvers(fixes: NoteworthyFix[]): EvasiveManeuverEvent[] {
  const byMmsi = groupByMmsi(fixes);
  const events: EvasiveManeuverEvent[] = [];

  for (const [mmsi, pts] of byMmsi) {
    if (pts.length < 3) continue;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const sog = Math.max(a.sog ?? 0, b.sog ?? 0);
      if (sog < EVASIVE_MIN_SOG_KN) continue;
      if (a.cog == null || b.cog == null) continue;
      if (!Number.isFinite(a.cog) || !Number.isFinite(b.cog)) continue;
      const dt = b.ts - a.ts;
      if (dt <= 0 || dt > EVASIVE_MAX_GAP_MS) continue;
      const delta = cogDeltaDeg(a.cog, b.cog);
      if (delta < EVASIVE_MIN_COG_DELTA_DEG) continue;
      const turnRate = delta / (dt / 60_000);
      if (turnRate < EVASIVE_MIN_TURN_RATE_DEG_PER_MIN) continue;

      const t0 = b.ts - EVASIVE_TRACK_PAD_MS;
      const t1 = b.ts + EVASIVE_TRACK_PAD_MS;
      const track: TrackSegmentPoint[] = pts
        .filter((p) => p.ts >= t0 && p.ts <= t1)
        .map((p) => ({
          lat: p.lat,
          lon: p.lon,
          sog: p.sog ?? null,
          cog: p.cog ?? null,
          ts: p.ts,
        }));

      const nearby: NearbyVesselSnapshot[] = [];
      for (const [otherMmsi, otherPts] of byMmsi) {
        if (otherMmsi === mmsi) continue;
        // closest fix in time window
        let best: NoteworthyFix | null = null;
        let bestDt = Infinity;
        for (const p of otherPts) {
          const dtw = Math.abs(p.ts - b.ts);
          if (dtw > EVASIVE_NEARBY_TIME_MS) continue;
          if (dtw < bestDt) {
            bestDt = dtw;
            best = p;
          }
        }
        if (!best) continue;
        const dist = haversineNm(b.lat, b.lon, best.lat, best.lon);
        if (dist > EVASIVE_NEARBY_NM) continue;
        nearby.push({
          mmsi: otherMmsi,
          name: best.name ?? nameFor(otherPts, otherMmsi),
          lat: best.lat,
          lon: best.lon,
          sog: best.sog ?? null,
          cog: best.cog ?? null,
          distanceNm: dist,
        });
      }
      nearby.sort((x, y) => x.distanceNm - y.distanceNm);

      events.push({
        id: `evasive:${mmsi}:${b.ts}`,
        kind: "evasive",
        mmsi,
        name: b.name ?? a.name ?? nameFor(pts, mmsi),
        ts: b.ts,
        lat: b.lat,
        lon: b.lon,
        sogKn: sog,
        cogBefore: a.cog,
        cogAfter: b.cog,
        cogDeltaDeg: delta,
        turnRateDegPerMin: turnRate,
        track,
        nearby: nearby.slice(0, 8),
      });
    }
  }

  events.sort((a, b) => b.turnRateDegPerMin * b.sogKn - a.turnRateDegPerMin * a.sogKn);
  // One strongest event per MMSI to keep the map readable.
  const seen = new Set<string>();
  const deduped: EvasiveManeuverEvent[] = [];
  for (const e of events) {
    if (seen.has(e.mmsi)) continue;
    seen.add(e.mmsi);
    deduped.push(e);
    if (deduped.length >= EVASIVE_MAX_EVENTS) break;
  }
  return deduped;
}

type CellAgg = { count: number; latSum: number; lonSum: number; mmsis: Set<string> };

/**
 * Build “no-wake” pockets from grids where many vessels sit nearly stopped,
 * then find track segments exceeding 5 kn through those pockets.
 */
export function detectNoWakeSpeeding(fixes: NoteworthyFix[]): NoWakeSpeedingEvent[] {
  const cells = new Map<string, CellAgg>();
  for (const f of fixes) {
    if ((f.sog ?? 0) > STOPPED_SOG_KN) continue;
    const key = gridKey(f.lat, f.lon, NOWAKE_GRID_NM);
    const cur = cells.get(key) ?? { count: 0, latSum: 0, lonSum: 0, mmsis: new Set<string>() };
    cur.count += 1;
    cur.latSum += f.lat;
    cur.lonSum += f.lon;
    cur.mmsis.add(f.mmsi);
    cells.set(key, cur);
  }

  const hotCells = new Map<string, { lat: number; lon: number; count: number; mmsis: Set<string> }>();
  for (const [key, agg] of cells) {
    if (agg.count < NOWAKE_MIN_CLUSTER) continue;
    // A single boat sitting still is aground or moored, not a no-wake pocket.
    if (agg.mmsis.size < NOWAKE_MIN_STOPPED_VESSELS) continue;
    hotCells.set(key, {
      lat: agg.latSum / agg.count,
      lon: agg.lonSum / agg.count,
      count: agg.count,
      mmsis: agg.mmsis,
    });
  }
  if (hotCells.size === 0) return [];

  function inHotPocket(lat: number, lon: number, mmsi: string): { count: number } | null {
    const key = gridKey(lat, lon, NOWAKE_GRID_NM);
    const hit = hotCells.get(key);
    // A vessel's own stopped fixes must not turn its berth into a pocket it then "speeds" through.
    if (hit && [...hit.mmsis].some((m) => m !== mmsi)) return { count: hit.count };
    // also accept 8-neighborhood so pocket edges still count
    const [latCell, lonCell] = key.split(":").map(Number) as [number, number];
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        if (dLat === 0 && dLon === 0) continue;
        const n = hotCells.get(`${latCell + dLat}:${lonCell + dLon}`);
        if (n && [...n.mmsis].some((m) => m !== mmsi)) return { count: n.count };
      }
    }
    return null;
  }

  const byMmsi = groupByMmsi(fixes);
  const events: NoWakeSpeedingEvent[] = [];

  for (const [mmsi, pts] of byMmsi) {
    let segment: TrackSegmentPoint[] = [];
    let maxSog = 0;
    let sumSog = 0;
    let sogN = 0;
    let clusterSize = 0;
    let peak: TrackSegmentPoint | null = null;

    const flush = () => {
      if (segment.length < 2 || maxSog < NOWAKE_SPEED_KN) {
        segment = [];
        maxSog = 0;
        sumSog = 0;
        sogN = 0;
        clusterSize = 0;
        peak = null;
        return;
      }
      const mean = sogN > 0 ? sumSog / sogN : maxSog;
      const rep = peak ?? segment[Math.floor(segment.length / 2)]!;
      events.push({
        id: `nowake:${mmsi}:${segment[0]!.ts}`,
        kind: "nowake",
        mmsi,
        name: nameFor(pts, mmsi),
        ts: rep.ts,
        lat: rep.lat,
        lon: rep.lon,
        maxSogKn: maxSog,
        meanSogKn: mean,
        clusterSize,
        track: segment,
      });
      segment = [];
      maxSog = 0;
      sumSog = 0;
      sogN = 0;
      clusterSize = 0;
      peak = null;
    };

    for (const p of pts) {
      const sog = p.sog ?? 0;
      const pocket = inHotPocket(p.lat, p.lon, mmsi);
      if (pocket && sog >= NOWAKE_SPEED_KN) {
        const pt: TrackSegmentPoint = {
          lat: p.lat,
          lon: p.lon,
          sog: p.sog ?? null,
          cog: p.cog ?? null,
          ts: p.ts,
        };
        segment.push(pt);
        if (sog > maxSog) {
          maxSog = sog;
          peak = pt;
        }
        sumSog += sog;
        sogN += 1;
        clusterSize = Math.max(clusterSize, pocket.count);
      } else if (segment.length > 0) {
        // allow one brief gap point still near pocket at speed
        flush();
      }
    }
    flush();
  }

  events.sort((a, b) => b.maxSogKn * b.clusterSize - a.maxSogKn * a.clusterSize);
  const seen = new Set<string>();
  const out: NoWakeSpeedingEvent[] = [];
  for (const e of events) {
    if (seen.has(e.mmsi)) continue;
    seen.add(e.mmsi);
    out.push(e);
    if (out.length >= NOWAKE_MAX_EVENTS) break;
  }
  return out;
}

/**
 * Where Sandy Hook pilots board and land ships bound for New York Harbor.
 * The Ambrose area is the busy one: pilot boats run out from Staten Island / Sandy Hook,
 * match course with an inbound ship, and transfer alongside.
 */
export const PILOT_BOARDING_AREAS: Array<{ name: string; lat: number; lon: number; radiusNm: number }> = [
  { name: "Ambrose pilot boarding area", lat: 40.4667, lon: -73.8333, radiusNm: 6 },
  { name: "Sandy Hook pilot station", lat: 40.4694, lon: -74.0111, radiusNm: 2.5 },
];

/** ~220 m — alongside, not merely in sight of each other. */
const INTERCEPT_CLOSE_NM = 0.12;
/** They must have closed from at least this far out for it to be a convergence. */
const INTERCEPT_APPROACH_NM = 0.6;
const INTERCEPT_APPROACH_WINDOW_MS = 15 * 60_000;
/** Longest gap in one vessel's track we will interpolate across. */
const INTERCEPT_MAX_GAP_MS = 10 * 60_000;
const INTERCEPT_TRACK_PAD_MS = 12 * 60_000;
/** Candidate-pair prefilter: grid cell and time bucket. */
const INTERCEPT_GRID_NM = 0.5;
const INTERCEPT_TIME_BUCKET_MS = 4 * 60_000;
const INTERCEPT_MIN_APPROACH_SOG_KN = 4;
const INTERCEPT_MATCHED_COURSE_DEG = 35;
const INTERCEPT_MATCHED_COURSE_SOG_KN = 3;
const INTERCEPT_MAX_EVENTS = 30;

const PILOT_SHIP_TYPE = 50;
const PILOT_NAME_RE = /\bpilot(s)?\b|^pilot|\bpilot boat\b/i;

function isPilotVessel(fixes: NoteworthyFix[]): boolean {
  for (const f of fixes) {
    if (f.shipType === PILOT_SHIP_TYPE) return true;
    if (f.name && PILOT_NAME_RE.test(f.name)) return true;
  }
  return false;
}

function pilotAreaFor(lat: number, lon: number): string | null {
  for (const area of PILOT_BOARDING_AREAS) {
    if (haversineNm(lat, lon, area.lat, area.lon) <= area.radiusNm) return area.name;
  }
  return null;
}

type Interpolated = { lat: number; lon: number; sog: number | null; cog: number | null };

/** Position of one vessel at `ts`, interpolated between the bracketing fixes. */
function fixAt(pts: NoteworthyFix[], ts: number, maxGapMs = INTERCEPT_MAX_GAP_MS): Interpolated | null {
  if (pts.length === 0) return null;
  let lo = 0;
  let hi = pts.length - 1;
  if (ts < pts[lo]!.ts || ts > pts[hi]!.ts) return null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.ts <= ts) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  if (b.ts - a.ts > maxGapMs) return null;
  const span = b.ts - a.ts;
  const t = span > 0 ? (ts - a.ts) / span : 0;
  const nearer = t < 0.5 ? a : b;
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    sog: nearer.sog ?? null,
    cog: nearer.cog ?? null,
  };
}

function trackAround(pts: NoteworthyFix[], ts: number): TrackSegmentPoint[] {
  return pts
    .filter((p) => Math.abs(p.ts - ts) <= INTERCEPT_TRACK_PAD_MS)
    .map((p) => ({ lat: p.lat, lon: p.lon, sog: p.sog ?? null, cog: p.cog ?? null, ts: p.ts }));
}

function minSogBetween(pts: NoteworthyFix[], from: number, to: number): number | null {
  let min: number | null = null;
  for (const p of pts) {
    if (p.ts < from || p.ts > to) continue;
    const sog = p.sog;
    if (sog == null || !Number.isFinite(sog)) continue;
    if (min == null || sog < min) min = sog;
  }
  return min;
}

function maxSogBetween(pts: NoteworthyFix[], from: number, to: number): number {
  let max = 0;
  for (const p of pts) {
    if (p.ts < from || p.ts > to) continue;
    const sog = p.sog ?? 0;
    if (sog > max) max = sog;
  }
  return max;
}

/** Candidate pairs that shared a grid cell within the same few minutes. */
function candidatePairs(fixes: NoteworthyFix[]): Set<string> {
  const buckets = new Map<string, Set<string>>();
  for (const f of fixes) {
    const tb = Math.floor(f.ts / INTERCEPT_TIME_BUCKET_MS);
    const key = `${tb}|${gridKey(f.lat, f.lon, INTERCEPT_GRID_NM)}`;
    const set = buckets.get(key) ?? new Set<string>();
    set.add(f.mmsi);
    buckets.set(key, set);
  }
  const pairs = new Set<string>();
  for (const set of buckets.values()) {
    if (set.size < 2) continue;
    const list = [...set];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
    }
  }
  return pairs;
}

/**
 * Detect vessels that converged and met: two tracks that close from well apart to
 * alongside. Around Ambrose this is mostly pilot boats boarding or landing a pilot on
 * ships entering or leaving New York Harbor.
 */
export function detectInterceptions(fixes: NoteworthyFix[]): InterceptionEvent[] {
  const byMmsi = groupByMmsi(fixes);
  const pilotFlags = new Map<string, boolean>();
  for (const [mmsi, pts] of byMmsi) pilotFlags.set(mmsi, isPilotVessel(pts));

  const events: InterceptionEvent[] = [];

  for (const pair of candidatePairs(fixes)) {
    const [mmsiA, mmsiB] = pair.split("|") as [string, string];
    const ptsA = byMmsi.get(mmsiA);
    const ptsB = byMmsi.get(mmsiB);
    if (!ptsA || !ptsB || ptsA.length < 2 || ptsB.length < 2) continue;

    const from = Math.max(ptsA[0]!.ts, ptsB[0]!.ts);
    const to = Math.min(ptsA[ptsA.length - 1]!.ts, ptsB[ptsB.length - 1]!.ts);
    if (to <= from) continue;

    const samples = [...ptsA, ...ptsB]
      .map((p) => p.ts)
      .filter((ts) => ts >= from && ts <= to)
      .sort((x, y) => x - y);

    let best: { ts: number; nm: number; a: Interpolated; b: Interpolated } | null = null;
    for (const ts of samples) {
      const a = fixAt(ptsA, ts);
      const b = fixAt(ptsB, ts);
      if (!a || !b) continue;
      const nm = haversineNm(a.lat, a.lon, b.lat, b.lon);
      if (!best || nm < best.nm) best = { ts, nm, a, b };
    }
    if (!best || best.nm > INTERCEPT_CLOSE_NM) continue;

    // Must have converged: far apart earlier in the approach window.
    const approachTs = best.ts - INTERCEPT_APPROACH_WINDOW_MS;
    const beforeA = fixAt(ptsA, approachTs) ?? fixAt(ptsA, Math.max(from, approachTs));
    const beforeB = fixAt(ptsB, approachTs) ?? fixAt(ptsB, Math.max(from, approachTs));
    if (!beforeA || !beforeB) continue;
    const approachFromNm = haversineNm(beforeA.lat, beforeA.lon, beforeB.lat, beforeB.lon);
    if (approachFromNm < INTERCEPT_APPROACH_NM) continue;

    // At least one of them ran to the meeting.
    const fastest = Math.max(
      maxSogBetween(ptsA, approachTs, best.ts),
      maxSogBetween(ptsB, approachTs, best.ts),
    );
    if (fastest < INTERCEPT_MIN_APPROACH_SOG_KN) continue;

    const courseAlignDeg =
      best.a.cog != null && best.b.cog != null ? cogDeltaDeg(best.a.cog, best.b.cog) : 180;
    const matchedCourse =
      courseAlignDeg <= INTERCEPT_MATCHED_COURSE_DEG &&
      (best.a.sog ?? 0) >= INTERCEPT_MATCHED_COURSE_SOG_KN &&
      (best.b.sog ?? 0) >= INTERCEPT_MATCHED_COURSE_SOG_KN;

    const lat = (best.a.lat + best.b.lat) / 2;
    const lon = (best.a.lon + best.b.lon) / 2;
    const pilotArea = pilotAreaFor(lat, lon);
    const pilotA = pilotFlags.get(mmsiA) === true;
    const pilotB = pilotFlags.get(mmsiB) === true;
    const pilotTransfer = (pilotA || pilotB) && (matchedCourse || pilotArea != null);

    events.push({
      id: `interception:${mmsiA}:${mmsiB}:${best.ts}`,
      kind: "interception",
      ts: best.ts,
      lat,
      lon,
      a: {
        mmsi: mmsiA,
        name: nameFor(ptsA, mmsiA),
        sogKn: best.a.sog,
        cogDeg: best.a.cog,
        minSogKn: minSogBetween(ptsA, approachTs, best.ts + INTERCEPT_TRACK_PAD_MS),
        pilot: pilotA,
        track: trackAround(ptsA, best.ts),
      },
      b: {
        mmsi: mmsiB,
        name: nameFor(ptsB, mmsiB),
        sogKn: best.b.sog,
        cogDeg: best.b.cog,
        minSogKn: minSogBetween(ptsB, approachTs, best.ts + INTERCEPT_TRACK_PAD_MS),
        pilot: pilotB,
        track: trackAround(ptsB, best.ts),
      },
      closestNm: best.nm,
      approachFromNm,
      courseAlignDeg,
      matchedCourse,
      place: placeLabel(lat, lon),
      pilotArea,
      pilotTransfer,
    });
  }

  // Pilot transfers first, then the tightest convergences.
  events.sort((x, y) => {
    if (x.pilotTransfer !== y.pilotTransfer) return x.pilotTransfer ? -1 : 1;
    const scoreX = x.approachFromNm / Math.max(x.closestNm, 0.01);
    const scoreY = y.approachFromNm / Math.max(y.closestNm, 0.01);
    return scoreY - scoreX;
  });

  // One event per vessel pair; keep the strongest.
  const seen = new Set<string>();
  const out: InterceptionEvent[] = [];
  for (const e of events) {
    const key = `${e.a.mmsi}|${e.b.mmsi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= INTERCEPT_MAX_EVENTS) break;
  }
  return out;
}

/** Speed at or below which we treat a vessel as stopped for grounding checks. */
const GROUNDING_STOPPED_SOG_KN = 0.6;
/** It has to have been making way first. */
const GROUNDING_MIN_SOG_BEFORE_KN = 3.5;
/** The stop has to be abrupt: full speed to stopped inside this long. */
const GROUNDING_MAX_STOP_MS = 6 * 60_000;
/** And it has to stay put, not just slow for a lock or a bridge. */
const GROUNDING_MIN_STOPPED_MS = 12 * 60_000;
const GROUNDING_GRID_NM = 0.15;
/** Cells where other vessels routinely stop are berths, moorings or anchorages. */
const GROUNDING_MAX_OTHERS_STOPPED = 1;
const GROUNDING_TRACK_PAD_MS = 20 * 60_000;
const GROUNDING_MAX_EVENTS = 25;

/**
 * Typical loaded draught in meters by AIS ship-type category. Our AIS feeds do not carry
 * the static draught field, so a grounding call is only ever "suspected".
 */
export const DRAUGHT_ESTIMATE_M: Record<string, number> = {
  sailing: 1.8,
  pleasure: 1.0,
  fishing: 2.4,
  tug: 4.0,
  passenger: 3.0,
  cargo: 8.5,
  tanker: 11.0,
  highspeed: 1.5,
  pilot: 2.2,
  other: 2.0,
};

function draughtKeyForShipType(shipType: number | null | undefined): string {
  const code = shipType ?? 0;
  if (code >= 80 && code <= 89) return "tanker";
  if (code >= 70 && code <= 79) return "cargo";
  if (code >= 60 && code <= 69) return "passenger";
  if (code >= 40 && code <= 49) return "highspeed";
  if (code === 30) return "fishing";
  if (code === 31 || code === 32 || code === 52) return "tug";
  if (code === 36) return "sailing";
  if (code === 37) return "pleasure";
  if (code === 50) return "pilot";
  return "other";
}

/**
 * Draught estimate in meters. Length dominates for commercial hulls
 * (≈5.5% of LOA); small craft fall back to the type default.
 */
export function estimateDraughtM(
  shipType: number | null | undefined,
  lengthM?: number | null,
): number {
  const key = draughtKeyForShipType(shipType);
  const base = DRAUGHT_ESTIMATE_M[key] ?? DRAUGHT_ESTIMATE_M.other!;
  if ((key === "cargo" || key === "tanker" || key === "passenger") && lengthM && lengthM > 20) {
    return Math.max(base * 0.6, Math.min(base * 1.6, lengthM * 0.055));
  }
  return base;
}

/**
 * Vessels that went from making way to stopped in one or two reports and then stayed put,
 * somewhere no other traffic stops. Depth and draught are attached separately — see
 * `gradeGrounding` — because bathymetry has to be looked up per position.
 */
export function detectSuddenStops(fixes: NoteworthyFix[]): SuspectedGroundingEvent[] {
  const byMmsi = groupByMmsi(fixes);

  // Which cells does other traffic stop in? Those are berths, moorings and anchorages.
  const stoppedByCell = new Map<string, Set<string>>();
  for (const f of fixes) {
    if ((f.sog ?? 0) > GROUNDING_STOPPED_SOG_KN) continue;
    const key = gridKey(f.lat, f.lon, GROUNDING_GRID_NM);
    const set = stoppedByCell.get(key) ?? new Set<string>();
    set.add(f.mmsi);
    stoppedByCell.set(key, set);
  }

  const events: SuspectedGroundingEvent[] = [];

  for (const [mmsi, pts] of byMmsi) {
    if (pts.length < 3) continue;
    for (let i = 1; i < pts.length; i++) {
      const before = pts[i - 1]!;
      const stop = pts[i]!;
      const sogBefore = before.sog ?? 0;
      if (sogBefore < GROUNDING_MIN_SOG_BEFORE_KN) continue;
      if ((stop.sog ?? 0) > GROUNDING_STOPPED_SOG_KN) continue;
      const dt = stop.ts - before.ts;
      if (dt <= 0 || dt > GROUNDING_MAX_STOP_MS) continue;

      // Stayed stopped afterwards (and did not simply stop reporting).
      let last = stop;
      let j = i + 1;
      for (; j < pts.length; j++) {
        const p = pts[j]!;
        if ((p.sog ?? 0) > GROUNDING_STOPPED_SOG_KN) break;
        last = p;
      }
      const stoppedForMs = last.ts - stop.ts;
      if (stoppedForMs < GROUNDING_MIN_STOPPED_MS) continue;

      const cell = stoppedByCell.get(gridKey(stop.lat, stop.lon, GROUNDING_GRID_NM));
      const others = cell ? [...cell].filter((m) => m !== mmsi).length : 0;
      if (others > GROUNDING_MAX_OTHERS_STOPPED) continue;

      events.push({
        id: `grounding:${mmsi}:${stop.ts}`,
        kind: "grounding",
        mmsi,
        name: stop.name ?? before.name ?? nameFor(pts, mmsi),
        ts: stop.ts,
        lat: stop.lat,
        lon: stop.lon,
        sogBeforeKn: sogBefore,
        decelKnPerMin: sogBefore / Math.max(dt / 60_000, 0.5),
        stoppedForMs,
        otherStoppedNearby: others,
        place: placeLabel(stop.lat, stop.lon),
        track: pts
          .filter((p) => p.ts >= stop.ts - GROUNDING_TRACK_PAD_MS && p.ts <= last.ts + GROUNDING_TRACK_PAD_MS)
          .map((p) => ({ lat: p.lat, lon: p.lon, sog: p.sog ?? null, cog: p.cog ?? null, ts: p.ts })),
        chartedDepthM: null,
        draughtM: null,
        clearanceM: null,
        confidence: "possible",
      });

      // Skip ahead past this stop so one grounding is not reported per fix.
      i = Math.max(i, j - 1);
    }
  }

  events.sort((a, b) => b.decelKnPerMin * b.sogBeforeKn - a.decelKnPerMin * a.sogBeforeKn);
  return events.slice(0, GROUNDING_MAX_EVENTS);
}

/** Clearance under the keel below which a stop reads as touching bottom. */
const GROUNDING_LIKELY_CLEARANCE_M = 0.5;
const GROUNDING_POSSIBLE_CLEARANCE_M = 1.5;

/**
 * Attach depth / draught to a sudden stop and decide whether it looks like a grounding.
 * Returns null when there is comfortably enough water for the vessel.
 */
export function gradeGrounding(
  event: SuspectedGroundingEvent,
  depthM: number | null,
  draughtM: number | null,
): SuspectedGroundingEvent | null {
  if (depthM == null) {
    // No bathymetry: keep it only as a weak signal, since an unexplained hard stop still matters.
    return { ...event, draughtM, confidence: "possible" };
  }
  const clearanceM = draughtM != null ? depthM - draughtM : null;
  if (clearanceM != null && clearanceM > GROUNDING_POSSIBLE_CLEARANCE_M) return null;
  if (clearanceM == null && depthM > 6) return null;
  const confidence: "possible" | "likely" =
    clearanceM != null && clearanceM <= GROUNDING_LIKELY_CLEARANCE_M ? "likely" : "possible";
  return { ...event, chartedDepthM: depthM, draughtM, clearanceM, confidence };
}

/** "Need for speed" threshold — well past any displacement hull in the harbor. */
export const SPEED_RUN_KN = 30;
/** One fix over the line is noise; two in a row is a boat actually moving. */
const SPEED_RUN_MIN_FIXES = 2;
const SPEED_RUN_MAX_GAP_MS = 6 * 60_000;
const SPEED_RUN_MAX_EVENTS = 30;

/**
 * Vessels that ran above 30 knots — go-fast boats, patrol craft and the fast ferries.
 * Impossible speeds are dropped rather than celebrated: those are AIS decode errors.
 */
export function detectSpeedRuns(fixes: NoteworthyFix[]): SpeedRunEvent[] {
  const byMmsi = groupByMmsi(fixes);
  const events: SpeedRunEvent[] = [];

  for (const [mmsi, pts] of byMmsi) {
    let run: NoteworthyFix[] = [];

    const flush = () => {
      if (run.length >= SPEED_RUN_MIN_FIXES) {
        let peak = run[0]!;
        let sum = 0;
        let distanceNm = 0;
        for (let i = 0; i < run.length; i++) {
          const p = run[i]!;
          sum += p.sog ?? 0;
          if ((p.sog ?? 0) > (peak.sog ?? 0)) peak = p;
          if (i > 0) {
            const prev = run[i - 1]!;
            distanceNm += haversineNm(prev.lat, prev.lon, p.lat, p.lon);
          }
        }
        events.push({
          id: `speed:${mmsi}:${run[0]!.ts}`,
          kind: "speed",
          mmsi,
          name: nameFor(pts, mmsi),
          ts: peak.ts,
          lat: peak.lat,
          lon: peak.lon,
          maxSogKn: peak.sog ?? 0,
          meanSogKn: sum / run.length,
          durationMs: run[run.length - 1]!.ts - run[0]!.ts,
          distanceNm,
          place: placeLabel(peak.lat, peak.lon),
          track: run.map((p) => ({
            lat: p.lat,
            lon: p.lon,
            sog: p.sog ?? null,
            cog: p.cog ?? null,
            ts: p.ts,
          })),
        });
      }
      run = [];
    };

    for (const p of pts) {
      const sog = p.sog;
      if (!plausibleSog(sog) || (sog as number) < SPEED_RUN_KN) {
        flush();
        continue;
      }
      const prev = run[run.length - 1];
      if (prev && p.ts - prev.ts > SPEED_RUN_MAX_GAP_MS) flush();
      run.push(p);
    }
    flush();
  }

  events.sort((a, b) => b.maxSogKn - a.maxSogKn);
  const seen = new Set<string>();
  const out: SpeedRunEvent[] = [];
  for (const e of events) {
    if (seen.has(e.mmsi)) continue;
    seen.add(e.mmsi);
    out.push(e);
    if (out.length >= SPEED_RUN_MAX_EVENTS) break;
  }
  return out;
}

/** One vessel's stored positions through a noteworthy event, for map playback. */
export type NoteworthyPlaybackTrack = {
  mmsi: string;
  name: string | null;
  /** "subject" is the vessel the event is about; "counterpart" is the other half of a meeting. */
  role: "subject" | "counterpart";
  pilot: boolean;
  points: TrackSegmentPoint[];
};

/** The tracks an event was built from, so the kiosk can replay it. */
export function noteworthyPlaybackTracks(event: NoteworthyEvent): NoteworthyPlaybackTrack[] {
  if (event.kind === "interception") {
    const pair: NoteworthyPlaybackTrack[] = [
      {
        mmsi: event.a.mmsi,
        name: event.a.name,
        role: "subject",
        pilot: event.a.pilot,
        points: event.a.track,
      },
      {
        mmsi: event.b.mmsi,
        name: event.b.name,
        role: "counterpart",
        pilot: event.b.pilot,
        points: event.b.track,
      },
    ];
    return pair.filter((t) => t.points.length > 0);
  }
  if (event.track.length === 0) return [];
  return [
    { mmsi: event.mmsi, name: event.name, role: "subject", pilot: false, points: event.track },
  ];
}

/** Time span covered by an event's tracks, always wide enough to hold the event itself. */
export function noteworthyPlaybackWindow(event: NoteworthyEvent): { from: number; to: number } {
  let from = event.ts;
  let to = event.ts;
  for (const track of noteworthyPlaybackTracks(event)) {
    for (const p of track.points) {
      if (p.ts < from) from = p.ts;
      if (p.ts > to) to = p.ts;
    }
  }
  if (to <= from) to = from + 60_000;
  return { from, to };
}

/** Where a vessel was at `ts`, interpolated between stored fixes. */
export function positionAt(
  points: TrackSegmentPoint[],
  ts: number,
): { lat: number; lon: number; sog: number | null; cog: number | null; stale: boolean } | null {
  if (points.length === 0) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (ts <= first.ts) return { ...first, stale: ts < first.ts - 1000 };
  if (ts >= last.ts) return { ...last, stale: ts > last.ts + 1000 };

  let i = 1;
  while (i < points.length && points[i]!.ts < ts) i += 1;
  const a = points[i - 1]!;
  const b = points[i]!;
  const span = b.ts - a.ts;
  const f = span > 0 ? (ts - a.ts) / span : 0;
  const sog = a.sog != null && b.sog != null ? a.sog + (b.sog - a.sog) * f : (a.sog ?? b.sog);
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    sog,
    // Courses wrap at 360, so take the heading of the leg being travelled.
    cog: bearingDeg(a.lat, a.lon, b.lat, b.lon) ?? a.cog ?? b.cog,
    stale: false,
  };
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number | null {
  const toRad = Math.PI / 180;
  const dLon = (lon2 - lon1) * toRad;
  const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
  if (x === 0 && y === 0) return null;
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}
