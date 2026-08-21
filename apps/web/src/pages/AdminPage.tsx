import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Vessel } from "@ahyc/shared";
import { api, getBrowserSupabase, persistSupabaseSession } from "../api";

export function AdminPage() {
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [token, setToken] = useState(localStorage.getItem("ahyc_admin_token") ?? "dev-admin-token");
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

  async function refresh() {
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
        }
      })
      .catch((e) => setMessage(String(e)));
    refresh().catch((e) => setMessage(String(e)));
  }, []);

  function saveToken() {
    localStorage.setItem("ahyc_admin_token", token);
    setMessage("Local admin token saved.");
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
    setMessage("Signed in with Supabase.");
  }

  async function signOut() {
    if (supabaseUrl && supabaseAnon) {
      await getBrowserSupabase(supabaseUrl, supabaseAnon).auth.signOut();
    }
    persistSupabaseSession(null);
    setSessionEmail(null);
    setMessage("Signed out.");
  }

  async function syncFromCloud() {
    setMessage(null);
    try {
      const result = await api.syncVessels();
      await refresh();
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
      await refresh();
      setMessage("Vessel registered. AIS filter will include this MMSI.");
    } catch (err) {
      setMessage(String(err));
    }
  }

  async function remove(id: string) {
    await api.deleteVessel(id);
    await refresh();
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
          Register club boats by MMSI. Only these vessels appear on the kiosk map and in season
          adventures. Prefer Supabase email login when configured; otherwise use the local admin
          token. The Pi pulls the cloud registry every few minutes.
        </p>

        {supabaseReady ? (
          <div className="adminForm" style={{ marginBottom: "1.5rem" }}>
            <strong>Supabase admin</strong>
            {sessionEmail ? (
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
              <input value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
            <button type="button" className="chip" onClick={saveToken}>
              Save token
            </button>
          </div>
        )}

        {!supabaseReady && (
          <p style={{ opacity: 0.75, fontSize: "0.9rem" }}>
            Supabase is not configured. Set <code>SUPABASE_URL</code> and keys in{" "}
            <code>.env</code>, then run <code>deploy/supabase/schema.sql</code> in the Supabase SQL
            editor.
          </p>
        )}

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
      </div>
    </div>
  );
}
