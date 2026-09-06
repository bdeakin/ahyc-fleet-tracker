import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OverlayOptions } from "sharp";
import {
  HISTORICAL_CHARTS,
  HISTORICAL_TILE_SIZE,
  historicalChartById,
  historicalMinNativeZoom,
  historicalNativeZoom,
  type HistoricalChart,
} from "@ahyc/shared";
import { config } from "./config.js";

/*
 * Historical scans are 12–20 megapixel JPEGs. Handed to Leaflet as one imageOverlay they
 * render until the browser is asked to paint them at ten thousand pixels or more across,
 * at which point Chrome quietly drops the image and the map shows bare paper. So the scans
 * are cut into a normal XYZ tile pyramid once, cached on the data volume, and served like
 * any other tile layer.
 *
 * The native level is rendered straight from the scan one tile-row at a time (bounded
 * memory, no full-resolution buffer), reprojecting the chart's linear lat/lon georeference
 * into Web Mercator. Shallower levels are then built by merging 2x2 tiles from the level
 * below, which is both cheap and exactly aligned with the tile grid.
 */

/*
 * Cutting a pyramid is the heaviest thing this server does: a few hundred megabytes of
 * libvips working set and every core it can get. On a small shared container that is enough
 * to starve health checks and trip the memory limit, so hold sharp to one thread and a small
 * cache. It is also loaded on demand rather than at boot — libvips costs ~30 MB resident
 * before it does any work, and a container with the seeded pyramids never cuts a tile.
 */
let sharpModule: Promise<typeof import("sharp").default> | null = null;

function loadSharp(): Promise<typeof import("sharp").default> {
  if (!sharpModule) {
    sharpModule = import("sharp").then(({ default: sharp }) => {
      sharp.concurrency(1);
      sharp.cache({ memory: 32, files: 8, items: 50 });
      return sharp;
    });
  }
  return sharpModule;
}

const TILE = HISTORICAL_TILE_SIZE;
const TILE_QUALITY = 82;
const PYRAMID_VERSION = 1;

type TileGrid = {
  z: number;
  /** Chart's top-left corner in world pixels at this zoom, rounded to whole pixels. */
  originX: number;
  originY: number;
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};

function worldSize(z: number): number {
  return TILE * 2 ** z;
}

function lonToWorldX(lon: number, z: number): number {
  return ((lon + 180) / 360) * worldSize(z);
}

function latToWorldY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  const merc = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  return (0.5 - merc / (2 * Math.PI)) * worldSize(z);
}

function worldYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / worldSize(z);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function gridFor(chart: HistoricalChart, z: number): TileGrid {
  const { south, west, north, east } = chart.bounds;
  const originX = Math.round(lonToWorldX(west, z));
  const originY = Math.round(latToWorldY(north, z));
  const width = Math.max(1, Math.round(lonToWorldX(east, z)) - originX);
  const height = Math.max(1, Math.round(latToWorldY(south, z)) - originY);
  return {
    z,
    originX,
    originY,
    width,
    height,
    xMin: Math.floor(originX / TILE),
    xMax: Math.floor((originX + width - 1) / TILE),
    yMin: Math.floor(originY / TILE),
    yMax: Math.floor((originY + height - 1) / TILE),
  };
}

/**
 * Tiles are read from two places: the pyramid cut into the image at build time, and the one
 * on the data volume. Shipping a pre-cut seed is what keeps a small container from ever
 * running libvips — a cut needs a few hundred megabytes of working set, which is enough to
 * push a modest instance past its memory limit while it is also serving the map.
 */
function seedRoot(): string | null {
  const seed = process.env.HISTORICAL_TILE_SEED_DIR;
  return seed && existsSync(seed) ? seed : null;
}

function writableRoot(): string {
  return path.join(config.dataDir, "historical-tiles");
}

function tileRoots(): string[] {
  const seed = seedRoot();
  return seed ? [writableRoot(), seed] : [writableRoot()];
}

function chartCacheDir(chart: HistoricalChart, root = writableRoot()): string {
  return path.join(root, chart.id);
}

function tilePath(chart: HistoricalChart, z: number, x: number, y: number, root = writableRoot()): string {
  return path.join(chartCacheDir(chart, root), String(z), String(x), `${y}.webp`);
}

function manifestPath(chart: HistoricalChart, root = writableRoot()): string {
  return path.join(chartCacheDir(chart, root), "manifest.json");
}

/** The scans live with the web app; in a container the built copy may be the only one. */
function sourceFile(chart: HistoricalChart): string | null {
  const name = path.basename(chart.imageUrl);
  const roots = [
    path.resolve(process.cwd(), "apps/web/public/historical-charts"),
    path.resolve(process.cwd(), "apps/web/dist/historical-charts"),
    path.resolve(process.cwd(), "../web/public/historical-charts"),
    path.resolve(process.cwd(), "../web/dist/historical-charts"),
  ];
  for (const root of roots) {
    const file = path.join(root, name);
    if (existsSync(file)) return file;
  }
  return null;
}

