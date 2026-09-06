import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { getBootError } from "./bootState.js";
import { buildAdventure } from "./narrative.js";
import { listChartLayers, readMbtilesTile } from "./charts.js";
import { getDb } from "./db.js";
import { buildNoteworthy } from "./noteworthy.js";
import { ingestPosition, listLiveStates, positionsAt, pruneTrafficHistory, queryTracks, trackHistorySpan } from "./tracks.js";
import {
  getVesselProfile,
  scrapeAndStoreProfile,
  ensureVesselProfileQueued,
} from "./vesselProfiles.js";
import { getVesselPhoto, getVesselPhotoBytes } from "./vesselPhotos.js";
import { historicalTile } from "./historicalTiles.js";
import { config, isMountPoint, paths } from "./config.js";
import { availableSeasons, listAdventureOptions } from "./trips.js";
import {
  deleteVessel,
  getVessel,
  listVessels,
  upsertVessel,
} from "./vessels.js";
import {
  addToWatchlist,
  listWatchlist,
  removeFromWatchlist,
} from "./watchlist.js";
import type { AisIngestWorker } from "./aisWorker.js";
import type { AishubWorker } from "./aishubWorker.js";
import {
  deleteVesselFromSupabase,
  publicSupabaseConfig,
  pushVesselToSupabase,
  syncVesselsFromSupabase,
  verifyAdminAuth,
} from "./supabase.js";

/*
 * The storage diagnostics on /api/health walk every track point, which is fine on a laptop
 * and slow on a volume holding months of history. The platform's health check has a hard
 * timeout and restarts the container when it is missed, so the span is computed off to the
 * side and the endpoint answers from the last snapshot.
 */
const HEALTH_SPAN_TTL_MS = 60_000;
let healthSpan: ReturnType<typeof trackHistorySpan> | null = null;
let healthSpanAt = 0;
let healthSpanRunning = false;

function refreshHealthSpan(): void {
  if (healthSpanRunning || Date.now() - healthSpanAt < HEALTH_SPAN_TTL_MS) return;
  healthSpanRunning = true;
  setImmediate(() => {
    try {
      healthSpan = trackHistorySpan(getDb());
      healthSpanAt = Date.now();
    } catch (err) {
      console.warn("[health] track span failed", err);
    } finally {
      healthSpanRunning = false;
    }
  });
}

function memorySnapshot(): { rssMb: number; heapUsedMb: number; heapLimitMb: number } {
  const mb = (bytes: number) => Math.round(bytes / 1048576);
  const { rss, heapUsed, heapTotal } = process.memoryUsage();
  const cap = process.env.NODE_OPTIONS?.match(/--max-old-space-size=(\d+)/)?.[1];
  return {
    rssMb: mb(rss),
    heapUsedMb: mb(heapUsed),
    heapLimitMb: cap ? Number(cap) : mb(heapTotal),
  };
}

