/** Geographic bounding box in WGS84 degrees. */
export type GeoBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/**
 * A georeferenced historical chart that can replace the modern basemap when the
 * kiosk viewport overlaps its coverage.
 */
export type HistoricalChart = {
  id: string;
  /** Short label for the dropdown. */
  label: string;
  /** Full title for attribution / help. */
  title: string;
  year: number;
  /** JPEG/PNG URL (served from `/historical-charts/…` or remote public-domain host). */
  imageUrl: string;
  /**
   * Approximate georeference of the chart’s geographic content (not paper margins).
   * Used both for viewport detection and as the Leaflet imageOverlay corners.
   */
  bounds: GeoBounds;
  attribution: string;
  /** Optional minimum map zoom before offering this chart. */
  minZoom?: number;
  /**
   * Optional maximum map zoom for offering this chart.
   * Use for wide regional sheets so they don’t crowd the harbor-scale menu.
   */
  maxZoom?: number;
};

/**
 * Catalog of historical charts for the AHYC kiosk.
 * Bounds are approximate georeferences for overlay — not survey-grade GCPs.
 * Images are public-domain scans hosted under `/historical-charts/`.
 */
export const HISTORICAL_CHARTS: HistoricalChart[] = [
  {
    id: "dudley-america-1646",
    label: "1646 Dudley — Eastern seaboard",
    title: "Carta seconda generale del'America (Robert Dudley, Florence, 1646)",
    year: 1646,
    imageUrl: "/historical-charts/eastern-seaboard-1646.jpg",
    // Arcano del Mare general chart of eastern North America:
    // Newfoundland / Gulf of St. Lawrence → Florida; Atlantic approaches.
    bounds: {
      south: 24,
      west: -82,
      north: 50,
      east: -52,
    },
    attribution:
      "1646 Robert Dudley, Carta seconda generale del'America (NYPL via Wikimedia Commons) — public domain",
    minZoom: 4,
    maxZoom: 8,
  },
  {
    id: "hudson-entrance-1776",
    label: "1776 Entrance of Hudson's River",
    title:
      "Chart of the entrance of Hudson's River, from Sandy Hook to New York (Sayer & Bennett, 1 June 1776)",
    year: 1776,
    imageUrl: "/historical-charts/nyc-harbor-1776.jpg",
    // Yale catalog coordinates: W 74°21′–W 73°48′ / N 40°50′–N 40°17′
    bounds: {
      south: 40.28,
      west: -74.35,
      north: 40.84,
      east: -73.8,
    },
    attribution:
      "1776 Chart of the entrance of Hudson's River (Sayer & Bennett / NYPL via Wikimedia Commons) — public domain",
    minZoom: 9,
  },
  {
    id: "nyc-harbor-1845",
    label: "1845 NY Bay & Harbor (environs)",
    title: "Map of New-York Bay and Harbor and the Environs (U.S. Coast Survey, 1845)",
    year: 1845,
    imageUrl: "/historical-charts/nyc-harbor-1845.jpg",
    bounds: {
      south: 40.35,
      west: -74.35,
      north: 40.92,
      east: -73.75,
    },
    attribution:
      "1845 U.S. Coast Survey — Map of New-York Bay and Harbor and the Environs (NOAA / public domain)",
    minZoom: 9,
  },
  {
    id: "nyc-harbor-1895",
    label: "1895 NY Bay & Harbor",
    title: "New York Bay and Harbor (U.S. Coast Survey–based chart, c. 1895)",
    year: 1895,
    imageUrl: "/historical-charts/nyc-harbor-1895.jpg",
    bounds: {
      south: 40.4,
      west: -74.3,
      north: 40.9,
      east: -73.82,
    },
    attribution:
      "c. 1895 U.S. Coast Survey New York Bay and Harbor (Geographicus scan of public-domain survey)",
    minZoom: 10,
  },
  {
    id: "nyc-harbor-1910",
    label: "1910 NY Bay & Harbor survey",
    title: "Coast Chart No. 120 — New York Bay and Harbor (U.S. Coast Survey, 1910)",
    year: 1910,
    imageUrl: "/historical-charts/nyc-harbor-1910.jpg",
    bounds: {
      south: 40.42,
      west: -74.27,
      north: 40.9,
      east: -73.86,
    },
    attribution:
      "1910 U.S. Coast & Geodetic Survey Coast Chart No. 120 (Geographicus / Wikimedia Commons) — public domain",
    minZoom: 10,
  },
];

export function boundsIntersect(a: GeoBounds, b: GeoBounds): boolean {
  return !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north);
}

/** Charts whose coverage overlaps the current map viewport (and meet zoom gates). */
export function historicalChartsForView(
  view: GeoBounds,
  zoom: number,
  catalog: HistoricalChart[] = HISTORICAL_CHARTS,
): HistoricalChart[] {
  return catalog
    .filter((chart) => {
      if (chart.minZoom != null && zoom < chart.minZoom) return false;
      if (chart.maxZoom != null && zoom > chart.maxZoom) return false;
      return boundsIntersect(view, chart.bounds);
    })
    .sort((a, b) => a.year - b.year);
}

export function historicalChartById(
  id: string | null | undefined,
  catalog: HistoricalChart[] = HISTORICAL_CHARTS,
): HistoricalChart | null {
  if (!id) return null;
  return catalog.find((c) => c.id === id) ?? null;
}
