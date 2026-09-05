import type { VesselProfile } from "@ahyc/shared";
import type { Db } from "./db.js";

const USER_AGENT = "AHYCFleetTracker/1.0 (+https://github.com/bdeakin/ahyc-fleet-tracker)";
const ERROR_RETRY_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;

type ProfileRow = {
  mmsi: string;
  name: string | null;
  flag: string | null;
  callsign: string | null;
  imo: string | null;
  vessel_type: string | null;
  length_m: number | null;
  beam_m: number | null;
  source: string | null;
  source_url: string | null;
  status: string;
  error: string | null;
  scraped_at: number | null;
};

type ScrapedFields = {
  name: string | null;
  flag: string | null;
  callsign: string | null;
  imo: string | null;
  vesselType: string | null;
  lengthM: number | null;
  beamM: number | null;
  source: string;
  sourceUrl: string;
};

function rowToProfile(row: ProfileRow): VesselProfile {
  const status: VesselProfile["status"] =
    row.status === "ok" ||
    row.status === "not_found" ||
    row.status === "error" ||
    row.status === "pending"
      ? row.status
      : "error";
  return {
    mmsi: row.mmsi,
    name: row.name,
    flag: row.flag,
    callsign: row.callsign,
    imo: row.imo,
    vesselType: row.vessel_type,
    lengthM: row.length_m,
    beamM: row.beam_m,
    source: row.source,
    sourceUrl: row.source_url,
    status,
    error: row.error,
    scrapedAt: row.scraped_at,
  };
}

function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t === "-" || t === "—" || t.toLowerCase() === "n/a" || t.toLowerCase() === "none") {
    return null;
  }
  return t.slice(0, 128);
}

function parseLengthBeam(raw: string | null): { lengthM: number | null; beamM: number | null } {
  if (!raw) return { lengthM: null, beamM: null };
  const m = raw.match(/([\d.]+)\s*(?:\/|x|×)\s*([\d.]+)/i);
  if (!m) return { lengthM: null, beamM: null };
  const lengthM = Number(m[1]);
  const beamM = Number(m[2]);
  return {
    lengthM: Number.isFinite(lengthM) ? lengthM : null,
    beamM: Number.isFinite(beamM) ? beamM : null,
  };
}

function extractPairs(html: string): Map<string, string> {
  const pairs = new Map<string, string>();
  const re =
    /<td class="n3">\s*([^<]+?)\s*<\/td>\s*<td class="v3"[^>]*>\s*([\s\S]*?)\s*<\/td>/gi;
  for (const m of html.matchAll(re)) {
    const key = cleanText(m[1]);
    const value = cleanText(m[2]);
    if (key && value) pairs.set(key.toLowerCase(), value);
  }
  return pairs;
}

function extractTitleName(html: string): string | null {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) {
    const name = cleanText(h1[1]);
    if (name) return name;
  }
  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!title) return null;
  const raw = cleanText(title[1]);
  if (!raw) return null;
  return (raw.split(",")[0]?.trim() || null)?.slice(0, 64) ?? null;
}

async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeVesselFinder(mmsi: string): Promise<ScrapedFields | null> {
  const sourceUrl = `https://www.vesselfinder.com/vessels/details/${mmsi}`;
  const html = await fetchHtml(sourceUrl);
  if (/captcha|cf-browser-verification|access denied/i.test(html) && html.length < 5000) {
    throw new Error("blocked_by_source");
  }
  const pairs = extractPairs(html);
  const dims = parseLengthBeam(pairs.get("length / beam") ?? pairs.get("length/beam") ?? null);
  const name = extractTitleName(html);
  const vesselType = pairs.get("ais type") ?? pairs.get("ship type") ?? null;
  const flag = pairs.get("ais flag") ?? pairs.get("flag") ?? null;
  const callsign = pairs.get("callsign") ?? pairs.get("call sign") ?? null;
  const imoRaw = pairs.get("imo") ?? null;
  const imo = imoRaw && /^\d{7}$/.test(imoRaw) ? imoRaw : null;

  if (!name && !vesselType && !flag && !dims.lengthM) return null;
  return {
    name,
    flag,
    callsign,
    imo,
    vesselType,
    lengthM: dims.lengthM,
    beamM: dims.beamM,
    source: "vesselfinder",
    sourceUrl,
  };
}

async function scrapeMyShipTracking(mmsi: string): Promise<ScrapedFields | null> {
  const sourceUrl = `https://www.myshiptracking.com/vessels/mmsi-${mmsi}`;
  const html = await fetchHtml(sourceUrl);
  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  const desc = html.match(/property="og:description"\s+content="([^"]+)"/i);
  const titleText = title ? cleanText(title[1]) : null;
  let name: string | null = null;
  let vesselType: string | null = null;
  if (titleText) {
    const m = titleText.match(/^(.+?)\s*-\s*(.+?)\s*\(MMSI/i);
    if (m) {
      name = cleanText(m[1]);
      vesselType = cleanText(m[2]);
    }
  }
  let flag: string | null = null;
  const blob = `${desc?.[1] ?? ""} ${titleText ?? ""}`;
  const flagMatch = blob.match(/\[([A-Z]{2})\]\s+([A-Za-z ]+)/);
  if (flagMatch) flag = cleanText(flagMatch[2]);
  if (!name && !vesselType && !flag) return null;
  return {
    name,
    flag,
    callsign: null,
    imo: null,
    vesselType,
    lengthM: null,
    beamM: null,
    source: "myshiptracking",
    sourceUrl,
  };
}

