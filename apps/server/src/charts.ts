import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ChartLayer } from "@ahyc/shared";
import {
  CARTO_ATTRIBUTION,
  cartoVoyagerUrl,
  ESRI_OCEAN_ATTRIBUTION,
  ESRI_OCEAN_BASE,
  ESRI_OCEAN_MAX_NATIVE_ZOOM,
  ESRI_OCEAN_REFERENCE,
  NOAA_CHART_ATTRIBUTION,
  NOAA_CHART_MIN_ZOOM,
  NOAA_CHART_WMS_LAYERS_ALL,
  NOAA_CHART_WMS_LAYERS_PAPER,
  NOAA_PAPER_CHART_PARAMS,
  OPENSEAMAP_ATTRIBUTION,
  OPENSEAMAP_SEAMARK,
} from "@ahyc/shared";
import { config, paths } from "./config.js";

export function ensureChartDir() {
  fs.mkdirSync(paths.charts, { recursive: true });
}

export function listChartLayers(): ChartLayer[] {
  ensureChartDir();
  const cartoUrl = cartoVoyagerUrl(config.cartoApiKey);
  const cartoTile: { url: string; subdomains?: string; maxNativeZoom: number; maxZoom: number } = {
    url: cartoUrl,
    maxNativeZoom: 20,
    maxZoom: 20,
  };
  // Public CDN uses `{s}` subdomains; keyed URL is a single host.
  if (!config.cartoApiKey.trim()) {
    cartoTile.subdomains = "abcd";
  }
  const layers: ChartLayer[] = [
    {
      id: "noaa-paper",
      kind: "noaa-wms",
      label: "NOAA chart (paper style · soundings in feet)",
      layers: NOAA_CHART_WMS_LAYERS_PAPER,
      params: NOAA_PAPER_CHART_PARAMS,
      transparent: false,
      attribution: NOAA_CHART_ATTRIBUTION,
      maxZoom: 18,
      minZoom: NOAA_CHART_MIN_ZOOM,
    },
    {
      id: "harbor-clean",
      kind: "xyz",
      label: "Harbor (sharp coast + buoys / lights)",
      // Sharp through marina zoom; OpenSeaMap adds buoys/beacons/lights without NOAA clutter.
      urls: [
        cartoTile,
        {
          url: OPENSEAMAP_SEAMARK,
          maxNativeZoom: 18,
          maxZoom: 20,
          // Seamark tiles bake in their labels, so they only stay readable close in.
          minZoom: 14,
          opacity: 0.95,
        },
      ],
      attribution: `${CARTO_ATTRIBUTION} | ${OPENSEAMAP_ATTRIBUTION}`,
      maxZoom: 20,
    },
    {
      id: "ocean-simple",
      kind: "xyz",
      label: "Regional ocean (overview depths)",
      // GEBCO-class shading — good for bay/region overview, soft past ~z13.
      urls: [
        { url: ESRI_OCEAN_BASE, maxNativeZoom: ESRI_OCEAN_MAX_NATIVE_ZOOM },
        { url: ESRI_OCEAN_REFERENCE, maxNativeZoom: ESRI_OCEAN_MAX_NATIVE_ZOOM },
      ],
      attribution: ESRI_OCEAN_ATTRIBUTION,
      maxZoom: 18,
      maxNativeZoom: ESRI_OCEAN_MAX_NATIVE_ZOOM,
    },
    {
      id: "ocean-seamarks",
      kind: "xyz",
      label: "Regional ocean + buoys / lights",
      urls: [
        { url: ESRI_OCEAN_BASE, maxNativeZoom: ESRI_OCEAN_MAX_NATIVE_ZOOM },
        { url: ESRI_OCEAN_REFERENCE, maxNativeZoom: ESRI_OCEAN_MAX_NATIVE_ZOOM },
        { url: OPENSEAMAP_SEAMARK, maxNativeZoom: 18, minZoom: 14, opacity: 0.95 },
      ],
      attribution: `${ESRI_OCEAN_ATTRIBUTION} | ${OPENSEAMAP_ATTRIBUTION}`,
      maxZoom: 18,
      maxNativeZoom: ESRI_OCEAN_MAX_NATIVE_ZOOM,
    },
    {
      id: "noaa-wms",
      kind: "noaa-wms",
      label: "NOAA chart (all detail · ENC display)",
      layers: NOAA_CHART_WMS_LAYERS_ALL,
      transparent: false,
      attribution: NOAA_CHART_ATTRIBUTION,
      maxZoom: 18,
      minZoom: NOAA_CHART_MIN_ZOOM,
    },
  ];
  for (const file of fs.readdirSync(paths.charts)) {
    if (!file.endsWith(".mbtiles")) continue;
    layers.push({
      id: file.replace(/\.mbtiles$/i, ""),
      kind: "mbtiles",
      label: file.replace(/\.mbtiles$/i, "").replace(/[-_]/g, " "),
      path: path.join(paths.charts, file),
    });
  }
  return layers;
}

export function readMbtilesTile(
  mbtilesPath: string,
  z: number,
  x: number,
  y: number,
): Buffer | null {
  if (!fs.existsSync(mbtilesPath)) return null;
  const db = new Database(mbtilesPath, { readonly: true, fileMustExist: true });
  try {
    // MBTiles store TMS y.
    const tmsY = 2 ** z - 1 - y;
    const row = db
      .prepare("SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?")
      .get(z, x, tmsY) as { tile_data: Buffer } | undefined;
    return row?.tile_data ?? null;
  } finally {
    db.close();
  }
}
