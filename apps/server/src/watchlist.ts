import type { Db } from "./db.js";

export type WatchedVessel = {
  mmsi: string;
  name: string | null;
  addedAt: number;
  note: string | null;
};

function normalizeMmsi(mmsi: string): string {
  return String(mmsi).trim();
}

export function listWatchlist(db: Db): WatchedVessel[] {
  return (
    db
      .prepare(
        `SELECT mmsi, name, added_at AS addedAt, note
         FROM watched_vessels
         ORDER BY added_at DESC`,
      )
      .all() as Array<{ mmsi: string; name: string | null; addedAt: number; note: string | null }>
  ).map((row) => ({
    mmsi: row.mmsi,
    name: row.name,
    addedAt: row.addedAt,
    note: row.note,
  }));
}

export function watchedMmsis(db: Db): string[] {
  return (db.prepare("SELECT mmsi FROM watched_vessels").all() as Array<{ mmsi: string }>).map(
    (r) => r.mmsi,
  );
}

export function isWatched(db: Db, mmsi: string): boolean {
  const key = normalizeMmsi(mmsi);
  const row = db.prepare("SELECT 1 AS ok FROM watched_vessels WHERE mmsi = ?").get(key) as
    | { ok: number }
    | undefined;
  if (row) return true;
  const padded = key.padStart(9, "0");
  if (padded === key) return false;
  const alt = db.prepare("SELECT 1 AS ok FROM watched_vessels WHERE mmsi = ?").get(padded) as
    | { ok: number }
    | undefined;
  return Boolean(alt);
}

export function addToWatchlist(
  db: Db,
  mmsi: string,
  opts?: { name?: string | null; note?: string | null },
): WatchedVessel {
  const key = normalizeMmsi(mmsi);
  if (!key) throw new Error("mmsi required");
  const now = Date.now();
  const name = opts?.name?.trim() ? opts.name.trim().slice(0, 64) : null;
  const note = opts?.note?.trim() ? opts.note.trim().slice(0, 200) : null;
  db.prepare(
    `INSERT INTO watched_vessels (mmsi, name, added_at, note)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(mmsi) DO UPDATE SET
       name = COALESCE(excluded.name, watched_vessels.name),
       note = COALESCE(excluded.note, watched_vessels.note)`,
  ).run(key, name, now, note);
  const row = db
    .prepare(
      `SELECT mmsi, name, added_at AS addedAt, note FROM watched_vessels WHERE mmsi = ?`,
    )
    .get(key) as { mmsi: string; name: string | null; addedAt: number; note: string | null };
  return {
    mmsi: row.mmsi,
    name: row.name,
    addedAt: row.addedAt,
    note: row.note,
  };
}

export function removeFromWatchlist(db: Db, mmsi: string): boolean {
  const key = normalizeMmsi(mmsi);
  const result = db.prepare("DELETE FROM watched_vessels WHERE mmsi = ?").run(key);
  if (result.changes > 0) return true;
  const padded = key.padStart(9, "0");
  if (padded !== key) {
    return db.prepare("DELETE FROM watched_vessels WHERE mmsi = ?").run(padded).changes > 0;
  }
  return false;
}