export function getVesselProfile(db: Db, mmsi: string): VesselProfile | null {
  try {
    const row = db.prepare("SELECT * FROM vessel_profiles WHERE mmsi = ?").get(mmsi) as
      | ProfileRow
      | undefined;
    return row ? rowToProfile(row) : null;
  } catch {
    return null;
  }
}

function upsertPending(db: Db, mmsi: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO vessel_profiles (mmsi, status, created_at, updated_at)
     VALUES (?, 'pending', ?, ?)
     ON CONFLICT(mmsi) DO UPDATE SET
       status = CASE
         WHEN vessel_profiles.status = 'ok' THEN vessel_profiles.status
         ELSE 'pending'
       END,
       error = NULL,
       updated_at = excluded.updated_at`,
  ).run(mmsi, now, now);
}

function saveProfile(
  db: Db,
  mmsi: string,
  data: ScrapedFields | null,
  status: VesselProfile["status"],
  error: string | null,
): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO vessel_profiles (
       mmsi, name, flag, callsign, imo, vessel_type, length_m, beam_m,
       source, source_url, status, error, scraped_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mmsi) DO UPDATE SET
       name = excluded.name,
       flag = excluded.flag,
       callsign = excluded.callsign,
       imo = excluded.imo,
       vessel_type = excluded.vessel_type,
       length_m = excluded.length_m,
       beam_m = excluded.beam_m,
       source = excluded.source,
       source_url = excluded.source_url,
       status = excluded.status,
       error = excluded.error,
       scraped_at = excluded.scraped_at,
       updated_at = excluded.updated_at`,
  ).run(
    mmsi,
    data?.name ?? null,
    data?.flag ?? null,
    data?.callsign ?? null,
    data?.imo ?? null,
    data?.vesselType ?? null,
    data?.lengthM ?? null,
    data?.beamM ?? null,
    data?.source ?? null,
    data?.sourceUrl ?? null,
    status,
    error,
    now,
    now,
    now,
  );

  if (data?.name) {
    try {
      db.prepare(
        `INSERT INTO traffic_names (mmsi, name, ship_type, updated_at)
         VALUES (?, ?, NULL, ?)
         ON CONFLICT(mmsi) DO UPDATE SET
           name = CASE
             WHEN traffic_names.name IS NULL OR traffic_names.name = traffic_names.mmsi
               THEN excluded.name
             ELSE traffic_names.name
           END,
           updated_at = excluded.updated_at`,
      ).run(mmsi, data.name, now);
    } catch {
      /* optional enrichment */
    }
  }
}

/** Queue a scrape for a newly seen MMSI; skip if already cached successfully. */
export function ensureVesselProfileQueued(db: Db, mmsi: string): void {
  const clean = String(mmsi ?? "").trim();
  if (!/^\d{9}$/.test(clean)) return;

  try {
    const existing = getVesselProfile(db, clean);
    if (!existing) {
      upsertPending(db, clean);
      return;
    }
    if (existing.status === "ok" || existing.status === "not_found" || existing.status === "pending") {
      return;
    }
    if (existing.status === "error") {
      const age = Date.now() - (existing.scrapedAt ?? 0);
      if (age >= ERROR_RETRY_MS) upsertPending(db, clean);
    }
  } catch (err) {
    console.warn("[vessel-profile] queue failed", err);
  }
}

export async function scrapeAndStoreProfile(db: Db, mmsi: string): Promise<VesselProfile> {
  try {
    let data: ScrapedFields | null = null;
    try {
      data = await scrapeVesselFinder(mmsi);
    } catch (err) {
      console.warn(`[vessel-profile] VesselFinder failed mmsi=${mmsi}:`, err);
    }
    if (!data) {
      try {
        data = await scrapeMyShipTracking(mmsi);
      } catch (err) {
        console.warn(`[vessel-profile] MyShipTracking failed mmsi=${mmsi}:`, err);
      }
    }
    if (!data) {
      saveProfile(db, mmsi, null, "not_found", "no_public_record");
    } else {
      saveProfile(db, mmsi, data, "ok", null);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    saveProfile(db, mmsi, null, "error", message.slice(0, 240));
  }

  return (
    getVesselProfile(db, mmsi) ?? {
      mmsi,
      name: null,
      flag: null,
      callsign: null,
      imo: null,
      vesselType: null,
      lengthM: null,
      beamM: null,
      source: null,
      sourceUrl: null,
      status: "error",
      error: "missing_row",
      scrapedAt: Date.now(),
    }
  );
}

let workerStarted = false;
let busy = false;

async function processQueue(db: Db): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const pending = db
      .prepare(
        `SELECT mmsi FROM vessel_profiles
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 3`,
      )
      .all() as Array<{ mmsi: string }>;
    for (const row of pending) {
      console.log(`[vessel-profile] scraping mmsi=${row.mmsi}`);
      await scrapeAndStoreProfile(db, row.mmsi);
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    busy = false;
  }
}

export function startVesselProfileWorker(getDatabase: () => Db): void {
  if (workerStarted) return;
  workerStarted = true;
  const tick = () => {
    try {
      void processQueue(getDatabase());
    } catch (err) {
      console.warn("[vessel-profile] worker tick failed", err);
    }
  };
  tick();
  setInterval(tick, 8_000);
}
