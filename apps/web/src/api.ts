import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { AdventureNarrative, ChartLayer, Vessel, VesselLiveState, TrackPoint } from "@ahyc/shared";

const adminToken = () => localStorage.getItem("ahyc_admin_token") ?? "dev-admin-token";
const supabaseAccessToken = () => localStorage.getItem("ahyc_supabase_access_token");

function authHeader(): string {
  const supabase = supabaseAccessToken();
  if (supabase) return `Bearer ${supabase}`;
  return `Bearer ${adminToken()}`;
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
  };
};

export const api = {
  config: () => json<PublicConfig>("/api/config"),
  vessels: () => json<Vessel[]>("/api/vessels"),
  live: () => json<VesselLiveState[]>("/api/live"),
  charts: () => json<ChartLayer[]>("/api/charts"),
  syncVessels: () =>
    json<{ synced: number; configured: boolean }>("/api/sync/vessels", {
      method: "POST",
      headers: { Authorization: authHeader() },
    }),
  tracks: (from: number, to: number, mmsi?: string) => {
    const q = new URLSearchParams({ from: String(from), to: String(to) });
    if (mmsi) q.set("mmsi", mmsi);
    return json<TrackPoint[]>(`/api/tracks?${q}`);
  },
  replay: (at: number) => json<VesselLiveState[]>(`/api/tracks/replay?at=${at}`),
  seasons: (vesselId: string) =>
    json<{ vesselId: string; seasons: number[] }>(`/api/adventures/${vesselId}/seasons`),
  adventure: (vesselId: string, year: number) =>
    json<AdventureNarrative>(`/api/adventures/${vesselId}/${year}`),
  saveVessel: (body: Partial<Vessel> & { name: string; mmsi: string }, id?: string) =>
    json<Vessel>(id ? `/api/vessels/${id}` : "/api/vessels", {
      method: id ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify(body),
    }),
  deleteVessel: (id: string) =>
    json<{ ok: boolean }>(`/api/vessels/${id}`, {
      method: "DELETE",
      headers: { Authorization: authHeader() },
    }),
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
    localStorage.setItem("ahyc_supabase_access_token", session.access_token);
  } else {
    localStorage.removeItem("ahyc_supabase_access_token");
  }
}
