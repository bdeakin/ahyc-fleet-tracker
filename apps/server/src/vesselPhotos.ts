import type { VesselPhoto } from "@ahyc/shared";
import type { Db } from "./db.js";
import { getVesselProfile } from "./vesselProfiles.js";

/*
 * Photo lookup for a clicked vessel. Nothing is written to disk or SQLite: results and the
 * image bytes live in short-lived process memory only, so a restart simply looks them up again.
 *
 * Sources, best first:
 *   1. VesselFinder ship page — keyed on the MMSI itself, so no ambiguity.
 *   2. Wikidata by IMO -> Commons image — freely licensed, exact hull match.
 *   3. Commons full-text by vessel name — only when the name appears verbatim in the file title.
 */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const WIKI_UA = "AHYCFleetTracker/1.0 (+https://github.com/bdeakin/ahyc-fleet-tracker)";
const FETCH_TIMEOUT_MS = 12_000;
const IMAGE_TIMEOUT_MS = 15_000;

const HIT_TTL_MS = 12 * 60 * 60_000;
const MISS_TTL_MS = 2 * 60 * 60_000;
const ERROR_TTL_MS = 10 * 60_000;
const IMAGE_TTL_MS = 60 * 60_000;
const IMAGE_CACHE_MAX = 24;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** VesselFinder throttles bursts, and photos are only fetched on a click, so keep it slow. */
const SOURCE_MIN_GAP_MS = 1_200;

type CacheEntry = { photo: VesselPhoto; expiresAt: number };
type ImageEntry = { body: Buffer; contentType: string; expiresAt: number };

const metaCache = new Map<string, CacheEntry>();
const imageCache = new Map<string, ImageEntry>();
const inFlight = new Map<string, Promise<VesselPhoto>>();
let lastSourceFetchAt = 0;

function now(): number {
  return Date.now();
}

async function spaceOutRequests(): Promise<void> {
  const wait = lastSourceFetchAt + SOURCE_MIN_GAP_MS - now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSourceFetchAt = now();
}

async function fetchText(url: string, ua: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url, WIKI_UA)) as T;
}

function stripTags(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 160) : null;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return m ? m[1] : null;
}

async function photoFromVesselFinder(mmsi: string): Promise<VesselPhoto | null> {
  const pageUrl = `https://www.vesselfinder.com/vessels/details/${mmsi}`;
  await spaceOutRequests();
  const html = await fetchText(pageUrl, BROWSER_UA);
  const tag = html.match(/<img[^>]*class="[^"]*main-photo[^"]*"[^>]*>/i)?.[0];
  if (!tag) return null;
  const src = attr(tag, "src");
  // Ships without a contributed photo get a stock illustration from /images/.
  if (!src || !/\/ship-photo\//.test(src)) return null;
  const url = src.startsWith("//") ? `https:${src}` : src;
  return {
    mmsi,
    status: "ok",
    match: "mmsi",
    source: "VesselFinder",
    sourceUrl: pageUrl,
    credit: "Photo via VesselFinder",
    license: null,
    caption: attr(tag, "title"),
    imageUrl: url,
    fetchedAt: now(),
  };
}

type CommonsImageInfo = {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        categories?: Array<{ title?: string }>;
        imageinfo?: Array<{
          thumburl?: string;
          url?: string;
          descriptionurl?: string;
          mime?: string;
          extmetadata?: Record<string, { value?: string }>;
        }>;
      }
    >;
  };
};

type CommonsFile = {
  imageUrl: string;
  pageUrl: string;
  credit: string;
  license: string | null;
  mime: string | null;
  categories: string[];
  /** Year the picture was made, when Commons records one. */
  year: number | null;
};

