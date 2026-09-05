import type { FastifyInstance } from "fastify";
import { buildAdventure } from "./narrative.js";
import { listChartLayers, readMbtilesTile } from "./charts.js";
import { getDb } from "./db.js";
import { ingestPosition, listLiveStates, positionsAt, pruneTrafficHistory, queryTracks } from "./tracks.js";
import {
  getVesselProfile,
  scrapeAndStoreProfile,
  ensureVesselProfileQueued,
} from "./vesselProfiles.js";
import { config } from "./config.js";
import { availableSeasons } from "./trips.js";
import {
  deleteVessel,
  getVessel,
  listVessels,
  upsertVessel,
} from "./vessels.js";
import type { AisIngestWorker } from "./aisWorker.js";
import type { AishubWorker } from "./aishubWorker.js";
import {
  deleteVesselFromSupabase,
  publicSupabaseConfig,
  pushVesselToSupabase,
  syncVesselsFromSupabase,
  verifyAdminAuth,
} from "./supabase.js";

export async function registerRoutes(
  app: FastifyInstance,
  ais: AisIngestWorker,
  broadcast: (payload: unknown) => void,
  aishub: AishubWorker,
) {
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/ais/status", async () => ais.getStatus());

  app.get("/api/aishub/status", async () => aishub.getStatus());

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
    for (const raw of positions) {
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
      });
      if (!result.accepted || !result.live) {
        rejected += 1;
        continue;
      }
      accepted += 1;
      if (result.stored) stored += 1;
      broadcast({ type: "vessel", vessel: result.live });
    }
    return { ok: true, accepted, stored, rejected };
  });

  app.post("/api/ais/prune", async (req, reply) => {
    const auth = await verifyAdminAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ error: "unauthorized" });
    return pruneTrafficHistory(getDb());
  });

  app.get("/api/live", async () => listLiveStates(getDb()));

  app.get<{ Params: { mmsi: string } }>("/api/vessels/profile/:mmsi", async (req, reply) => {
    const mmsi = String(req.params.mmsi ?? "").trim();
    if (!/^\d{9}$/.test(mmsi)) return reply.code(400).send({ error: "bad_mmsi" });
    const db = getDb();
    ensureVesselProfileQueued(db, mmsi);
    const profile = getVesselProfile(db, mmsi);
    if (!profile) return { mmsi, status: "pending" as const, name: null };
    return profile;
  });

  app.post<{ Params: { mmsi: string } }>("/api/vessels/profile/:mmsi/refresh", async (req, reply) => {
    const auth = await verifyAdminAuth(req.headers.authorization);
    if (!auth.ok) return reply.code(401).send({ error: "unauthorized" });
    const mmsi = String(req.params.mmsi ?? "").trim();
    if (!/^\d{9}$/.test(mmsi)) return reply.code(400).send({ error: "bad_mmsi" });
    return scrapeAndStoreProfile(getDb(), mmsi);
  });

  app.get<{
    Querystring: { mmsi?: string; from?: string; to?: string };
  }>("/api/tracks", async (req) => {
    const to = req.query.to ? Number(req.query.to) : Date.now();
    const from = req.query.from ? Number(req.query.from) : to - 24 * 3600_000;
    return queryTracks(getDb(), { mmsi: req.query.mmsi, from, to });
  });

  app.get<{ Querystring: { at?: string } }>("/api/tracks/replay", async (req) => {
    const at = req.query.at ? Number(req.query.at) : Date.now();
    return positionsAt(getDb(), at);
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
