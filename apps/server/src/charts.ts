import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ChartLayer } from "@ahyc/shared";
import {
  CARTO_ATTRIBUTION,
  CARTO_VOYAGER,
  ESRI_OCEAN_ATTRIBUTION,
  ESRI_OCEAN_BASE,
  ESRI_OCEAN_MAX_NATIVE_ZOOM,
  ESRI_OCEAN_REFERENCE,
  OPENSEAMAP_ATTRIBUTION,
  OPENSEAMAP_SEAMARK,
} from "@ahyc/shared";
import { paths } from "./config.js";

export function ensureChartDir() {
  fs.mkdirSync(paths.charts, { recursive: true });
}

export function listChartLayers(): ChartLayer[] {
  ensureChartDir();
  const layers: ChartLayer[] = [
    {
      id: "harbor-clean",
      kind: "xyz",
      label: "Harbor (sharp coast + buoys / lights)",
      // Sharp through marina zoom; OpenSeaMap adds buoys/beacons/lights without NOAA clutter.
      urls: [
        {
          url: CARTO_VOYAGER,
          subdomains: "abcd",
          maxNativeZoom: 20,
          maxZoom: 20,
        },
        {
          url: OPENSEAMAP_SEAMARK,
          maxNativeZoom: 18,
          maxZoom: 20,
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
        { url: OPENSEAMAP_SEAMARK, maxNativeZoom: 18, opacity: 0.95 },
      ],
      attribution: `${ESRI_OCEAN_ATTRIBUTION} | ${OPENSEAMAP_ATTRIBUTION}`,
      maxZoom: 18,
      maxNativeZoom: ESRI_OCEAN_MAX_NATIVE_ZOOM,
    },
    { id: "noaa-wms", kind: "noaa-wms", label: "NOAA Chart Display (full WMS)" },
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
