/** Home radio / ops station — 307 Ocean Blvd, Atlantic Highlands, NJ (NJ geocode). */
export const HOME_STATION = {
  name: "307 Ocean Blvd",
  lat: 40.410423,
  lon: -74.011874,
} as const;

export function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 3440.065; // Earth radius in nautical miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function distanceFromHomeNm(lat: number, lon: number): number {
  return haversineNm(HOME_STATION.lat, HOME_STATION.lon, lat, lon);
}

export function formatNm(nm: number): string {
  if (!Number.isFinite(nm)) return "—";
  if (nm < 0.1) return `${Math.round(nm * 1852)} m`;
  if (nm < 10) return `${nm.toFixed(1)} nm`;
  return `${nm.toFixed(0)} nm`;
}

type LonLat = [number, number]; // [lon, lat]

type NamedWaterway = {
  name: string;
  /** Rough polygon rings (lon, lat). First match wins — list specific channels before broad bays. */
  ring: LonLat[];
};

type Landmark = {
  name: string;
  lat: number;
  lon: number;
};

function pointInRing(lon: number, lat: number, ring: LonLat[]): boolean {
  // Ray casting
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Cardinal / intercardinal from true bearing (degrees). */
export function bearingToCardinal(bearingDeg: number): string {
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
  const idx = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return labels[idx]!;
}

/** Initial bearing from A → B in degrees [0, 360). */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Approximate polygons for Mid-Atlantic waters (NY/NJ harbor + Delaware + approaches).
 * Specific channels first; broad bays / rivers later.
 */
export const HARBOR_WATERWAYS: NamedWaterway[] = [
  {
    name: "Buttermilk Channel",
    ring: [
      [-74.02, 40.68],
      [-74.005, 40.68],
      [-74.005, 40.695],
      [-74.02, 40.695],
    ],
  },
  {
    name: "East River",
    ring: [
      [-74.0, 40.695],
      [-73.96, 40.695],
      [-73.93, 40.78],
      [-73.97, 40.78],
    ],
  },
  {
    name: "The Narrows",
    ring: [
      [-74.08, 40.59],
      [-74.03, 40.59],
      [-74.03, 40.65],
      [-74.08, 40.65],
    ],
  },
  {
    name: "Ambrose Channel",
    ring: [
      [-74.0, 40.45],
      [-73.85, 40.45],
      [-73.82, 40.52],
      [-73.97, 40.52],
    ],
  },
  {
    name: "Atlantic Highlands Harbor",
    ring: [
      [-74.05, 40.405],
      [-74.02, 40.405],
      [-74.02, 40.425],
      [-74.05, 40.425],
    ],
  },
  {
    name: "Sandy Hook Bay",
    ring: [
      [-74.08, 40.42],
      [-73.98, 40.42],
      [-73.98, 40.49],
      [-74.08, 40.49],
    ],
  },
  {
    name: "Raritan Bay",
    ring: [
      [-74.28, 40.45],
      [-74.08, 40.45],
      [-74.08, 40.52],
      [-74.28, 40.52],
    ],
  },
  {
    name: "Upper New York Bay",
    ring: [
      [-74.08, 40.65],
      [-74.0, 40.65],
      [-74.0, 40.7],
      [-74.08, 40.7],
    ],
  },
  {
    name: "Hudson River",
    ring: [
      [-74.03, 40.7],
      [-73.99, 40.7],
      [-73.96, 40.88],
      [-74.02, 40.88],
    ],
  },
  {
    name: "Lower New York Bay",
    ring: [
      [-74.15, 40.48],
      [-73.95, 40.48],
      [-73.95, 40.59],
      [-74.15, 40.59],
    ],
  },
  {
    name: "Navesink River",
    ring: [
      [-74.08, 40.365],
      [-74.0, 40.365],
      [-74.0, 40.4],
      [-74.08, 40.4],
    ],
  },
  {
    name: "Shrewsbury River",
    ring: [
      [-74.05, 40.32],
      [-73.97, 40.32],
      [-73.97, 40.365],
      [-74.05, 40.365],
    ],
  },
  {
    name: "Kill Van Kull",
    ring: [
      [-74.2, 40.63],
      [-74.06, 40.63],
      [-74.06, 40.66],
      [-74.2, 40.66],
    ],
  },
  {
    name: "Arthur Kill",
    ring: [
      [-74.28, 40.5],
      [-74.2, 40.5],
      [-74.2, 40.64],
      [-74.28, 40.64],
    ],
  },
  {
    name: "Newark Bay",
    ring: [
      [-74.18, 40.66],
      [-74.1, 40.66],
      [-74.1, 40.72],
      [-74.18, 40.72],
    ],
  },
  {
    // Trenton → Philly → Wilmington corridor (covers RAYSUT-class Delaware River traffic).
    name: "Delaware River",
    ring: [
      [-74.88, 40.25],
      [-74.68, 40.25],
      [-74.72, 40.12],
      [-74.88, 40.02],
      [-75.05, 39.92],
      [-75.22, 39.82],
      [-75.42, 39.72],
      [-75.58, 39.68],
      [-75.62, 39.78],
      [-75.45, 39.88],
      [-75.25, 39.98],
      [-75.08, 40.08],
      [-74.95, 40.18],
    ],
  },
  {
    name: "Delaware Bay",
    ring: [
      [-75.55, 38.78],
      [-74.95, 38.78],
      [-74.95, 39.15],
      [-75.15, 39.45],
      [-75.55, 39.55],
      [-75.7, 39.35],
      [-75.7, 38.95],
    ],
  },
  {
    name: "Chesapeake Bay approaches",
    ring: [
      [-76.2, 36.9],
      [-75.7, 36.9],
      [-75.7, 37.4],
      [-76.2, 37.4],
    ],
  },
];

/** Coastal / river cities used for “X nm SW of …” phrasing. */
export const PLACE_LANDMARKS: Landmark[] = [
  { name: "Philadelphia", lat: 39.9526, lon: -75.1652 },
  { name: "Camden", lat: 39.9259, lon: -75.1196 },
  { name: "Wilmington", lat: 39.7391, lon: -75.5398 },
  { name: "Trenton", lat: 40.2206, lon: -74.7597 },
  { name: "Chester", lat: 39.8496, lon: -75.3557 },
  { name: "Atlantic City", lat: 39.3643, lon: -74.4229 },
  { name: "Cape May", lat: 38.9351, lon: -74.906 },
  { name: "Atlantic Highlands", lat: 40.4079, lon: -74.0343 },
  { name: "Sandy Hook", lat: 40.467, lon: -74.0 },
  { name: "New York", lat: 40.7128, lon: -74.006 },
  { name: "Newark", lat: 40.7357, lon: -74.1724 },
  { name: "Jersey City", lat: 40.7178, lon: -74.0431 },
  { name: "Staten Island", lat: 40.5795, lon: -74.1502 },
  { name: "Brooklyn", lat: 40.6782, lon: -73.9442 },
  { name: "Bridgeport", lat: 41.1865, lon: -73.1952 },
  { name: "New Haven", lat: 41.3083, lon: -72.9279 },
  { name: "Baltimore", lat: 39.2904, lon: -76.6122 },
  { name: "Norfolk", lat: 36.8508, lon: -76.2859 },
  { name: "Lewes", lat: 38.7746, lon: -75.1393 },
];

function matchedWaterway(lat: number, lon: number): string | null {
  for (const w of HARBOR_WATERWAYS) {
    if (pointInRing(lon, lat, w.ring)) return w.name;
  }
  return null;
}

function nearestLandmark(
  lat: number,
  lon: number,
  maxNm = 45,
): { name: string; nm: number; bearing: number } | null {
  let best: { name: string; nm: number; bearing: number } | null = null;
  for (const lm of PLACE_LANDMARKS) {
    const nm = haversineNm(lat, lon, lm.lat, lm.lon);
    if (nm > maxNm) continue;
    if (!best || nm < best.nm) {
      best = {
        name: lm.name,
        nm,
        bearing: bearingDeg(lm.lat, lm.lon, lat, lon),
      };
    }
  }
  return best;
}

export type PlaceDescription = {
  label: string;
  waterway: string | null;
  near: string | null;
  distanceNm: number | null;
  cardinal: string | null;
  source: "local";
};

/**
 * Human place line for a lat/lon: waterway when known, plus distance/bearing to a nearby city.
 * Example: "On the Delaware River, 8 nm SW of Philadelphia"
 */
export function describePlace(lat: number, lon: number): PlaceDescription {
  const waterway = matchedWaterway(lat, lon);
  const near = nearestLandmark(lat, lon);
  const cardinal = near ? bearingToCardinal(near.bearing) : null;
  const nmRounded = near ? (near.nm < 10 ? Math.round(near.nm * 10) / 10 : Math.round(near.nm)) : null;

  let label: string;
  if (waterway && near && nmRounded != null && cardinal) {
    const article = /^(Upper|Lower|The)\b/i.test(waterway) ? "" : "the ";
    label = `On ${article}${waterway}, ${nmRounded} nm ${cardinal} of ${near.name}`;
  } else if (waterway) {
    const article = /^(Upper|Lower|The)\b/i.test(waterway) ? "" : "the ";
    label = `On ${article}${waterway}`;
  } else if (near && nmRounded != null && cardinal) {
    label = `${nmRounded} nm ${cardinal} of ${near.name}`;
  } else if (lat < 40.42 && lon > -74.0) {
    label = "Atlantic approaches";
  } else if (lat >= 40.42 && lat < 40.55 && lon <= -74.08) {
    label = "Raritan Bay approaches";
  } else {
    label = "Coastal waters";
  }

  return {
    label,
    waterway,
    near: near?.name ?? null,
    distanceNm: near?.nm ?? null,
    cardinal,
    source: "local",
  };
}

/** Short place label for trays / panes (local polygons + landmarks; no network). */
export function waterwayName(lat: number, lon: number): string {
  return describePlace(lat, lon).label;
}

export type MotionFix = {
  mmsi: string;
  lat: number;
  lon: number;
  sog?: number | null;
  cog?: number | null;
};

export type CollisionRisk = {
  mmsi: string;
  otherMmsi: string;
  tcpaMin: number;
  dcpaNm: number;
};

/**
 * Harbor CPA alerts — tuned to avoid lighting up docks and channel traffic.
 *
 * Upper Bay / Kill Van Kull ships routinely pass within 0.1 nm, and fairway tracks
 * skim marina docks. Broad “DCPA ≤ 0.1 nm in 12 min” made half the harbor flash.
 *
 * Rules:
 * - Two stopped vessels never alert.
 * - Both underway: DCPA ≤ 0.05 nm within 8 min; nearly-parallel courses need a
 *   tighter same-track miss distance (intentional abeam passes are ignored).
 * - Mover vs stopped: only the mover is marked, and only if its projected track
 *   comes within ~50 m of the parked boat (not every pier skim).
 */
const DCPA_MOVING_NM = 0.05;
const DCPA_PARALLEL_NM = 0.03;
const DCPA_VS_STOPPED_NM = 0.025;
const TCPA_ALERT_MIN = 8;
const MIN_MOVING_SOG_KN = 1;
/** Mover must be making way before we treat a parked boat as a collision target. */
const MIN_SOG_VS_STOPPED_KN = 2;
const PARALLEL_COURSE_DEG = 25;
const PAIR_RANGE_GATE_NM = 2;

function velNmPerMin(sogKn: number, cogDeg: number): { n: number; e: number } {
  const rad = (cogDeg * Math.PI) / 180;
  return { n: (sogKn * Math.cos(rad)) / 60, e: (sogKn * Math.sin(rad)) / 60 };
}

function relativeNm(a: MotionFix, b: MotionFix): { n: number; e: number } {
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  return {
    n: (b.lat - a.lat) * 60,
    e: (b.lon - a.lon) * 60 * Math.cos(meanLat),
  };
}

function isMoving(v: MotionFix): boolean {
  const sog = v.sog ?? 0;
  return sog >= MIN_MOVING_SOG_KN && v.cog != null && Number.isFinite(v.cog);
}

function velocityOf(v: MotionFix): { n: number; e: number } {
  if (!isMoving(v)) return { n: 0, e: 0 };
  return velNmPerMin(v.sog as number, v.cog as number);
}

function courseDiffDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function nearlyParallel(a: MotionFix, b: MotionFix): boolean {
  if (a.cog == null || b.cog == null) return false;
  const d = courseDiffDeg(a.cog, b.cog);
  return d <= PARALLEL_COURSE_DEG || d >= 180 - PARALLEL_COURSE_DEG;
}

/**
 * Returns MMSIs with a collision risk vs at least one other vessel.
 * Stopped vessels are never marked (only a closing mover can be).
 */
export function collisionRiskMmsis(vessels: MotionFix[]): Set<string> {
  const atRisk = new Set<string>();
  const list = vessels.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const movingA = isMoving(a);
      const movingB = isMoving(b);
      if (!movingA && !movingB) continue;

      const dNow = haversineNm(a.lat, a.lon, b.lat, b.lon);
      if (dNow > PAIR_RANGE_GATE_NM) continue;

      const va = velocityOf(a);
      const vb = velocityOf(b);
      const dv = { n: vb.n - va.n, e: vb.e - va.e };
      const dp = relativeNm(a, b);
      const dv2 = dv.n * dv.n + dv.e * dv.e;
      if (dv2 < 1e-10) continue;

      const tcpaMin = -(dp.n * dv.n + dp.e * dv.e) / dv2;
      if (tcpaMin < 0 || tcpaMin > TCPA_ALERT_MIN) continue;
      const cn = dp.n + dv.n * tcpaMin;
      const ce = dp.e + dv.e * tcpaMin;
      const dcpaNm = Math.sqrt(cn * cn + ce * ce);

      if (movingA && movingB) {
        const limit = nearlyParallel(a, b) ? DCPA_PARALLEL_NM : DCPA_MOVING_NM;
        if (dcpaNm <= limit) {
          atRisk.add(a.mmsi);
          atRisk.add(b.mmsi);
        }
        continue;
      }

      // Mover vs stopped: pier traffic must not paint every docked circle red.
      if (dcpaNm > DCPA_VS_STOPPED_NM) continue;
      const mover = movingA ? a : b;
      if ((mover.sog ?? 0) < MIN_SOG_VS_STOPPED_KN) continue;
      atRisk.add(mover.mmsi);
    }
  }
  return atRisk;
}



