import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AdventureNarrative } from "@ahyc/shared";
import { api } from "../api";
import { StylizedSeasonMap } from "../components/StylizedSeasonMap";

type AdventureOption = { vesselId: string; vesselName: string; year: number };

function optionKey(o: Pick<AdventureOption, "vesselId" | "year">): string {
  return `${o.vesselId}:${o.year}`;
}

export function AdventuresPage() {
  const { vesselId, year } = useParams();
  const navigate = useNavigate();
  const [options, setOptions] = useState<AdventureOption[]>([]);
  const [adventure, setAdventure] = useState<AdventureNarrative | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedKey =
    vesselId && year ? optionKey({ vesselId, year: Number(year) }) : options[0] ? optionKey(options[0]) : "";

  useEffect(() => {
    api
      .adventureOptions()
      .then((list) => {
        setOptions(list);
        if (!vesselId || !year) {
          const first = list[0];
          if (first) {
            navigate(`/adventures/${first.vesselId}/${first.year}`, { replace: true });
          }
        }
      })
      .catch((e) => setError(String(e)));
  }, [vesselId, year, navigate]);

  useEffect(() => {
    if (!vesselId || !year) return;
    const y = Number(year);
    if (!Number.isFinite(y)) return;
    setLoading(true);
    setError(null);
    api
      .adventure(vesselId, y)
      .then(setAdventure)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [vesselId, year]);

  const stats = useMemo(() => adventure?.stats, [adventure]);

  return (
    <div className="page">
      <div className="page-inner">
        <div className="top-nav">
          <strong>Atlantic Highlands Yacht Club</strong>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <Link to="/">Kiosk map</Link>
            <Link to="/admin">Admin</Link>
          </div>
        </div>

        <div className="controls">
          <label>
            Season adventures
            <select
              value={selectedKey}
              onChange={(e) => {
                const [id, y] = e.target.value.split(":");
                if (id && y) navigate(`/adventures/${id}/${y}`);
              }}
              aria-label="Season adventures"
            >
              {options.length === 0 && <option value="">No club AIS seasons yet</option>}
              {options.map((o) => (
                <option key={optionKey(o)} value={optionKey(o)}>
                  {o.vesselName} - {o.year}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <p style={{ color: "#f0b7b7" }}>{error}</p>}
        {loading && <p>Gathering the season’s log…</p>}
        {!loading && options.length === 0 && !error && (
          <p style={{ opacity: 0.85 }}>
            Register club boats in Admin and wait for AIS traffic to accumulate — seasons appear here
            as “Vessel name - year”.
          </p>
        )}

        {adventure && (
          <>
            <div className="scroll-title">
              <h1>{adventure.title}</h1>
            </div>

            {stats && (
              <div className="stats-row">
                <span>{stats.tripCount} trips</span>
                <span>{stats.totalDistanceNm} nm logged</span>
                <span>{stats.farthestRangeNm} nm farthest</span>
                <span>{stats.activeDays} active days</span>
              </div>
            )}

            <div className="art-map-wrap">
              <StylizedSeasonMap adventure={adventure} />
            </div>

            <article className="narrative">
              {adventure.paragraphs.map((p) => (
                <p key={p.slice(0, 48)}>{p}</p>
              ))}
            </article>
          </>
        )}
      </div>
    </div>
  );
}
