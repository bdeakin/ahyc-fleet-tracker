import {
  adventureTitle,
  seasonBounds,
  type AdventureNarrative,
  type Vessel,
} from "@ahyc/shared";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { detectTripsForVesselSeason, listTrips } from "./trips.js";

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function fmtNm(n: number): string {
  return n.toFixed(n >= 10 ? 0 : 1);
}

export function buildAdventure(
  db: Db,
  vessel: Vessel,
  seasonYear: number,
  recompute = true,
): AdventureNarrative {
  if (recompute) detectTripsForVesselSeason(db, vessel, seasonYear);
  const trips = listTrips(db, vessel.id, seasonYear);
  const { seasonStart, seasonEnd } = seasonBounds(seasonYear, config.seasonStart, config.seasonEnd);

  const totalDistanceNm = trips.reduce((s, t) => s + t.distanceNm, 0);
  const farthestRangeNm = trips.reduce((m, t) => Math.max(m, t.maxRangeNm), 0);
  const dayKeys = new Set(trips.map((t) => new Date(t.startTs).toDateString()));
  const first = trips[0] ?? null;
  const last = trips[trips.length - 1] ?? null;

  const paragraphs = composeNarrative(vessel, seasonYear, trips, {
    totalDistanceNm,
    farthestRangeNm,
    activeDays: dayKeys.size,
  });

  const tracks = trips.map((trip) => {
    const points = db
      .prepare(
        `SELECT lat, lon, ts FROM track_points
         WHERE mmsi = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC`,
      )
      .all(vessel.mmsi, trip.startTs, trip.endTs) as Array<{ lat: number; lon: number; ts: number }>;
    return { tripId: trip.id, points };
  });

  return {
    title: adventureTitle(vessel.name, seasonYear),
    vessel,
    seasonYear,
    seasonStart: new Date(seasonStart).toISOString(),
    seasonEnd: new Date(seasonEnd).toISOString(),
    paragraphs,
    stats: {
      tripCount: trips.length,
      totalDistanceNm: Number(totalDistanceNm.toFixed(1)),
      farthestRangeNm: Number(farthestRangeNm.toFixed(1)),
      firstTripDate: first ? new Date(first.startTs).toISOString() : null,
      lastTripDate: last ? new Date(last.startTs).toISOString() : null,
      activeDays: dayKeys.size,
    },
    trips,
    tracks,
  };
}

function composeNarrative(
  vessel: Vessel,
  seasonYear: number,
  trips: ReturnType<typeof listTrips>,
  stats: { totalDistanceNm: number; farthestRangeNm: number; activeDays: number },
): string[] {
  const name = vessel.name;
  const paras: string[] = [];

  if (trips.length === 0) {
    paras.push(
      `The ${seasonYear} sailing season (April through October) holds no recorded outings yet for ${name}. When AIS beacons from this club vessel begin to move beyond the Atlantic Highlands home waters, those voyages will be woven into this chronicle.`,
    );
    return paras;
  }

  paras.push(
    `From the piers of Atlantic Highlands Yacht Club, ${name} wrote a ${seasonYear} season of ${trips.length} outing${trips.length === 1 ? "" : "s"} across ${stats.activeDays} day${stats.activeDays === 1 ? "" : "s"} on the water. AIS traces logged roughly ${fmtNm(stats.totalDistanceNm)} nautical miles under way, with the farthest reach about ${fmtNm(stats.farthestRangeNm)} nautical miles from home.`,
  );

  const first = trips[0];
  const last = trips[trips.length - 1];
  paras.push(
    `The season opened on ${fmtDate(first.startTs)}, when ${name} slipped the harbor lines and stood out into Sandy Hook Bay. The final recorded adventure fell on ${fmtDate(last.startTs)}, closing the book on another stretch of Jersey Shore sailing.`,
  );

  const longest = [...trips].sort((a, b) => b.distanceNm - a.distanceNm)[0];
  const farthest = [...trips].sort((a, b) => b.maxRangeNm - a.maxRangeNm)[0];
  if (longest) {
    paras.push(
      `The longest measured track covered ${fmtNm(longest.distanceNm)} nautical miles on ${fmtDate(longest.startTs)}. The voyage that ranged farthest from the club grounds stretched ${fmtNm(farthest.maxRangeNm)} nautical miles offshore of the Highlands, sketched in ink on the season map that accompanies this tale.`,
    );
  }

  if (trips.length >= 3) {
    const mid = trips[Math.floor(trips.length / 2)];
    paras.push(
      `Between spring fitting-out and autumn haul-out, the crew found a rhythm of day sails and longer rambles. Midseason, around ${fmtDate(mid.startTs)}, the bay still carried the familiar marks of buoys, current, and club colors as ${name} came and went from Atlantic Highlands.`,
    );
  }

  paras.push(
    `These adventures are reconstructed from publicly broadcast AIS positions for MMSI ${vessel.mmsi}, kept locally at the club so members may replay the season long after the sails are furled.`,
  );

  return paras;
}
