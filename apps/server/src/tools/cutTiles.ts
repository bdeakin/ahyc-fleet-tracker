import { HISTORICAL_CHARTS } from "@ahyc/shared";
import { config } from "../config.js";
import { ensurePyramid } from "../historicalTiles.js";

/*
 * Build-time tile cutter. Docker runs this so the image ships with every historical chart
 * already tiled: cutting a pyramid costs a few hundred megabytes of libvips working set,
 * and doing that inside a small production container is what tips it over its memory limit.
 * A missing scan is a warning, not a failure — the server can still cut that one lazily.
 */
async function main(): Promise<void> {
  console.log(`[cut-tiles] writing pyramids under ${config.dataDir}`);
  for (const chart of HISTORICAL_CHARTS) {
    const root = await ensurePyramid(chart);
    if (!root) console.warn(`[cut-tiles] no tiles produced for ${chart.id}`);
  }
}

main().catch((err) => {
  console.warn("[cut-tiles] failed:", err);
});
