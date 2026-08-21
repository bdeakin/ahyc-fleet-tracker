import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Vessel } from "@ahyc/shared";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { upsertVessel, listVessels, deleteVessel } from "./vessels.js";

let serviceClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return Boolean(config.supabaseUrl && (config.supabaseServiceRoleKey || config.supabaseAnonKey));
}

function getServiceClient(): SupabaseClient | null {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return null;
  if (!serviceClient) {
    serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceClient;
}

function getAnonClient(): SupabaseClient | null {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;
  if (!anonClient) {
    anonClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return anonClient;
}

type RemoteVessel = {
  id: string;
  name: string;
  mmsi: string;
  sail_number: string | null;
  color: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function remoteToLocal(row: RemoteVessel): Parameters<typeof upsertVessel>[1] {
  return {
    id: row.id,
    name: row.name,
    mmsi: row.mmsi,
    sailNumber: row.sail_number,
    color: row.color,
    active: row.active,
  };
}

/** Pull cloud registry into local SQLite (Pi stays authoritative for tracks). */
export async function syncVesselsFromSupabase(): Promise<{ synced: number; configured: boolean }> {
  const client = getServiceClient() ?? getAnonClient();
  if (!client) return { synced: 0, configured: false };

  const { data, error } = await client.from("vessels").select("*").order("name");
  if (error) throw new Error(`supabase sync failed: ${error.message}`);

  const db = getDb();
  const remote = (data ?? []) as RemoteVessel[];
  const remoteIds = new Set(remote.map((r) => r.id));

  for (const row of remote) {
    upsertVessel(db, remoteToLocal(row));
  }

  // Remove local vessels that were deleted in Supabase (keep demo inactive preview)
  for (const local of listVessels(db)) {
    if (local.id === "demo-season-preview") continue;
    if (local.id.startsWith("demo-")) continue;
    if (!remoteIds.has(local.id) && remote.length > 0) {
      // Only prune when remote returned a list successfully and vessel looks like a UUID from cloud
      if (/^[0-9a-f-]{36}$/i.test(local.id) || local.id === "life-at-sea") {
        // Keep life-at-sea if not in remote yet (seeded locally); only delete UUID rows missing remotely
        if (/^[0-9a-f-]{36}$/i.test(local.id)) deleteVessel(db, local.id);
      }
    }
  }

  return { synced: remote.length, configured: true };
}

export async function pushVesselToSupabase(vessel: Vessel): Promise<void> {
  const client = getServiceClient();
  if (!client) return;
  const { error } = await client.from("vessels").upsert(
    {
      id: vessel.id,
      name: vessel.name,
      mmsi: vessel.mmsi,
      sail_number: vessel.sailNumber ?? null,
      color: vessel.color,
      active: vessel.active,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`supabase upsert failed: ${error.message}`);
}

export async function deleteVesselFromSupabase(id: string): Promise<void> {
  const client = getServiceClient();
  if (!client) return;
  const { error } = await client.from("vessels").delete().eq("id", id);
  if (error) throw new Error(`supabase delete failed: ${error.message}`);
}

export async function verifyAdminAuth(authorization: string | undefined): Promise<{
  ok: boolean;
  via: "local" | "supabase" | null;
  user?: User;
}> {
  if (!authorization) return { ok: false, via: null };
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, via: null };

  if (token === config.localAdminToken) {
    return { ok: true, via: "local" };
  }

  const client = getAnonClient() ?? getServiceClient();
  if (!client) return { ok: false, via: null };

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { ok: false, via: null };
  return { ok: true, via: "supabase", user: data.user };
}

export function publicSupabaseConfig() {
  return {
    configured: Boolean(config.supabaseUrl && config.supabaseAnonKey),
    url: config.supabaseUrl || null,
    anonKey: config.supabaseAnonKey || null,
  };
}
