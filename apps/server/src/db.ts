import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { paths } from "./config.js";

export type Db = Database.Database;

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;
  fs.mkdirSync(path.dirname(paths.db), { recursive: true });
  db = new Database(paths.db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(database: Db) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS vessels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mmsi TEXT NOT NULL UNIQUE,
      sail_number TEXT,
      color TEXT NOT NULL DEFAULT '#1f6f8b',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS track_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mmsi TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      sog REAL,
      cog REAL,
      heading REAL,
      ts INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_track_mmsi_ts ON track_points(mmsi, ts);
    CREATE INDEX IF NOT EXISTS idx_track_ts ON track_points(ts);

    CREATE TABLE IF NOT EXISTS vessel_state (
      mmsi TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      sog REAL,
      cog REAL,
      heading REAL,
      ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      vessel_id TEXT NOT NULL,
      mmsi TEXT NOT NULL,
      season_year INTEGER NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      distance_nm REAL NOT NULL,
      max_range_nm REAL NOT NULL,
      point_count INTEGER NOT NULL,
      start_lat REAL NOT NULL,
      start_lon REAL NOT NULL,
      end_lat REAL NOT NULL,
      end_lon REAL NOT NULL,
      farthest_lat REAL NOT NULL,
      farthest_lon REAL NOT NULL,
      FOREIGN KEY(vessel_id) REFERENCES vessels(id)
    );

    CREATE INDEX IF NOT EXISTS idx_trips_vessel_season ON trips(vessel_id, season_year);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS traffic_names (
      mmsi TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}
