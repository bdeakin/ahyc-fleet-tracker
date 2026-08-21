import { useMemo } from "react";
import { AHYC_CENTER, type AdventureNarrative } from "@ahyc/shared";

type Props = { adventure: AdventureNarrative };

export function StylizedSeasonMap({ adventure }: Props) {
  const { paths, bounds, home } = useMemo(() => project(adventure), [adventure]);

  return (
    <svg viewBox="0 0 1000 640" role="img" aria-label={`Stylized map of ${adventure.title}`}>
      <defs>
        <radialGradient id="water" cx="50%" cy="45%" r="65%">
          <stop offset="0%" stopColor="#1a6070" />
          <stop offset="55%" stopColor="#0d3b4a" />
          <stop offset="100%" stopColor="#071f28" />
        </radialGradient>
        <linearGradient id="shore" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#2f5a4a" />
          <stop offset="100%" stopColor="#1d3d36" />
        </linearGradient>
        <filter id="soft">
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
      </defs>

      <rect width="1000" height="640" fill="url(#water)" />

      {/* Decorative current lines */}
      {Array.from({ length: 8 }).map((_, i) => (
        <path
          key={i}
          d={`M ${40 + i * 20} ${120 + i * 55} Q ${300 + i * 40} ${90 + i * 40}, ${920} ${160 + i * 48}`}
          fill="none"
          stroke="rgba(215,236,232,0.08)"
          strokeWidth="2"
        />
      ))}

      {/* Stylized Sandy Hook / Highlands land suggestion */}
      <path
        d="M 120 80 C 220 60, 280 110, 310 180 C 340 260, 300 330, 250 390 C 190 470, 140 520, 90 560 L 40 560 L 40 100 Z"
        fill="url(#shore)"
        opacity="0.9"
      />
      <path
        d="M 860 40 C 920 120, 940 220, 900 320 C 860 420, 800 500, 760 560 L 980 560 L 980 40 Z"
        fill="url(#shore)"
        opacity="0.55"
      />

      {/* Trip tracks */}
      {paths.map((d, i) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke={strokeFor(i, adventure.vessel.color)}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.92"
          filter="url(#soft)"
        >
          <animate attributeName="stroke-dashoffset" from="420" to="0" dur={`${1.2 + i * 0.08}s`} fill="freeze" />
        </path>
      ))}

      {/* Home mark — AHYC */}
      <g transform={`translate(${home.x}, ${home.y})`}>
        <circle r="10" fill="#b08d57" stroke="#d7ece8" strokeWidth="2" />
        <text textAnchor="middle" y="28" fill="#d7ece8" fontSize="14" fontFamily="Source Sans 3, sans-serif">
          AHYC
        </text>
      </g>

      {/* Compass rose */}
      <g transform="translate(900, 100)">
        <circle r="36" fill="rgba(6,24,32,0.45)" stroke="#b08d57" strokeWidth="1.5" />
        <polygon points="0,-30 6,0 0,8 -6,0" fill="#d7ece8" />
        <polygon points="0,30 6,0 0,-8 -6,0" fill="#b08d57" />
        <text textAnchor="middle" y="-42" fill="#d7ece8" fontSize="12" fontFamily="Fraunces, serif">
          N
        </text>
      </g>

      <text x="40" y="610" fill="rgba(215,236,232,0.7)" fontSize="14" fontFamily="Fraunces, serif">
        {adventure.seasonYear} · Sandy Hook Bay · {adventure.stats.tripCount} voyages
      </text>

      {/* bounds used only to silence unused if empty */}
      {bounds.minLat === bounds.maxLat ? null : null}
    </svg>
  );
}

function strokeFor(i: number, base: string): string {
  const palette = [base, "#d7ece8", "#b08d57", "#5fb3a9", "#e2c48a"];
  return palette[i % palette.length];
}

function project(adventure: AdventureNarrative) {
  const all = adventure.tracks.flatMap((t) => t.points);
  const lats = all.map((p) => p.lat);
  const lons = all.map((p) => p.lon);
  const pad = 0.02;
  const minLat = (lats.length ? Math.min(...lats) : AHYC_CENTER.lat) - pad;
  const maxLat = (lats.length ? Math.max(...lats) : AHYC_CENTER.lat) + pad;
  const minLon = (lons.length ? Math.min(...lons) : AHYC_CENTER.lon) - pad;
  const maxLon = (lons.length ? Math.max(...lons) : AHYC_CENTER.lon) + pad;

  const toXy = (lat: number, lon: number) => {
    const x = ((lon - minLon) / (maxLon - minLon || 1)) * 860 + 70;
    const y = (1 - (lat - minLat) / (maxLat - minLat || 1)) * 500 + 70;
    return { x, y };
  };

  const paths = adventure.tracks.map((track) => {
    if (!track.points.length) return "";
    return track.points
      .map((p, i) => {
        const { x, y } = toXy(p.lat, p.lon);
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  });

  return {
    paths: paths.filter(Boolean),
    bounds: { minLat, maxLat, minLon, maxLon },
    home: toXy(AHYC_CENTER.lat, AHYC_CENTER.lon),
  };
}
