import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ChartLayer } from "@ahyc/shared";
import { paths } from "./config.js";

export function ensureChartDir() {
  fs.mkdirSync(paths.charts, { recursive: true });
}

export function listChartLayers(): ChartLayer[] {
  ensureChartDir();
  const layers: ChartLayer[] = [
    { id: "noaa-wms", kind: "noaa-wms", label: "NOAA Chart Display (live WMS)" },
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
    // MBTiles uses TMS y; convert from XYZ
    const tmsY = (1 << z) - 1 - y;
    const row = db
      .prepare("SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?")
      .get(z, x, tmsY) as { tile_data: Buffer } | undefined;
    return row?.tile_data ?? null;
  } finally {
    db.close();
  }
}
