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

/** Approximate polygons for NY/NJ harbor waters near AHYC. */
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
];

export function waterwayName(lat: number, lon: number): string {
  for (const w of HARBOR_WATERWAYS) {
    if (pointInRing(lon, lat, w.ring)) return w.name;
  }
  if (lat < 40.42 && lon > -74.0) return "Atlantic approaches";
  if (lat >= 40.42 && lat < 40.55 && lon <= -74.08) return "Raritan Bay approaches";
  return "NY/NJ harbor waters";
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

/** CPA thresholds: alert if closest approach < 0.25 nm within 12 minutes while closing. */
const DCPA_ALERT_NM = 0.25;
const TCPA_ALERT_MIN = 12;
const PROXIMITY_ALERT_NM = 0.12;

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

/**
 * Returns MMSIs that currently have a collision risk with at least one other vessel.
 * Uses CPA when both have SOG/COG; otherwise falls back to close proximity.
 */
export function collisionRiskMmsis(vessels: MotionFix[]): Set<string> {
  const atRisk = new Set<string>();
  const list = vessels.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const dNow = haversineNm(a.lat, a.lon, b.lat, b.lon);
      if (dNow > 3) continue; // far apart — skip

      const sogA = a.sog ?? 0;
      const sogB = b.sog ?? 0;
      const cogA = a.cog;
      const cogB = b.cog;
      const moving =
        sogA >= 0.5 &&
        sogB >= 0.5 &&
        cogA != null &&
        Number.isFinite(cogA) &&
        cogB != null &&
        Number.isFinite(cogB);

      if (!moving) {
        if (dNow <= PROXIMITY_ALERT_NM) {
          atRisk.add(a.mmsi);
          atRisk.add(b.mmsi);
        }
        continue;
      }

      const va = velNmPerMin(sogA, cogA as number);
      const vb = velNmPerMin(sogB, cogB as number);
      const dv = { n: vb.n - va.n, e: vb.e - va.e };
      const dp = relativeNm(a, b);
      const dv2 = dv.n * dv.n + dv.e * dv.e;
      if (dv2 < 1e-10) {
        if (dNow <= PROXIMITY_ALERT_NM) {
          atRisk.add(a.mmsi);
          atRisk.add(b.mmsi);
        }
        continue;
      }
      const tcpaMin = -(dp.n * dv.n + dp.e * dv.e) / dv2;
      if (tcpaMin < 0 || tcpaMin > TCPA_ALERT_MIN) continue;
      const cn = dp.n + dv.n * tcpaMin;
      const ce = dp.e + dv.e * tcpaMin;
      const dcpaNm = Math.sqrt(cn * cn + ce * ce);
      if (dcpaNm <= DCPA_ALERT_NM) {
        atRisk.add(a.mmsi);
        atRisk.add(b.mmsi);
      }
    }
  }
  return atRisk;
}
