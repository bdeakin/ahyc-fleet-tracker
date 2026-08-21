import { getDb } from "./db.js";
import { ingestPosition } from "./tracks.js";
import { upsertVessel, listVessels, deleteVessel } from "./vessels.js";
import { config } from "./config.js";

/**
 * Seed the primary club vessel (LIFE AT SEA) and optional synthetic demo tracks
 * under a separate inactive vessel for UI development without an AIS key.
 */
function main() {
  const db = getDb();

  // Remove placeholder demo MMSIs if present from earlier seeds
  for (const id of ["demo-nuthatch", "demo-shearwater"]) {
    deleteVessel(db, id);
  }

  const lifeAtSea = upsertVessel(db, {
    id: "life-at-sea",
    name: "LIFE AT SEA",
    mmsi: "338357109",
    color: "#c45c26",
    active: true,
  });

  // Inactive demo vessel — keeps Adventures UI testable offline; never subscribed to AIS
  const demo = upsertVessel(db, {
    id: "demo-season-preview",
    name: "SV Season Preview",
    mmsi: "000000001",
    sailNumber: "DEMO",
    color: "#1f6f8b",
    active: false,
  });

  db.prepare("DELETE FROM track_points WHERE mmsi = ?").run(demo.mmsi);
  db.prepare("DELETE FROM vessel_state WHERE mmsi = ?").run(demo.mmsi);
  db.prepare("DELETE FROM trips WHERE vessel_id = ?").run(demo.id);

  const year = 2026;
  const tripDays = [
    { month: 4, day: 12, bearing: 40, legNm: 4.2 },
    { month: 5, day: 3, bearing: 90, legNm: 6.5 },
    { month: 5, day: 24, bearing: 20, legNm: 8.1 },
    { month: 6, day: 14, bearing: 110, legNm: 5.0 },
    { month: 7, day: 4, bearing: 50, legNm: 11.2 },
    { month: 7, day: 19, bearing: 160, legNm: 3.8 },
    { month: 8, day: 9, bearing: 70, legNm: 9.4 },
    { month: 9, day: 6, bearing: 30, legNm: 7.0 },
    { month: 10, day: 11, bearing: 100, legNm: 4.5 },
  ];

  for (const trip of tripDays) {
    const start = Date.UTC(year, trip.month - 1, trip.day, 14, 0, 0);
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const phase = t <= 0.5 ? t * 2 : (1 - t) * 2;
      const rad = (trip.bearing * Math.PI) / 180;
      const curve = Math.sin(t * Math.PI) * 0.015;
      const distDeg = (trip.legNm / 60) * phase;
      const lat = config.homeLat + Math.cos(rad) * distDeg + curve * Math.cos(rad + Math.PI / 2);
      const lon =
        config.homeLon +
        (Math.sin(rad) * distDeg) / Math.cos((config.homeLat * Math.PI) / 180) +
        curve * Math.sin(rad + Math.PI / 2);
      const ts = start + i * 5 * 60_000;
      ingestPosition(db, {
        mmsi: demo.mmsi,
        lat,
        lon,
        sog: t === 0 || t === 1 ? 0.2 : 4.5 + Math.sin(t * 6),
        cog: trip.bearing + (t > 0.5 ? 180 : 0),
        heading: trip.bearing + (t > 0.5 ? 180 : 0),
        ts,
      });
    }
  }

  console.log("Club vessels:", listVessels(db).map((v) => `${v.name} (${v.mmsi}) active=${v.active}`));
  console.log(`Primary track target: ${lifeAtSea.name} MMSI ${lifeAtSea.mmsi} id=${lifeAtSea.id}`);
  console.log(`Inactive demo adventures: /adventures/${demo.id}/${year}`);
}

main();
