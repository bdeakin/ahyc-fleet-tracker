const NM_PER_DEG_LAT = 60;

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

export function approxMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineNm(lat1, lon1, lat2, lon2) * 1852;
}

export function seasonYearForTs(ts: number, seasonStart: string, seasonEnd: string): number | null {
  const d = new Date(ts);
  const year = d.getUTCFullYear();
  const [sm, sd] = seasonStart.split("-").map(Number);
  const [em, ed] = seasonEnd.split("-").map(Number);
  const start = Date.UTC(year, sm - 1, sd);
  const end = Date.UTC(year, em - 1, ed, 23, 59, 59);
  if (ts >= start && ts <= end) return year;
  return null;
}

export { NM_PER_DEG_LAT };