async function writeTile(file: string, rgba: Buffer, width: number, height: number): Promise<void> {
  const sharp = await loadSharp();
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .webp({ quality: TILE_QUALITY, alphaQuality: 60 })
    .toFile(file);
}

/** True when the band holds at least one non-transparent pixel worth writing out. */
function hasContent(rgba: Buffer, offset: number, length: number): boolean {
  for (let i = offset + 3; i < offset + length; i += 4) {
    if (rgba[i] !== 0) return true;
  }
  return false;
}

async function renderNativeLevel(chart: HistoricalChart, z: number): Promise<void> {
  const sharp = await loadSharp();
  const file = sourceFile(chart);
  if (!file) throw new Error(`missing scan for ${chart.id}`);
  const grid = gridFor(chart, z);
  const { south, north } = chart.bounds;
  const srcW = chart.sourceWidth;
  const srcH = chart.sourceHeight;
  const bandWidth = (grid.xMax - grid.xMin + 1) * TILE;

  for (let tileY = grid.yMin; tileY <= grid.yMax; tileY += 1) {
    const bandTop = tileY * TILE;
    // Which scan rows this band of world pixels needs, via the Mercator inverse.
    const rows: Array<{ src: number; frac: number } | null> = [];
    let srcMin = Number.POSITIVE_INFINITY;
    let srcMax = Number.NEGATIVE_INFINITY;
    for (let row = 0; row < TILE; row += 1) {
      const lat = worldYToLat(bandTop + row + 0.5, z);
      if (lat > north || lat < south) {
        rows.push(null);
        continue;
      }
      const exact = ((north - lat) / (north - south)) * (srcH - 1);
      const src = Math.max(0, Math.min(srcH - 2, Math.floor(exact)));
      rows.push({ src, frac: exact - src });
      srcMin = Math.min(srcMin, src);
      srcMax = Math.max(srcMax, src + 1);
    }
    if (!Number.isFinite(srcMin)) continue;

    const sliceHeight = srcMax - srcMin + 1;
    const { data: slice } = await sharp(file)
      .extract({ left: 0, top: srcMin, width: srcW, height: sliceHeight })
      // Horizontal scale is a plain linear stretch; leave the vertical resample to the row map.
      .resize({ width: grid.width, height: sliceHeight, fit: "fill", kernel: "lanczos3" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const band = Buffer.alloc(bandWidth * TILE * 4);
    const xOffset = grid.originX - grid.xMin * TILE;
    for (let row = 0; row < TILE; row += 1) {
      const map = rows[row];
      if (!map) continue;
      const top = (map.src - srcMin) * grid.width * 3;
      const bottom = top + grid.width * 3;
      const w = map.frac;
      let out = (row * bandWidth + xOffset) * 4;
      for (let col = 0; col < grid.width; col += 1) {
        const a = top + col * 3;
        const b = bottom + col * 3;
        band[out] = slice[a]! + (slice[b]! - slice[a]!) * w;
        band[out + 1] = slice[a + 1]! + (slice[b + 1]! - slice[a + 1]!) * w;
        band[out + 2] = slice[a + 2]! + (slice[b + 2]! - slice[a + 2]!) * w;
        band[out + 3] = 255;
        out += 4;
      }
    }

    for (let tileX = grid.xMin; tileX <= grid.xMax; tileX += 1) {
      const left = (tileX - grid.xMin) * TILE;
      const tile = Buffer.alloc(TILE * TILE * 4);
      for (let row = 0; row < TILE; row += 1) {
        band.copy(tile, row * TILE * 4, (row * bandWidth + left) * 4, (row * bandWidth + left + TILE) * 4);
      }
      if (!hasContent(tile, 0, tile.length)) continue;
      await writeTile(tilePath(chart, z, tileX, tileY), tile, TILE, TILE);
    }
  }
}

/** Each shallower tile is the four tiles below it, halved and stitched together. */
async function reduceLevel(chart: HistoricalChart, z: number): Promise<void> {
  const sharp = await loadSharp();
  const grid = gridFor(chart, z);
  for (let tileX = grid.xMin; tileX <= grid.xMax; tileX += 1) {
    for (let tileY = grid.yMin; tileY <= grid.yMax; tileY += 1) {
      const quadrants: OverlayOptions[] = [];
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const child = tilePath(chart, z + 1, tileX * 2 + dx, tileY * 2 + dy);
        if (!existsSync(child)) continue;
        const half = await sharp(child)
          .resize(TILE / 2, TILE / 2, { kernel: "lanczos3" })
          .png()
          .toBuffer();
        quadrants.push({ input: half, left: (dx * TILE) / 2, top: (dy * TILE) / 2 });
      }
      if (quadrants.length === 0) continue;
      const file = tilePath(chart, z, tileX, tileY);
      await mkdir(path.dirname(file), { recursive: true });
      await sharp({
        create: {
          width: TILE,
          height: TILE,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(quadrants)
        .webp({ quality: TILE_QUALITY, alphaQuality: 60 })
        .toFile(file);
    }
  }
}

type Manifest = {
  version: number;
  nativeZoom: number;
  minZoom: number;
  /** Georeference the tiles were cut for — a corrected bbox invalidates the pyramid. */
  bounds: string;
  builtAt: number;
};

function boundsKey(chart: HistoricalChart): string {
  const { south, west, north, east } = chart.bounds;
  return [south, west, north, east].map((n) => n.toFixed(5)).join(",");
}

async function readManifest(chart: HistoricalChart, root: string): Promise<Manifest | null> {
  try {
    const raw = await readFile(manifestPath(chart, root), "utf8");
    const parsed = JSON.parse(raw) as Manifest;
    if (parsed.version !== PYRAMID_VERSION) return null;
    return parsed.bounds === boundsKey(chart) ? parsed : null;
  } catch {
    return null;
  }
}

/** The root holding a pyramid cut for the chart's current georeference, if any. */
async function findPyramidRoot(chart: HistoricalChart): Promise<string | null> {
  for (const root of tileRoots()) {
    if (await readManifest(chart, root)) return root;
  }
  return null;
}

const building = new Map<string, Promise<string | null>>();

async function buildPyramid(chart: HistoricalChart): Promise<boolean> {
  const nativeZoom = historicalNativeZoom(chart);
  const minZoom = historicalMinNativeZoom(chart);
  const started = Date.now();
  console.log(`[historical] cutting tiles for ${chart.id} (z${minZoom}–z${nativeZoom})`);
  // Drop any earlier cut: tiles from a previous georeference would linger at their old
  // coordinates and get served alongside the new ones.
  await rm(chartCacheDir(chart), { recursive: true, force: true });
  await renderNativeLevel(chart, nativeZoom);
  for (let z = nativeZoom - 1; z >= minZoom; z -= 1) {
    await reduceLevel(chart, z);
  }
  const manifest: Manifest = {
    version: PYRAMID_VERSION,
    nativeZoom,
    minZoom,
    bounds: boundsKey(chart),
    builtAt: Date.now(),
  };
  await writeFile(manifestPath(chart), JSON.stringify(manifest), "utf8");
  console.log(`[historical] ${chart.id} tiled in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return true;
}

/** Build the pyramid if no root already has one; concurrent callers share one build. */
export async function ensurePyramid(chart: HistoricalChart): Promise<string | null> {
  const existing = await findPyramidRoot(chart);
  if (existing) return existing;
  const running = building.get(chart.id);
  if (running) return running;

  const job = buildPyramid(chart)
    .then(() => writableRoot())
    .catch((err) => {
      console.warn(`[historical] tiling failed for ${chart.id}:`, err);
      return null;
    })
    .finally(() => building.delete(chart.id));
  building.set(chart.id, job);
  return job;
}

export async function historicalTile(
  chartId: string,
  z: number,
  x: number,
  y: number,
): Promise<Buffer | null> {
  const chart = historicalChartById(chartId);
  if (!chart) return null;
  const root = await ensurePyramid(chart);
  if (!root) return null;
  try {
    return await readFile(tilePath(chart, z, x, y, root));
  } catch {
    return null;
  }
}

/**
 * Cut any missing pyramids in the background at boot so the first person to pick a chart
 * is not the one who waits for it. Sequential and lazy — cached pyramids cost nothing.
 */
export function startHistoricalTileWarmup(): void {
  if (process.env.HISTORICAL_TILE_WARMUP === "0") {
    console.log("[historical] tile warmup disabled (HISTORICAL_TILE_WARMUP=0)");
    return;
  }
  const delayMs = Number(process.env.HISTORICAL_TILE_WARMUP_DELAY_MS ?? 45_000);
  const timer = setTimeout(async () => {
    for (const chart of HISTORICAL_CHARTS) {
      try {
        if (await findPyramidRoot(chart)) continue;
        if (!sourceFile(chart)) {
          console.warn(`[historical] no scan on disk for ${chart.id}; skipping tiles`);
          continue;
        }
        await ensurePyramid(chart);
        // Breathe between charts so a request arriving mid-warmup is not queued behind
        // the next one starting immediately.
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      } catch (err) {
        console.warn(`[historical] warmup failed for ${chart.id}:`, err);
      }
    }
  }, Number.isFinite(delayMs) ? delayMs : 45_000);
  timer.unref?.();
}
