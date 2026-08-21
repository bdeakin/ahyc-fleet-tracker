import WebSocket from "ws";
import { DEFAULT_BBOX } from "@ahyc/shared";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { ingestPosition } from "./tracks.js";
import { activeMmsis } from "./vessels.js";

export type LiveBroadcaster = (payload: unknown) => void;

export class AisIngestWorker {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private mmsiKey = "";

  constructor(private broadcast: LiveBroadcaster) {}

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  /** Call when vessel registry changes so FiltersShipMMSI stays current. */
  refreshSubscription() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sendSubscribe();
  }

  private connect() {
    if (this.stopped) return;
    if (!config.aisstreamApiKey) {
      console.warn("[ais] AISSTREAM_API_KEY not set — ingest disabled (seed/demo data still works)");
      return;
    }

    const mmsis = activeMmsis(getDb());
    if (mmsis.length === 0) {
      console.warn("[ais] No active club vessels registered — waiting before connect");
      this.reconnectTimer = setTimeout(() => this.connect(), 15_000);
      return;
    }

    console.log(`[ais] Connecting with ${mmsis.length} club MMSI filter(s)`);
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    this.ws = ws;

    ws.on("open", () => {
      this.sendSubscribe();
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (err) {
        console.warn("[ais] bad message", err);
      }
    });

    ws.on("close", () => {
      console.warn("[ais] socket closed; reconnecting");
      this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.warn("[ais] socket error", err.message);
    });
  }

  private sendSubscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const mmsis = activeMmsis(getDb());
    this.mmsiKey = mmsis.slice().sort().join(",");
    const subscription = {
      APIKey: config.aisstreamApiKey,
      BoundingBoxes: [
        [
          [DEFAULT_BBOX.minLat, DEFAULT_BBOX.minLon],
          [DEFAULT_BBOX.maxLat, DEFAULT_BBOX.maxLon],
        ],
      ],
      FiltersShipMMSI: mmsis,
      FilterMessageTypes: ["PositionReport", "StandardClassBPositionReport"],
    };
    this.ws.send(JSON.stringify(subscription));
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
    if (!allowed.has(mmsi)) return;

    const report =
      (message.PositionReport as Record<string, unknown> | undefined) ??
      (message.StandardClassBPositionReport as Record<string, unknown> | undefined);
    if (!report) return;

    const lat = Number(report.Latitude ?? meta.latitude);
    const lon = Number(report.Longitude ?? meta.longitude);
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
    this.broadcast({ type: "vessel", vessel: live });
  }
}
