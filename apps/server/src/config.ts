import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(root, ".env") });

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  root,
  port: num("PORT", 8787),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: path.resolve(root, process.env.DATA_DIR ?? "./data"),
  aisstreamApiKey: process.env.AISSTREAM_API_KEY ?? "",
  /** Shared secret for POST /api/ais/ingest (Pi AIS Dispatcher forwarder). */
  aisIngestToken: process.env.AIS_INGEST_TOKEN ?? "",
  /** AISHub username (Railway: AISHUB_USERNAME). Enables daily NE bbox + MMSI watch. */
  aishubUsername: process.env.AISHUB_USERNAME ?? "",
  /** Min ms between any AISHub HTTP calls (API hard limit: 1/min). */
  aishubMinIntervalMs: Math.max(60_000, num("AISHUB_MIN_INTERVAL_SEC", 60) * 1000),
  /** How often to run the Northeast bbox sweep when username is set. */
  aishubBboxIntervalMs: num("AISHUB_BBOX_INTERVAL_HOURS", 24) * 3600_000,
  /** Perimeter band (degrees) inside NORTHEAST_BBOX that starts MMSI watching. */
  aishubPerimeterDeg: num("AISHUB_PERIMETER_DEG", 0.5),
  /** How long to keep non-registered (traffic) track points / live state. */
  trafficRetentionMs: num("TRAFFIC_RETENTION_HOURS", 24) * 3600_000,
  /** Min interval between stored track points per MMSI (Dispatcher + AISStream). */
  trackMinIntervalMs: num("TRACK_MIN_INTERVAL_SEC", 60) * 1000,
  homeLat: num("HOME_LAT", 40.4185),
  homeLon: num("HOME_LON", -74.0385),
  homeRadiusNm: num("HOME_RADIUS_NM", 0.4),
  seasonStart: process.env.SEASON_START ?? "04-01",
  seasonEnd: process.env.SEASON_END ?? "10-31",
  retentionKeepOffseason: (process.env.RETENTION_KEEP_OFFSEASON ?? "true") === "true",
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  localAdminToken: process.env.LOCAL_ADMIN_TOKEN ?? "dev-admin-token",
};

export const paths = {
  db: path.join(config.dataDir, "db", "ahyc.sqlite"),
  charts: path.join(config.dataDir, "charts"),
};
