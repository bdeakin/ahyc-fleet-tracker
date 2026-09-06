import { haversineNm } from "./harborGeo.js";

/** One AIS fix used by noteworthy-traffic detectors. */
export type NoteworthyFix = {
  mmsi: string;
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
  ts: number;
  name?: string | null;
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

export type NoteworthyEvent = EvasiveManeuverEvent | NoWakeSpeedingEvent;

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

type CellAgg = { count: number; latSum: number; lonSum: number };

/**
 * Build “no-wake” pockets from grids where many vessels sit nearly stopped,
 * then find track segments exceeding 5 kn through those pockets.
 */
export function detectNoWakeSpeeding(fixes: NoteworthyFix[]): NoWakeSpeedingEvent[] {
  const cells = new Map<string, CellAgg>();
  for (const f of fixes) {
    if ((f.sog ?? 0) > STOPPED_SOG_KN) continue;
    const key = gridKey(f.lat, f.lon, NOWAKE_GRID_NM);
    const cur = cells.get(key) ?? { count: 0, latSum: 0, lonSum: 0 };
    cur.count += 1;
    cur.latSum += f.lat;
    cur.lonSum += f.lon;
    cells.set(key, cur);
  }

  const hotCells = new Map<string, { lat: number; lon: number; count: number }>();
  for (const [key, agg] of cells) {
    if (agg.count < NOWAKE_MIN_CLUSTER) continue;
    hotCells.set(key, {
      lat: agg.latSum / agg.count,
      lon: agg.lonSum / agg.count,
      count: agg.count,
    });
  }
  if (hotCells.size === 0) return [];

  function inHotPocket(lat: number, lon: number): { count: number } | null {
    const key = gridKey(lat, lon, NOWAKE_GRID_NM);
    const hit = hotCells.get(key);
    if (hit) return { count: hit.count };
    // also accept 8-neighborhood so pocket edges still count
    const [latCell, lonCell] = key.split(":").map(Number) as [number, number];
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        if (dLat === 0 && dLon === 0) continue;
        const n = hotCells.get(`${latCell + dLat}:${lonCell + dLon}`);
        if (n) return { count: n.count };
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
      const pocket = inHotPocket(p.lat, p.lon);
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
