import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AdventureNarrative,
  ChartLayer,
  NoteworthyEvent,
  Vessel,
  VesselLiveState,
  VesselPhoto,
  VesselProfile,
  TrackPoint,
} from "@ahyc/shared";

export type NoteworthyBundle = {
  generatedAt: number;
  from: number;
  to: number;
  fixCount: number;
  events: NoteworthyEvent[];
};

const LOCAL_ADMIN_TOKEN_KEY = "ahyc_admin_token";
const SUPABASE_ACCESS_TOKEN_KEY = "ahyc_supabase_access_token";

export function getStoredLocalAdminToken(): string | null {
  return localStorage.getItem(LOCAL_ADMIN_TOKEN_KEY);
}

export function setStoredLocalAdminToken(token: string | null) {
  if (token) localStorage.setItem(LOCAL_ADMIN_TOKEN_KEY, token);
  else localStorage.removeItem(LOCAL_ADMIN_TOKEN_KEY);
}

function supabaseAccessToken(): string | null {
  return localStorage.getItem(SUPABASE_ACCESS_TOKEN_KEY);
}

/** Bearer header only when the browser has an explicit admin credential (never invent a default). */
export function authHeader(): string | undefined {
  const supabase = supabaseAccessToken();
  if (supabase) return `Bearer ${supabase}`;
  const local = getStoredLocalAdminToken();
  if (local) return `Bearer ${local}`;
  return undefined;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export type PublicConfig = {
  supabase: { configured: boolean; url: string | null; anonKey: string | null };
  ais?: {
    apiKeyConfigured: boolean;
    connected: boolean;
    watchingMmsi: string[];
    lastMessageAt: number | null;
    lastIngestAt: number | null;
    lastError: string | null;
    ingestTokenConfigured?: boolean;
  };
};

export type TrackHistorySpan = {
  trafficOldestTs: number | null;
  trafficNewestTs: number | null;
  trafficSpanMs: number | null;
  clubOldestTs: number | null;
  clubNewestTs: number | null;
  clubSpanMs: number | null;
  trafficRetentionMs: number;
  pointCount: number;
};

export type WatchedVessel = {
  mmsi: string;
  name: string | null;
  addedAt: number;
  note: string | null;
};

export type AdminSession = {
  ok: boolean;
  via: "local" | "supabase" | null;
  email: string | null;
};

export type AishubStatus = {
  usernameConfigured: boolean;
  lastCallAt: number | null;
  lastBboxAt: number | null;
  lastMmsiAt: number | null;
  lastError: string | null;
  callCount: number;
  ingestCount: number;
  lastFetched: number;
  lastIngested: number;
  lastRegion: string | null;
  /** Club MMSIs on the AISHub perimeter / offshore watchlist. */
  watchlist: string[];
  /** Same as watchlist.length — club vessels tracked outside/near the NE bbox. */
  outsideBboxClubCount: number;
  nextAllowedCallAt: number | null;
  intervalMs: number;
};

export const api = {
  config: () => json<PublicConfig>("/api/config"),
  aishubStatus: () => json<AishubStatus>("/api/aishub/status"),
  trackHistory: () => json<TrackHistorySpan>("/api/tracks/history"),
  watchlist: () => json<WatchedVessel[]>("/api/watchlist"),
  addWatch: (mmsi: string, name?: string | null) => {
    const auth = authHeader();
    if (!auth) return Promise.reject(new Error("401 unauthorized"));
    return json<WatchedVessel>("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ mmsi, name: name ?? null }),
    });
  },
  removeWatch: (mmsi: string) => {
    const auth = authHeader();
    if (!auth) return Promise.reject(new Error("401 unauthorized"));
    return json<{ ok: boolean }>(`/api/watchlist/${encodeURIComponent(mmsi)}`, {
      method: "DELETE",
      headers: { Authorization: auth },
    });
  },
  adminSession: async (): Promise<AdminSession> => {
    const auth = authHeader();
    if (!auth) return { ok: false, via: null, email: null };
    const res = await fetch("/api/admin/session", { headers: { Authorization: auth } });
    if (!res.ok) return { ok: false, via: null, email: null };
    return res.json() as Promise<AdminSession>;
  },
  vessels: () => json<Vessel[]>("/api/vessels"),
  live: (
    bbox?: { minLat: number; minLon: number; maxLat: number; maxLon: number },
    pinned?: string[],
  ) => {
    if (!bbox) return json<VesselLiveState[]>("/api/live");
    const q = new URLSearchParams({
      minLat: String(bbox.minLat),
      minLon: String(bbox.minLon),
      maxLat: String(bbox.maxLat),
      maxLon: String(bbox.maxLon),
    });
    if (pinned && pinned.length > 0) q.set("pinned", pinned.join(","));
    return json<VesselLiveState[]>(`/api/live?${q}`);
  },
  vesselProfile: (mmsi: string) => json<VesselProfile>(`/api/vessels/profile/${mmsi}`),
  vesselPhoto: (mmsi: string, name?: string | null) => {
    const q = name ? `?name=${encodeURIComponent(name)}` : "";
    return json<VesselPhoto>(`/api/vessels/photo/${mmsi}${q}`);
  },
  /** Image bytes are proxied by the server, so the kiosk stays on one origin. */
  vesselPhotoImageUrl: (mmsi: string) => `/api/vessels/photo/${mmsi}/image`,
  charts: () => json<ChartLayer[]>("/api/charts"),
  noteworthy: (hours = 24) => json<NoteworthyBundle>(`/api/noteworthy?hours=${hours}`),
  syncVessels: () => {
    const auth = authHeader();
    if (!auth) return Promise.reject(new Error("401 unauthorized"));
    return json<{ synced: number; configured: boolean }>("/api/sync/vessels", {
      method: "POST",
      headers: { Authorization: auth },
    });
  },
  tracks: (from: number, to: number, mmsi?: string, mmsis?: string[]) => {
    const q = new URLSearchParams({ from: String(from), to: String(to) });
    if (mmsi) q.set("mmsi", mmsi);
    else if (mmsis && mmsis.length > 0) q.set("mmsis", mmsis.join(","));
    return json<TrackPoint[]>(`/api/tracks?${q}`);
  },
  /** `mmsi` is included even if it had gone quiet, so a selected vessel always has a position. */
  replay: (at: number, mmsi?: string | null) => {
    const q = new URLSearchParams({ at: String(at) });
    if (mmsi) q.set("mmsi", mmsi);
    return json<VesselLiveState[]>(`/api/tracks/replay?${q}`);
  },
  seasons: (vesselId: string) =>
    json<{ vesselId: string; seasons: number[] }>(`/api/adventures/${vesselId}/seasons`),
  /** Active club vessels with years that have stored AIS traffic. */
  adventureOptions: () =>
    json<Array<{ vesselId: string; vesselName: string; year: number }>>("/api/adventures/options"),
  adventure: (vesselId: string, year: number) =>
    json<AdventureNarrative>(`/api/adventures/${vesselId}/${year}`),
  saveVessel: (body: Partial<Vessel> & { name: string; mmsi: string }, id?: string) => {
    const auth = authHeader();
    if (!auth) return Promise.reject(new Error("401 unauthorized"));
    return json<Vessel>(id ? `/api/vessels/${id}` : "/api/vessels", {
      method: id ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
      },
      body: JSON.stringify(body),
    });
  },
  deleteVessel: (id: string) => {
    const auth = authHeader();
    if (!auth) return Promise.reject(new Error("401 unauthorized"));
    return json<{ ok: boolean }>(`/api/vessels/${id}`, {
      method: "DELETE",
      headers: { Authorization: auth },
    });
  },
};

export function liveSocket(onMessage: (data: unknown) => void): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}/api/ws/live`);
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  };
  return ws;
}

let browserSupabase: SupabaseClient | null = null;

export function getBrowserSupabase(url: string, anonKey: string): SupabaseClient {
  if (!browserSupabase) {
    browserSupabase = createClient(url, anonKey);
  }
  return browserSupabase;
}

export function persistSupabaseSession(session: Session | null) {
  if (session?.access_token) {
    localStorage.setItem(SUPABASE_ACCESS_TOKEN_KEY, session.access_token);
  } else {
    localStorage.removeItem(SUPABASE_ACCESS_TOKEN_KEY);
  }
}
