import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";
import { ingestPosition } from "./tracks.js";
import { upsertVessel } from "./vessels.js";
import { config } from "./config.js";

/** Seed demo club vessels and a synthetic 2026 season of day sails for local UI work. */
function main() {
  const db = getDb();
  const nuthatch = upsertVessel(db, {
    id: "demo-nuthatch",
    name: "SV Nuthatch",
    mmsi: "338123456",
    sailNumber: "USA 42",
    color: "#c45c26",
    active: true,
  });
  upsertVessel(db, {
    id: "demo-shearwater",
    name: "Shearwater",
    mmsi: "338654321",
    sailNumber: "NJ 17",
    color: "#1f6f8b",
    active: true,
  });

  db.prepare("DELETE FROM track_points WHERE mmsi = ?").run(nuthatch.mmsi);
  db.prepare("DELETE FROM vessel_state WHERE mmsi = ?").run(nuthatch.mmsi);
  db.prepare("DELETE FROM trips WHERE vessel_id = ?").run(nuthatch.id);

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
        mmsi: nuthatch.mmsi,
        lat,
        lon,
        sog: t === 0 || t === 1 ? 0.2 : 4.5 + Math.sin(t * 6),
        cog: trip.bearing + (t > 0.5 ? 180 : 0),
        heading: trip.bearing + (t > 0.5 ? 180 : 0),
        ts,
      });
    }
  }

  ingestPosition(db, {
    mmsi: nuthatch.mmsi,
    lat: config.homeLat + 0.002,
    lon: config.homeLon - 0.001,
    sog: 0.1,
    cog: 0,
    heading: 45,
    ts: Date.now(),
  });

  console.log(`Seeded vessels and ${tripDays.length} synthetic 2026 trips for ${nuthatch.name}`);
  console.log(`Demo adventure id: ${nuthatch.id} / season ${year}`);
  console.log(`Unused uuid sample: ${randomUUID()}`);
}

main();