/** Pairwise nav between two vessel fixes for tray card stacks. */
export type RelativeVesselNav = {
  distanceNm: number;
  /** True bearing from A → B [0, 360). */
  bearingAbDeg: number;
  /** True bearing from B → A [0, 360). */
  bearingBaDeg: number;
  /** Relative bearing from A's heading/COG to B (0=ahead, 90=stbd), or null. */
  relativeFromADeg: number | null;
  /** Relative bearing from B's heading/COG to A, or null. */
  relativeFromBDeg: number | null;
  cogA: number | null;
  cogB: number | null;
  sogA: number | null;
  sogB: number | null;
};

function normalizeCourse(deg: number | null | undefined): number | null {
  if (deg == null || !Number.isFinite(deg) || deg < 0 || deg >= 360) return null;
  return deg;
}

/** Relative bearing: angle from own course to the true bearing of the other vessel. */
export function relativeBearingDeg(ownCourseDeg: number, trueBearingDeg: number): number {
  return (((trueBearingDeg - ownCourseDeg) % 360) + 360) % 360;
}

/** Short label for a relative bearing (own-ship frame). */
export function describeRelativeBearing(relDeg: number): string {
  const d = ((relDeg % 360) + 360) % 360;
  if (d < 15 || d >= 345) return "ahead";
  if (d < 75) return "stbd bow";
  if (d < 105) return "stbd beam";
  if (d < 165) return "stbd quarter";
  if (d < 195) return "astern";
  if (d < 255) return "port quarter";
  if (d < 285) return "port beam";
  return "port bow";
}

