import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { AisIngestWorker } from "./aisWorker.js";
import { ensurePrimaryClubVessel } from "./bootstrap.js";
import { config, paths } from "./config.js";
import { getDb } from "./db.js";
import { registerRoutes } from "./routes.js";
import { listLiveStates } from "./tracks.js";

fs.mkdirSync(paths.charts, { recursive: true });
fs.mkdirSync(path.dirname(paths.db), { recursive: true });
getDb();
ensurePrimaryClubVessel();

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

app.get("/api/ws/live", { websocket: true }, (socket) => {
  liveClients.add(socket);
  socket.send(JSON.stringify({ type: "snapshot", vessels: listLiveStates(getDb()) }));
  socket.on("close", () => liveClients.delete(socket));
});

await registerRoutes(app, ais);

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
ais.start();

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