export async function registerRoutes(
  app: FastifyInstance,
  ais: AisIngestWorker,
  broadcast: (payload: unknown) => void,
  aishub: AishubWorker,
) {
  app.get("/api/health", async (_req, reply) => {
    const bootError = getBootError();
    if (!bootError) refreshHealthSpan();
    const span = healthSpan;
    const mounted = isMountPoint(config.dataDir);
    const railwayMount = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? null;
    const onRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME);
    if (bootError) reply.code(503);
    return {
      ok: !bootError,
      bootError,
      dataDir: config.dataDir,
      dbPath: paths.db,
      dbExists: fs.existsSync(paths.db),
      dataDirIsMount: mounted,
      railwayVolumeMountPath: railwayMount,
      /** False when SQLite is on the ephemeral container FS and will vanish on redeploy. */
      durableStorage: !onRailway || mounted || (railwayMount != null && config.dataDir === railwayMount),
      uptimeSec: Math.round(process.uptime()),
      /** Resident and heap size in MB, so a memory kill can be seen coming. */
      memory: memorySnapshot(),
      /** Null until the first background snapshot lands; never blocks the check. */
      trafficSpanMs: span?.trafficSpanMs ?? null,
      pointCount: span?.pointCount ?? null,
      trafficRetentionMs: span?.trafficRetentionMs ?? null,
    };
  });

  app.get("/api/ais/status", async () => ais.getStatus());

  app.get("/api/aishub/status", async () => aishub.getStatus());
  app.get("/api/tracks/history", async () => trackHistorySpan(getDb()));

  app.get("/api/watchlist", async () => listWatchlist(getDb()));

  app.post<{ Body: { mmsi?: string; name?: string | null; note?: string | null } }>(
    "/api/watchlist",
    async (req, reply) => {
      const auth = await verifyAdminAuth(req.headers.authorization);
      if (!auth.ok) return reply.code(401).send({ error: "unauthorized" });
      const mmsi = String(req.body?.mmsi ?? "").trim();
      if (!mmsi) return reply.code(400).send({ error: "mmsi_required" });
      return addToWatchlist(getDb(), mmsi, { name: req.body?.name, note: req.body?.note });
    },
  );

  app.delete<{ Params: { mmsi: string } }>("/api/watchlist/:mmsi", async (req, reply) => {
    const auth = await verifyAdminAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ error: "unauthorized" });
    const ok = removeFromWatchlist(getDb(), req.params.mmsi);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  /** Probe whether the presented Bearer token is a valid admin session. */
  app.get("/api/admin/session", async (req, reply) => {
    const auth = await verifyAdminAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ ok: false, via: null, email: null });
    return { ok: true, via: auth.via, email: auth.user?.email ?? null };
  });

  app.get("/api/config", async () => ({
    supabase: publicSupabaseConfig(),
    ais: {
      apiKeyConfigured: ais.getStatus().apiKeyConfigured,
      connected: ais.getStatus().connected,
      watchingMmsi: ais.getStatus().watchingMmsi,
      lastMessageAt: ais.getStatus().lastMessageAt,
      lastIngestAt: ais.getStatus().lastIngestAt,
      lastError: ais.getStatus().lastError,
      ingestTokenConfigured: Boolean(config.aisIngestToken),
      aishub: aishub.getStatus(),
    },
  }));

  app.post("/api/sync/vessels", async (req, reply) => {
    const auth = await verifyAdminAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ error: "unauthorized" });
    try {
      const result = await syncVesselsFromSupabase();
      ais.refreshSubscription();
      return result;
    } catch (err) {
      return reply.code(502).send({ error: String(err) });
    }
  });

  app.get("/api/vessels", async () => listVessels(getDb()));

  app.get<{ Params: { id: string } }>("/api/vessels/:id", async (req, reply) => {
    const vessel = getVessel(getDb(), req.params.id);
    if (!vessel) return reply.code(404).send({ error: "not_found" });
    return vessel;
  });

  app.post<{
    Body: {
      name: string;
      mmsi: string;
      sailNumber?: string;
      color?: string;
      active?: boolean;
    };
  }>("/api/vessels", async (req, reply) => {
    const auth = await verifyAdminAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ error: "unauthorized" });
    const vessel = upsertVessel(getDb(), req.body);
    try {
      await pushVesselToSupabase(vessel);
    } catch (err) {
      app.log.warn({ err }, "supabase push after create failed");
    }
    ais.refreshSubscription();
    return vessel;
  });

  app.put<{
    Params: { id: string };
    Body: {
      name: string;
      mmsi: string;
      sailNumber?: string;
      color?: string;
      active?: boolean;
    };
  }>("/api/vessels/:id", async (req, reply) => {
    const auth = await verifyAdminAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ error: "unauthorized" });
    const vessel = upsertVessel(getDb(), { id: req.params.id, ...req.body });
    try {
      await pushVesselToSupabase(vessel);
    } catch (err) {
      app.log.warn({ err }, "supabase push after update failed");
    }
    ais.refreshSubscription();
    return vessel;
  });

  app.delete<{ Params: { id: string } }>("/api/vessels/:id", async (req, reply) => {
    const auth = await verifyAdminAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ error: "unauthorized" });
    const ok = deleteVessel(getDb(), req.params.id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    try {
      await deleteVesselFromSupabase(req.params.id);
    } catch (err) {
      app.log.warn({ err }, "supabase delete failed");
    }
    ais.refreshSubscription();
    return { ok: true };
  });


  app.post<{
    Body: {
      positions?: Array<{
        mmsi: string;
        lat: number;
        lon: number;
        sog?: number | null;
        cog?: number | null;
        heading?: number | null;
        ts?: number;
        name?: string | null;
        shipType?: number | null;
      }>;
    };
  }>("/api/ais/ingest", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : String(req.headers["x-ais-ingest-token"] ?? "");
    if (!config.aisIngestToken || token !== config.aisIngestToken) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const positions = Array.isArray(req.body?.positions) ? req.body.positions : [];
    if (positions.length === 0) {
      return reply.code(400).send({ error: "positions_required" });
    }
    if (positions.length > 500) {
      return reply.code(413).send({ error: "batch_too_large" });
    }

    const db = getDb();
    let accepted = 0;
    let stored = 0;
    let rejected = 0;
    // One SQLite transaction per batch — without this, Pi radio batches were taking 6–8s on Railway.
    const lives: unknown[] = [];
    const runBatch = db.transaction((rows: typeof positions) => {
      for (const raw of rows) {
        const mmsi = String(raw.mmsi ?? "").trim();
        const lat = Number(raw.lat);
        const lon = Number(raw.lon);
        if (!mmsi || !Number.isFinite(lat) || !Number.isFinite(lon)) {
          rejected += 1;
          continue;
        }
        const result = ingestPosition(db, {
          mmsi,
          lat,
          lon,
          sog: raw.sog != null && Number.isFinite(Number(raw.sog)) ? Number(raw.sog) : null,
          cog: raw.cog != null && Number.isFinite(Number(raw.cog)) ? Number(raw.cog) : null,
          heading:
            raw.heading != null && Number.isFinite(Number(raw.heading)) && Number(raw.heading) !== 511
              ? Number(raw.heading)
              : null,
          ts: raw.ts != null && Number.isFinite(Number(raw.ts)) ? Number(raw.ts) : Date.now(),
          name: raw.name ?? null,
          shipType: raw.shipType != null && Number.isFinite(Number(raw.shipType)) ? Number(raw.shipType) : null,
          source: "radio",
        });
        if (!result.accepted || !result.live) {
          rejected += 1;
          continue;
        }
        accepted += 1;
        if (result.stored) stored += 1;
        lives.push(result.live);
      }
    });
    runBatch(positions);
    // Single notify after commit so the kiosk is not flooded with hundreds of WS messages.
    if (lives.length === 1) {
      broadcast({ type: "vessel", vessel: lives[0] });
    } else if (lives.length > 1) {
      broadcast({ type: "vessels", vessels: lives });
    }
    return { ok: true, accepted, stored, rejected };
  });

  app.post("/api/ais/prune", async (req, reply) => {
    const auth = await verifyAdminAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ error: "unauthorized" });
    return pruneTrafficHistory(getDb());
  });

  app.get<{
    Querystring: {
      minLat?: string;
      minLon?: string;
      maxLat?: string;
      maxLon?: string;
      includeRegistered?: string;
      pinned?: string;
    };
  }>("/api/live", async (req) => {
    const { minLat, minLon, maxLat, maxLon, includeRegistered, pinned } = req.query;
    const nums = [minLat, minLon, maxLat, maxLon].map((v) => (v != null ? Number(v) : NaN));
    const hasBbox = nums.every((n) => Number.isFinite(n));
    if (hasBbox) {
      const [south, west, north, east] = nums as [number, number, number, number];
      return listLiveStates(getDb(), {
        bbox: {
          minLat: Math.min(south, north),
          maxLat: Math.max(south, north),
          minLon: Math.min(west, east),
          maxLon: Math.max(west, east),
        },
        includeRegisteredOutside: includeRegistered !== "0",
        pinned: pinned ? pinned.split(",").map((m) => m.trim()).filter(Boolean) : undefined,
      });
    }
    return listLiveStates(getDb());
  });

  app.get<{ Params: { mmsi: string } }>("/api/vessels/profile/:mmsi", async (req, reply) => {
    const mmsi = String(req.params.mmsi ?? "").trim();
    if (!/^\d{9}$/.test(mmsi)) return reply.code(400).send({ error: "bad_mmsi" });
    const db = getDb();
    ensureVesselProfileQueued(db, mmsi);
    const profile = getVesselProfile(db, mmsi);
    if (!profile) return { mmsi, status: "pending" as const, name: null };
    return profile;
  });

  app.get<{ Params: { mmsi: string }; Querystring: { name?: string; refresh?: string } }>(
    "/api/vessels/photo/:mmsi",
    async (req, reply) => {
      const mmsi = String(req.params.mmsi ?? "").trim();
      if (!/^\d{7,9}$/.test(mmsi)) return reply.code(400).send({ error: "bad_mmsi" });
      const photo = await getVesselPhoto(getDb(), mmsi, {
        name: req.query.name ?? null,
        refresh: req.query.refresh === "1",
      });
      reply.header("Cache-Control", "public, max-age=900");
      return photo;
    },
  );

  app.get<{ Params: { id: string; z: string; x: string; y: string } }>(
    "/api/historical/:id/:z/:x/:y",
    async (req, reply) => {
      const z = Number(req.params.z);
      const x = Number(req.params.x);
      const y = Number(String(req.params.y).replace(/\.webp$/i, ""));
      if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0)) {
        return reply.code(400).send({ error: "bad_tile" });
      }
      const tile = await historicalTile(req.params.id, z, x, y);
      if (!tile) return reply.code(404).send({ error: "no_tile" });
      reply.header("Content-Type", "image/webp");
      reply.header("Cache-Control", "public, max-age=604800, immutable");
      return reply.send(tile);
    },
  );

  app.get<{ Params: { mmsi: string } }>("/api/vessels/photo/:mmsi/image", async (req, reply) => {
    const mmsi = String(req.params.mmsi ?? "").trim();
    if (!/^\d{7,9}$/.test(mmsi)) return reply.code(400).send({ error: "bad_mmsi" });
    const image = await getVesselPhotoBytes(getDb(), mmsi);
    if (!image) return reply.code(404).send({ error: "no_photo" });
    reply.header("Content-Type", image.contentType);
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send(image.body);
  });

  app.post<{ Params: { mmsi: string } }>("/api/vessels/profile/:mmsi/refresh", async (req, reply) => {
    const auth = await verifyAdminAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ error: "unauthorized" });
    const mmsi = String(req.params.mmsi ?? "").trim();
    if (!/^\d{9}$/.test(mmsi)) return reply.code(400).send({ error: "bad_mmsi" });
    return scrapeAndStoreProfile(getDb(), mmsi);
  });

  app.get<{
    Querystring: { mmsi?: string; mmsis?: string; from?: string; to?: string };
  }>("/api/tracks", async (req) => {
    const to = req.query.to ? Number(req.query.to) : Date.now();
    const from = req.query.from ? Number(req.query.from) : to - 24 * 3600_000;
    const mmsis =
      req.query.mmsis != null && req.query.mmsis.length > 0
        ? req.query.mmsis.split(",").map((m) => m.trim()).filter(Boolean)
        : undefined;
    return queryTracks(getDb(), { mmsi: req.query.mmsi, mmsis, from, to });
  });

  app.get<{ Querystring: { at?: string } }>("/api/tracks/replay", async (req) => {
    const at = req.query.at ? Number(req.query.at) : Date.now();
    return positionsAt(getDb(), at);
  });

  app.get<{ Querystring: { hours?: string } }>("/api/noteworthy", async (req) => {
    const hours = Math.min(72, Math.max(1, Number(req.query.hours ?? 24) || 24));
    return buildNoteworthy(getDb(), hours);
  });

  app.get("/api/charts", async () => listChartLayers());

  app.get<{
    Params: { id: string; z: string; x: string; y: string };
  }>("/api/charts/:id/:z/:x/:y", async (req, reply) => {
    const layers = listChartLayers();
    const layer = layers.find((l) => l.id === req.params.id && l.kind === "mbtiles");
    if (!layer || layer.kind !== "mbtiles") return reply.code(404).send("not found");
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y.replace(/\.png$/i, ""));
    const tile = readMbtilesTile(layer.path, z, x, y);
    if (!tile) return reply.code(204).send();
    const isPbf = tile[0] === 0x1f && tile[1] === 0x8b;
    reply.header("Content-Type", isPbf ? "application/x-protobuf" : "image/png");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(tile);
  });

  /** Club boats × years with stored AIS — populates Season Adventures dropdowns. */
  app.get("/api/adventures/options", async () => listAdventureOptions(getDb()));

  app.get<{ Params: { vesselId: string } }>(
    "/api/adventures/:vesselId/seasons",
    async (req, reply) => {
      const vessel = getVessel(getDb(), req.params.vesselId);
      if (!vessel) return reply.code(404).send({ error: "not_found" });
      return { vesselId: vessel.id, seasons: availableSeasons(getDb(), vessel.id) };
    },
  );

  app.get<{ Params: { vesselId: string; year: string } }>(
    "/api/adventures/:vesselId/:year",
    async (req, reply) => {
      const vessel = getVessel(getDb(), req.params.vesselId);
      if (!vessel) return reply.code(404).send({ error: "not_found" });
      const year = Number(req.params.year);
      if (!Number.isFinite(year)) return reply.code(400).send({ error: "bad_year" });
      return buildAdventure(getDb(), vessel, year, true);
    },
  );
}
