import { getDb } from "./db.js";
import { listVessels, upsertVessel } from "./vessels.js";

/** Ensure LIFE AT SEA exists on first boot (empty Railway volume / fresh Pi). */
export function ensurePrimaryClubVessel(): void {
  const db = getDb();
  const active = listVessels(db, true);
  if (active.some((v) => v.mmsi === "338357109")) return;

  upsertVessel(db, {
    id: "life-at-sea",
    name: "LIFE AT SEA",
    mmsi: "338357109",
    color: "#c45c26",
    active: true,
  });
  console.log("[bootstrap] registered primary club vessel LIFE AT SEA (338357109)");
}
