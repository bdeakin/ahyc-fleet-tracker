import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Vessel } from "@ahyc/shared";
import {
  api,
  getBrowserSupabase,
  getStoredLocalAdminToken,
  persistSupabaseSession,
  setStoredLocalAdminToken,
} from "../api";
import { useAdminSession } from "../useAdminSession";

export function AdminPage() {
  const { admin, checking, refresh } = useAdminSession();
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [token, setToken] = useState(getStoredLocalAdminToken() ?? "");
  const [supabaseReady, setSupabaseReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    mmsi: "",
    sailNumber: "",
    color: "#1f6f8b",
  });
  const [message, setMessage] = useState<string | null>(null);
  const [supabaseUrl, setSupabaseUrl] = useState<string | null>(null);
  const [supabaseAnon, setSupabaseAnon] = useState<string | null>(null);

  async function refreshVessels() {
    setVessels(await api.vessels());
  }

  useEffect(() => {
    api
      .config()
      .then(async (cfg) => {
        setSupabaseReady(cfg.supabase.configured);
        setSupabaseUrl(cfg.supabase.url);
        setSupabaseAnon(cfg.supabase.anonKey);
        if (cfg.supabase.configured && cfg.supabase.url && cfg.supabase.anonKey) {
          const sb = getBrowserSupabase(cfg.supabase.url, cfg.supabase.anonKey);
          const { data } = await sb.auth.getSession();
          persistSupabaseSession(data.session);
          setSessionEmail(data.session?.user.email ?? null);
          await refresh();
        }
      })
      .catch((e) => setMessage(String(e)));
  }, [refresh]);

  useEffect(() => {
    if (!admin) {
      setVessels([]);
      return;
    }
    refreshVessels().catch((e) => setMessage(String(e)));
  }, [admin]);

  async function saveToken() {
    setStoredLocalAdminToken(token.trim() || null);
    setMessage(null);
    const ok = await refresh();
    setMessage(ok ? "Admin token verified." : "Token rejected — check LOCAL_ADMIN_TOKEN on the server.");
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (!supabaseUrl || !supabaseAnon) return;
    setMessage(null);
    const sb = getBrowserSupabase(supabaseUrl, supabaseAnon);
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(error.message);
      return;
    }
    persistSupabaseSession(data.session);
    setSessionEmail(data.session?.user.email ?? null);
    const ok = await refresh();
    setMessage(ok ? "Signed in with Supabase." : "Signed in, but server rejected the session.");
  }

  async function signOut() {
    if (supabaseUrl && supabaseAnon) {
      await getBrowserSupabase(supabaseUrl, supabaseAnon).auth.signOut();
    }
    persistSupabaseSession(null);
    setStoredLocalAdminToken(null);
    setToken("");
    setSessionEmail(null);
    await refresh();
    setMessage("Signed out.");
  }

  async function syncFromCloud() {
    setMessage(null);
    try {
      const result = await api.syncVessels();
      await refreshVessels();
      setMessage(
        result.configured
          ? `Synced ${result.synced} vessel(s) from Supabase.`
          : "Supabase is not configured on the server.",
      );
    } catch (err) {
      setMessage(String(err));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      await api.saveVessel({
        name: form.name,
        mmsi: form.mmsi,
        sailNumber: form.sailNumber || null,
        color: form.color,
        active: true,
      });
      setForm({ name: "", mmsi: "", sailNumber: "", color: "#1f6f8b" });
      await refreshVessels();
      setMessage("Vessel registered. AIS filter will include this MMSI.");
    } catch (err) {
      setMessage(String(err));
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteVessel(id);
      await refreshVessels();
    } catch (err) {
      setMessage(String(err));
    }
  }

  return (
    <div className="page">
      <div className="page-inner">
        <div className="top-nav">
          <strong>Club vessel registry</strong>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <Link to="/">Kiosk</Link>
            <Link to="/adventures">Adventures</Link>
          </div>
        </div>

        <p style={{ maxWidth: "42rem", opacity: 0.9 }}>
          Administrator sign-in is required to register vessels or manage the watch list. Prefer
          Supabase email login when configured; otherwise paste the server{" "}
          <code>LOCAL_ADMIN_TOKEN</code> (never the insecure default in production).
        </p>

        {supabaseReady ? (
          <div className="adminForm" style={{ marginBottom: "1.5rem" }}>
            <strong>Supabase admin</strong>
            {sessionEmail && admin ? (
              <>
                <p style={{ margin: 0 }}>Signed in as {sessionEmail}</p>
                <button type="button" onClick={() => void signOut()}>
                  Sign out
                </button>
                <button type="button" className="chip" onClick={() => void syncFromCloud()}>
                  Sync from Supabase
                </button>
              </>
            ) : (
              <form onSubmit={(e) => void signIn(e)} className="adminForm">
                <label>
                  Email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button type="submit">Sign in</button>
              </form>
            )}
          </div>
        ) : (
          <div className="controls" style={{ alignItems: "end" }}>
            <label>
              Admin token
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="LOCAL_ADMIN_TOKEN"
                autoComplete="off"
              />
            </label>
            <button type="button" className="chip" onClick={() => void saveToken()}>
              Verify token
            </button>
            {admin && (
              <button type="button" className="chip" onClick={() => void signOut()}>
                Clear
              </button>
            )}
          </div>
        )}

        {!supabaseReady && (
          <p style={{ opacity: 0.75, fontSize: "0.9rem" }}>
            Supabase is not configured. Set <code>SUPABASE_URL</code> and keys in{" "}
            <code>.env</code>, then run <code>deploy/supabase/schema.sql</code> in the Supabase SQL
            editor. Until then, only a verified <code>LOCAL_ADMIN_TOKEN</code> unlocks this page.
          </p>
        )}

        {checking && <p style={{ opacity: 0.75 }}>Checking admin session…</p>}

        {!checking && !admin && (
          <p style={{ opacity: 0.9 }}>
            Sign in above to manage the club vessel registry. The public kiosk stays read-only.
          </p>
        )}

        {admin && (
          <>
            <form className="adminForm" onSubmit={(e) => void onSubmit(e)}>
              <label>
                Vessel name
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="LIFE AT SEA"
                />
              </label>
              <label>
                MMSI
                <input
                  required
                  value={form.mmsi}
                  onChange={(e) => setForm((f) => ({ ...f, mmsi: e.target.value }))}
                  placeholder="338357109"
                />
              </label>
              <label>
                Sail number
                <input
                  value={form.sailNumber}
                  onChange={(e) => setForm((f) => ({ ...f, sailNumber: e.target.value }))}
                />
              </label>
              <label>
                Marker color
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                />
              </label>
              <button type="submit">Register vessel</button>
            </form>

            {message && <p>{message}</p>}

            <table className="vessel-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>MMSI</th>
                  <th>Sail #</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {vessels.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <span style={{ color: v.color }}>●</span> {v.name}
                      {!v.active ? " (inactive)" : ""}
                    </td>
                    <td>{v.mmsi}</td>
                    <td>{v.sailNumber ?? "—"}</td>
                    <td>
                      <Link to={`/adventures/${v.id}/${new Date().getFullYear()}`}>Adventures</Link>
                      {" · "}
                      <button type="button" className="chip" onClick={() => void remove(v.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {!admin && message && <p>{message}</p>}
      </div>
    </div>
  );
}
