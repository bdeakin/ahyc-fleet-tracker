import { getDb } from "./db.js";
import { listVessels, upsertVessel } from "./vessels.js";
import { addToWatchlist } from "./watchlist.js";

/** Ensure LIFE AT SEA exists on first boot (empty Railway volume / fresh Pi). */
export function ensurePrimaryClubVessel(): void {
  const db = getDb();
  const active = listVessels(db, true);
  if (active.some((v) => v.mmsi === "338357109")) return;

  upsertVessel(db, {
    id: "life-at-sea",
    name: "LIFE AT SEA",
    mmsi: "338357109",
    color: "#c45c26",
    active: true,
  });
  console.log("[bootstrap] registered primary club vessel LIFE AT SEA (338357109)");
}

/**
 * Vessels the club asked to keep history for. Seeded rather than added by hand because the
 * watch list lives in SQLite on the volume, and the add button needs an admin session.
 * Each seed is recorded in `settings`, so removing one in the app makes it stay removed.
 */
const SEED_WATCHLIST: Array<{ mmsi: string; name: string; note: string }> = [
  { mmsi: "367124840", name: "AMERICAN PRINCESS", note: "Local passenger vessel" },
];

export function ensureSeedWatchlist(): void {
  const db = getDb();
  for (const entry of SEED_WATCHLIST) {
    const key = `seeded_watch_${entry.mmsi}`;
    const seeded = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    if (seeded) continue;
    addToWatchlist(db, entry.mmsi, { name: entry.name, note: entry.note });
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(key, String(Date.now()));
    console.log(`[bootstrap] watch list seeded with ${entry.name} (${entry.mmsi})`);
  }
}
