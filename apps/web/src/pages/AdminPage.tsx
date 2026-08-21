import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Vessel } from "@ahyc/shared";
import { api } from "../api";

export function AdminPage() {
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [token, setToken] = useState(localStorage.getItem("ahyc_admin_token") ?? "dev-admin-token");
  const [form, setForm] = useState({
    name: "",
    mmsi: "",
    sailNumber: "",
    color: "#1f6f8b",
  });
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setVessels(await api.vessels());
  }

  useEffect(() => {
    refresh().catch((e) => setMessage(String(e)));
  }, []);

  function saveToken() {
    localStorage.setItem("ahyc_admin_token", token);
    setMessage("Admin token saved locally.");
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
          adventures. When Supabase is configured, this local registry can sync from the cloud;
          until then, use the local admin token from <code>.env</code>.
        </p>

        <div className="controls" style={{ alignItems: "end" }}>
          <label>
            Admin token
            <input value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          <button type="button" className="chip" onClick={saveToken}>
            Save token
          </button>
        </div>

        <form className="adminForm" onSubmit={onSubmit}>
          <label>
            Vessel name
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="SV Nuthatch"
            />
          </label>
          <label>
            MMSI
            <input
              required
              value={form.mmsi}
              onChange={(e) => setForm((f) => ({ ...f, mmsi: e.target.value }))}
              placeholder="338123456"
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
                </td>
                <td>{v.mmsi}</td>
                <td>{v.sailNumber ?? "—"}</td>
                <td>
                  <Link to={`/adventures/${v.id}/${new Date().getFullYear()}`}>Adventures</Link>
                  {" · "}
                  <button type="button" className="chip" onClick={() => remove(v.id)}>
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
