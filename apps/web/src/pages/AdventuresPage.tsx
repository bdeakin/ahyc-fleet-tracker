import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { AdventureNarrative, Vessel } from "@ahyc/shared";
import { api } from "../api";
import { StylizedSeasonMap } from "../components/StylizedSeasonMap";

export function AdventuresPage() {
  const { vesselId, year } = useParams();
  const navigate = useNavigate();
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [seasons, setSeasons] = useState<number[]>([]);
  const [adventure, setAdventure] = useState<AdventureNarrative | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedVessel = vesselId ?? vessels[0]?.id ?? "";
  const selectedYear = year ? Number(year) : seasons[0] ?? new Date().getFullYear();

  useEffect(() => {
    api.vessels().then(setVessels).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!selectedVessel) return;
    api
      .seasons(selectedVessel)
      .then((r) => {
        const list = r.seasons.length ? r.seasons : [new Date().getFullYear()];
        setSeasons(list);
        if (!year) {
          navigate(`/adventures/${selectedVessel}/${list[0]}`, { replace: true });
        }
      })
      .catch((e) => setError(String(e)));
  }, [selectedVessel, year, navigate]);

  useEffect(() => {
    if (!selectedVessel || !selectedYear) return;
    setLoading(true);
    setError(null);
    api
      .adventure(selectedVessel, selectedYear)
      .then(setAdventure)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selectedVessel, selectedYear]);

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
            Vessel
            <select
              value={selectedVessel}
              onChange={(e) => navigate(`/adventures/${e.target.value}/${selectedYear}`)}
            >
              {vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Season
            <select
              value={selectedYear}
              onChange={(e) => navigate(`/adventures/${selectedVessel}/${e.target.value}`)}
            >
              {(seasons.length ? seasons : [selectedYear]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <p style={{ color: "#f0b7b7" }}>{error}</p>}
        {loading && <p>Gathering the season’s log…</p>}

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
