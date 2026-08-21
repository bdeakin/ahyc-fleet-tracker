import WebSocket from "ws";
import { DEFAULT_BBOX } from "@ahyc/shared";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { ingestPosition } from "./tracks.js";
import { activeMmsis } from "./vessels.js";

export type LiveBroadcaster = (payload: unknown) => void;

export type AisStatus = {
  apiKeyConfigured: boolean;
  connected: boolean;
  watchingMmsi: string[];
  lastMessageAt: number | null;
  lastIngestAt: number | null;
  lastError: string | null;
  messageCount: number;
  ingestCount: number;
};

const POSITION_KEYS = [
  "PositionReport",
  "StandardClassBPositionReport",
  "ExtendedClassBPositionReport",
] as const;

export class AisIngestWorker {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connected = false;
  private lastMessageAt: number | null = null;
  private lastIngestAt: number | null = null;
  private lastError: string | null = null;
  private messageCount = 0;
  private ingestCount = 0;

  constructor(private broadcast: LiveBroadcaster) {}

  getStatus(): AisStatus {
    return {
      apiKeyConfigured: Boolean(config.aisstreamApiKey),
      connected: this.connected,
      watchingMmsi: activeMmsis(getDb()),
      lastMessageAt: this.lastMessageAt,
      lastIngestAt: this.lastIngestAt,
      lastError: this.lastError,
      messageCount: this.messageCount,
      ingestCount: this.ingestCount,
    };
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  /** Call when vessel registry changes so FiltersShipMMSI stays current. */
  refreshSubscription() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sendSubscribe();
  }

  private connect() {
    if (this.stopped) return;
    if (!config.aisstreamApiKey) {
      this.lastError = "AISSTREAM_API_KEY not set";
      console.warn("[ais] AISSTREAM_API_KEY not set — ingest disabled (seed/demo data still works)");
      return;
    }

    const mmsis = activeMmsis(getDb());
    if (mmsis.length === 0) {
      this.lastError = "No active club vessels registered";
      console.warn("[ais] No active club vessels registered — waiting before connect");
      this.reconnectTimer = setTimeout(() => this.connect(), 15_000);
      return;
    }

    console.log(`[ais] Connecting with ${mmsis.length} club MMSI filter(s): ${mmsis.join(",")}`);
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    this.ws = ws;

    ws.on("open", () => {
      this.connected = true;
      this.lastError = null;
      console.log("[ais] websocket open; sending subscription");
      this.sendSubscribe();
    });

    ws.on("message", (data) => {
      this.messageCount += 1;
      this.lastMessageAt = Date.now();
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (typeof msg.error === "string") {
          this.lastError = msg.error;
          console.warn("[ais] server error:", msg.error);
          return;
        }
        if (typeof msg.Error === "string") {
          this.lastError = msg.Error;
          console.warn("[ais] server Error:", msg.Error);
          return;
        }
        this.handleMessage(msg);
      } catch (err) {
        console.warn("[ais] bad message", err);
      }
    });

    ws.on("close", (code, reason) => {
      this.connected = false;
      const why = reason?.toString() || `code ${code}`;
      this.lastError = `socket closed (${why})`;
      console.warn("[ais] socket closed; reconnecting", why);
      this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      this.lastError = err.message;
      console.warn("[ais] socket error", err.message);
    });
  }

  private sendSubscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const mmsis = activeMmsis(getDb());
    // Do not narrow FilterMessageTypes — sailing vessels often use Class B extended reports.
    const subscription = {
      APIKey: config.aisstreamApiKey,
      BoundingBoxes: [
        [
          [DEFAULT_BBOX.minLat, DEFAULT_BBOX.minLon],
          [DEFAULT_BBOX.maxLat, DEFAULT_BBOX.maxLon],
        ],
      ],
      FiltersShipMMSI: mmsis,
    };
    this.ws.send(JSON.stringify(subscription));
    console.log(
      `[ais] subscribed bbox=${DEFAULT_BBOX.minLat},${DEFAULT_BBOX.minLon}→${DEFAULT_BBOX.maxLat},${DEFAULT_BBOX.maxLon} mmsi=${mmsis.join(",")}`,
    );
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 5_000);
  }

  private handleMessage(msg: Record<string, unknown>) {
    const meta = msg.MetaData as Record<string, unknown> | undefined;
    const message = msg.Message as Record<string, unknown> | undefined;
    if (!meta || !message) return;

    const mmsi = String(meta.MMSI ?? meta.mmsi ?? "");
    if (!mmsi) return;

    const allowed = new Set(activeMmsis(getDb()));
    if (!allowed.has(mmsi) && !allowed.has(mmsi.padStart(9, "0"))) return;

    let report: Record<string, unknown> | undefined;
    for (const key of POSITION_KEYS) {
      const candidate = message[key] as Record<string, unknown> | undefined;
      if (candidate) {
        report = candidate;
        break;
      }
    }
    // Fallback: some payloads nest under MessageType
    if (!report && typeof msg.MessageType === "string") {
      report = message[msg.MessageType as string] as Record<string, unknown> | undefined;
    }
    if (!report) return;

    const lat = Number(report.Latitude ?? meta.latitude ?? meta.Latitude);
    const lon = Number(report.Longitude ?? meta.longitude ?? meta.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (lat === 91 || lon === 181) return;

    const sog = report.Sog != null ? Number(report.Sog) : null;
    const cog = report.Cog != null ? Number(report.Cog) : null;
    const heading = report.TrueHeading != null ? Number(report.TrueHeading) : null;
    const ts = meta.time_utc ? Date.parse(String(meta.time_utc)) : Date.now();

    const { live } = ingestPosition(getDb(), {
      mmsi,
      lat,
      lon,
      sog: Number.isFinite(sog as number) ? sog : null,
      cog: Number.isFinite(cog as number) ? cog : null,
      heading: heading != null && heading !== 511 && Number.isFinite(heading) ? heading : null,
      ts: Number.isFinite(ts) ? ts : Date.now(),
    });
    this.ingestCount += 1;
    this.lastIngestAt = Date.now();
    this.broadcast({ type: "vessel", vessel: live });
  }
}