export function formatCourseDeg(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return "—";
  return `${Math.round(((deg % 360) + 360) % 360).toString().padStart(3, "0")}°`;
}

export function relativeVesselNav(
  a: { lat: number; lon: number; sog?: number | null; cog?: number | null; heading?: number | null },
  b: { lat: number; lon: number; sog?: number | null; cog?: number | null; heading?: number | null },
): RelativeVesselNav {
  const bearingAb = bearingDeg(a.lat, a.lon, b.lat, b.lon);
  const bearingBa = bearingDeg(b.lat, b.lon, a.lat, a.lon);
  const courseA =
    a.heading != null && Number.isFinite(a.heading) && a.heading >= 0 && a.heading < 360
      ? a.heading
      : normalizeCourse(a.cog ?? null);
  const courseB =
    b.heading != null && Number.isFinite(b.heading) && b.heading >= 0 && b.heading < 360
      ? b.heading
      : normalizeCourse(b.cog ?? null);
  return {
    distanceNm: haversineNm(a.lat, a.lon, b.lat, b.lon),
    bearingAbDeg: bearingAb,
    bearingBaDeg: bearingBa,
    relativeFromADeg: courseA != null ? relativeBearingDeg(courseA, bearingAb) : null,
    relativeFromBDeg: courseB != null ? relativeBearingDeg(courseB, bearingBa) : null,
    cogA: normalizeCourse(a.cog ?? null),
    cogB: normalizeCourse(b.cog ?? null),
    sogA: a.sog ?? null,
    sogB: b.sog ?? null,
  };
}