async function commonsFile(fileTitle: string): Promise<CommonsFile | null> {
  const q = new URLSearchParams({
    action: "query",
    format: "json",
    titles: fileTitle.startsWith("File:") ? fileTitle : `File:${fileTitle}`,
    prop: "imageinfo|categories",
    iiprop: "url|extmetadata|mime",
    iiurlwidth: "900",
    cllimit: "40",
  });
  const data = await fetchJson<CommonsImageInfo>(`https://commons.wikimedia.org/w/api.php?${q}`);
  const page = Object.values(data.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  const raw = info?.thumburl ?? info?.url;
  if (!raw) return null;
  const meta = info?.extmetadata ?? {};
  const artist = stripTags(meta.Artist?.value) ?? "Wikimedia Commons";
  const license = stripTags(meta.LicenseShortName?.value);
  const dated = `${meta.DateTimeOriginal?.value ?? ""} ${meta.DateTime?.value ?? ""}`;
  const yearMatch = dated.match(/\b(1[89]\d\d|20\d\d)\b/);
  return {
    // The API tacks campaign params onto thumburl; they are noise for an <img> fetch.
    imageUrl: raw.split("?")[0]!,
    pageUrl: info?.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle)}`,
    credit: license ? `${artist} · ${license}` : artist,
    license,
    mime: info?.mime ?? null,
    categories: (page?.categories ?? []).map((c) => c.title ?? ""),
    year: yearMatch ? Number(yearMatch[1]) : null,
  };
}

type WikiSearch = { query?: { search?: Array<{ title?: string }> } };
type WikiClaims = {
  claims?: { P18?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> };
};

async function photoFromWikidataImo(mmsi: string, imo: string): Promise<VesselPhoto | null> {
  const search = await fetchJson<WikiSearch>(
    `https://www.wikidata.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(
      `haswbstatement:P458=${imo}`,
    )}`,
  );
  const entity = search.query?.search?.[0]?.title;
  if (!entity) return null;
  const claims = await fetchJson<WikiClaims>(
    `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&property=P18&entity=${encodeURIComponent(entity)}`,
  );
  const file = claims.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (!file) return null;
  const image = await commonsFile(file);
  if (!image) return null;
  return {
    mmsi,
    status: "ok",
    match: "imo",
    source: "Wikimedia Commons",
    sourceUrl: image.pageUrl,
    credit: image.credit,
    license: image.license,
    caption: file.replace(/\.[a-z]+$/i, "").replace(/_/g, " "),
    imageUrl: image.imageUrl,
    fetchedAt: now(),
  };
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ARTWORK_CATEGORY =
  /\b(pd-art|pd-old|paintings?|drawings?|engravings?|etchings?|lithographs?|prints?|artworks?|illustrations?|maps?|charts?|postcards?)\b/i;
const PHOTO_MIME = /^image\/(jpeg|png|webp)$/i;
/** A ship being tracked on AIS today has been photographed; anything older is another hull. */
const OLDEST_PLAUSIBLE_PHOTO_YEAR = 1970;

/**
 * A name search can land on a 19th-century painting of a different ship that happened to share
 * the name, so a name-matched file has to look like a modern photograph before it is used.
 */
function isModernPhoto(file: CommonsFile): boolean {
  if (file.mime && !PHOTO_MIME.test(file.mime)) return false;
  if (file.categories.some((c) => ARTWORK_CATEGORY.test(c))) return false;
  if (file.year == null || file.year < OLDEST_PLAUSIBLE_PHOTO_YEAR) return false;
  return true;
}

/**
 * Name search is the loosest source, so a hit only counts when the file title contains the
 * vessel name as a phrase. That keeps "PILOT AMERICA" from matching "Pilot Boat America No. 1".
 */
async function photoFromCommonsName(mmsi: string, name: string): Promise<VesselPhoto | null> {
  const wanted = normalizeName(name);
  if (wanted.length < 6 || /^\d+$/.test(wanted)) return null;
  const search = await fetchJson<WikiSearch>(
    `https://commons.wikimedia.org/w/api.php?action=query&list=search&format=json&srnamespace=6&srlimit=8&srsearch=${encodeURIComponent(
      `"${name}" ship`,
    )}`,
  );
  for (const hit of search.query?.search ?? []) {
    const title = hit.title;
    if (!title || !/\.(jpe?g|png|webp)$/i.test(title)) continue;
    if (!normalizeName(title).includes(wanted)) continue;
    // Commons is full of models, drawings and memorabilia sharing a ship's name.
    if (/\b(model|replica|miniature|plan|blueprint|drawing|painting|sketch|diagram|map|chart|logo|stamp|coin|poster|badge|plaque|memorial|lego|cake|interior|cabin|menu)\b/i.test(title)) {
      continue;
    }
    const image = await commonsFile(title);
    if (!image || !isModernPhoto(image)) continue;
    return {
      mmsi,
      status: "ok",
      match: "name",
      source: "Wikimedia Commons",
      sourceUrl: image.pageUrl,
      credit: image.credit,
      license: image.license,
      caption: title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "").replace(/_/g, " "),
      imageUrl: image.imageUrl,
      fetchedAt: now(),
    };
  }
  return null;
}

function emptyPhoto(mmsi: string, status: VesselPhoto["status"]): VesselPhoto {
  return {
    mmsi,
    status,
    match: null,
    source: null,
    sourceUrl: null,
    credit: null,
    license: null,
    caption: null,
    imageUrl: null,
    fetchedAt: now(),
  };
}

async function resolvePhoto(db: Db, mmsi: string, hintName: string | null): Promise<VesselPhoto> {
  const profile = getVesselProfile(db, mmsi);
  const name = hintName?.trim() || profile?.name?.trim() || null;

  try {
    const vf = await photoFromVesselFinder(mmsi);
    if (vf) return vf;
  } catch (err) {
    console.warn(`[vessel-photo] vesselfinder failed mmsi=${mmsi}:`, err);
  }

  if (profile?.imo) {
    try {
      const wiki = await photoFromWikidataImo(mmsi, profile.imo);
      if (wiki) return wiki;
    } catch (err) {
      console.warn(`[vessel-photo] wikidata failed mmsi=${mmsi}:`, err);
    }
  }

  if (name) {
    try {
      const commons = await photoFromCommonsName(mmsi, name);
      if (commons) return commons;
    } catch (err) {
      console.warn(`[vessel-photo] commons failed mmsi=${mmsi}:`, err);
    }
  }

  return emptyPhoto(mmsi, "none");
}

/** Look up a photo for this MMSI, memoised in process memory (never persisted). */
export async function getVesselPhoto(
  db: Db,
  mmsi: string,
  opts: { name?: string | null; refresh?: boolean } = {},
): Promise<VesselPhoto> {
  const clean = String(mmsi ?? "").trim();
  if (!/^\d{7,9}$/.test(clean)) return emptyPhoto(clean, "none");

  if (!opts.refresh) {
    const hit = metaCache.get(clean);
    if (hit && hit.expiresAt > now()) return hit.photo;
  }
  const pending = inFlight.get(clean);
  if (pending) return pending;

  const job = resolvePhoto(db, clean, opts.name ?? null)
    .catch((err) => {
      console.warn(`[vessel-photo] lookup failed mmsi=${clean}:`, err);
      return emptyPhoto(clean, "error");
    })
    .then((photo) => {
      const ttl =
        photo.status === "ok" ? HIT_TTL_MS : photo.status === "none" ? MISS_TTL_MS : ERROR_TTL_MS;
      metaCache.set(clean, { photo, expiresAt: now() + ttl });
      inFlight.delete(clean);
      return photo;
    });
  inFlight.set(clean, job);
  return job;
}

/**
 * Fetch the image bytes server-side. Going through the server keeps the kiosk on one origin
 * (no mixed content or hotlink referer surprises) and lets a few recent photos sit in memory.
 */
export async function getVesselPhotoBytes(
  db: Db,
  mmsi: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const clean = String(mmsi ?? "").trim();
  const cached = imageCache.get(clean);
  if (cached && cached.expiresAt > now()) return { body: cached.body, contentType: cached.contentType };

  const photo = await getVesselPhoto(db, clean);
  if (photo.status !== "ok" || !photo.imageUrl) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(photo.imageUrl, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": photo.source === "VesselFinder" ? BROWSER_UA : WIKI_UA,
        Accept: "image/avif,image/webp,image/jpeg,image/png,*/*",
        ...(photo.sourceUrl ? { Referer: photo.sourceUrl } : {}),
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;

    imageCache.set(clean, { body: buf, contentType, expiresAt: now() + IMAGE_TTL_MS });
    while (imageCache.size > IMAGE_CACHE_MAX) {
      const oldest = imageCache.keys().next().value;
      if (oldest == null) break;
      imageCache.delete(oldest);
    }
    return { body: buf, contentType };
  } catch (err) {
    console.warn(`[vessel-photo] image fetch failed mmsi=${clean}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
