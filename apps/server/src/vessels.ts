import { randomUUID } from "node:crypto";
import type { Vessel } from "@ahyc/shared";
import type { Db } from "./db.js";

function rowToVessel(row: Record<string, unknown>): Vessel {
  return {
    id: String(row.id),
    name: String(row.name),
    mmsi: String(row.mmsi),
    sailNumber: row.sail_number == null ? null : String(row.sail_number),
    color: String(row.color),
    active: Boolean(row.active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listVessels(db: Db, activeOnly = false): Vessel[] {
  const sql = activeOnly
    ? "SELECT * FROM vessels WHERE active = 1 ORDER BY name"
    : "SELECT * FROM vessels ORDER BY name";
  return db.prepare(sql).all().map((r) => rowToVessel(r as Record<string, unknown>));
}

export function getVessel(db: Db, id: string): Vessel | null {
  const row = db.prepare("SELECT * FROM vessels WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToVessel(row) : null;
}

export function getVesselByMmsi(db: Db, mmsi: string): Vessel | null {
  const row = db.prepare("SELECT * FROM vessels WHERE mmsi = ?").get(mmsi) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToVessel(row) : null;
}

export function upsertVessel(
  db: Db,
  input: {
    id?: string;
    name: string;
    mmsi: string;
    sailNumber?: string | null;
    color?: string;
    active?: boolean;
  },
): Vessel {
  const now = new Date().toISOString();
  const id = input.id ?? randomUUID();
  const existing = input.id
    ? db.prepare("SELECT * FROM vessels WHERE id = ?").get(input.id)
    : null;

  if (existing) {
    db.prepare(
      `UPDATE vessels SET name = ?, mmsi = ?, sail_number = ?, color = ?, active = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.name,
      input.mmsi,
      input.sailNumber ?? null,
      input.color ?? "#1f6f8b",
      input.active === false ? 0 : 1,
      now,
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO vessels (id, name, mmsi, sail_number, color, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.mmsi,
      input.sailNumber ?? null,
      input.color ?? "#1f6f8b",
      input.active === false ? 0 : 1,
      now,
      now,
    );
  }
  return getVessel(db, id)!;
}

export function deleteVessel(db: Db, id: string): boolean {
  const info = db.prepare("DELETE FROM vessels WHERE id = ?").run(id);
  return info.changes > 0;
}

export function activeMmsis(db: Db): string[] {
  return listVessels(db, true).map((v) => v.mmsi);
}
