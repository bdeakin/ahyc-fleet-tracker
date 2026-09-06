import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { AisIngestWorker } from "./aisWorker.js";
import { AishubWorker } from "./aishubWorker.js";
import { ensurePrimaryClubVessel } from "./bootstrap.js";
import { config, isMountPoint, paths } from "./config.js";
import { getDb } from "./db.js";
import { registerRoutes } from "./routes.js";
import { listLiveStates, pruneTrafficHistory } from "./tracks.js";
import { startVesselProfileWorker } from "./vesselProfiles.js";

fs.mkdirSync(paths.charts, { recursive: true });
fs.mkdirSync(path.dirname(paths.db), { recursive: true });
getDb();
ensurePrimaryClubVessel();
startVesselProfileWorker(getDb);

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(websocket);

const liveClients = new Set<{ send: (data: string) => void }>();

function broadcast(payload: unknown) {
  const data = JSON.stringify(payload);
  for (const client of liveClients) {
    try {
      client.send(data);
    } catch {
      /* ignore */
    }
  }
}

const ais = new AisIngestWorker(broadcast);
const aishub = new AishubWorker(broadcast);

app.get("/api/ws/live", { websocket: true }, (socket) => {
  liveClients.add(socket);
  socket.send(JSON.stringify({ type: "snapshot", vessels: listLiveStates(getDb()) }));
  socket.on("close", () => liveClients.delete(socket));
});

await registerRoutes(app, ais, broadcast, aishub);

const webDist = path.resolve(config.root, "apps/web/dist");
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: "/",
    wildcard: false,
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });
}

await app.listen({ port: config.port, host: config.host });
console.log(`[ahyc] listening on http://${config.host}:${config.port}`);
{
  const mounted = isMountPoint(config.dataDir);
  const railwayMount = process.env.RAILWAY_VOLUME_MOUNT_PATH ?? null;
  console.log(
    `[ahyc] dataDir=${config.dataDir} db=${paths.db} mount=${mounted} railwayVolume=${railwayMount ?? "none"}`,
  );
  if (
    (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME) &&
    !mounted &&
    config.dataDir !== railwayMount
  ) {
    console.warn(
      "[ahyc] WARNING: SQLite is not on a Railway volume mount — track history will be wiped on redeploy. " +
        "Attach a volume with mount path /data and set DATA_DIR=/data (or rely on RAILWAY_VOLUME_MOUNT_PATH).",
    );
  }
}
ais.start();
aishub.start();

// Drop non-registered harbor traffic older than TRAFFIC_RETENTION_HOURS (default 24h).
function runTrafficPrune() {
  try {
    const result = pruneTrafficHistory(getDb());
    if (result.points || result.live) {
      console.log(`[retention] pruned traffic points=${result.points} live=${result.live}`);
    }
  } catch (err) {
    console.warn("[retention] prune failed", err);
  }
}
runTrafficPrune();
setInterval(runTrafficPrune, 15 * 60_000);


// Pull club vessel registry from Supabase when configured (survives Pi rebuilds).
async function pullRegistry() {
  try {
    const { syncVesselsFromSupabase, supabaseConfigured } = await import("./supabase.js");
    if (!supabaseConfigured()) return;
    const result = await syncVesselsFromSupabase();
    if (result.synced > 0) {
      console.log(`[supabase] synced ${result.synced} vessel(s)`);
      ais.refreshSubscription();
    }
  } catch (err) {
    console.warn("[supabase] sync failed", err);
  }
}
void pullRegistry();
setInterval(() => void pullRegistry(), 5 * 60_000);
