// MusicBrainz, and the only place in this codebase that speaks its vocabulary.
//
// Nothing is ever served to a browser from here: the ingestion turns an artist into
// a Band, writes it to MongoDB, and from that point on it is one of our bands —
// editable and deletable like any other. The frontend never calls MusicBrainz.

import type { Album, Band, CreateAppOptions, Member } from "../types/index.ts";

const MUSICBRAINZ_URL = "https://musicbrainz.org/ws/2";

// MusicBrainz asks every application to identify itself. NO personal data in the
// code: MB_USER_AGENT is set in the .env.
const USER_AGENT = process.env.MB_USER_AGENT
  || "EncyclopediaPunkorum/1.0 (student project)";

// MusicBrainz allows about one request per second and answers 503 beyond that.
const RATE_LIMITED = 503;
const NOT_FOUND = 404;
const DEFAULT_RETRY_DELAY_MS = 1000;

/** The tag query used to fill the encyclopedia in bulk. */
const PUNK_QUERY = 'tag:"punk" AND type:group';

/** What a lookup must include: the discography, the line-up and the tags. */
const LOOKUP_INCLUDES = "release-groups+artist-rels+tags";

/** Raised when MusicBrainz answers something we cannot use. The routes turn it
 *  into a 404 or a 502 — never a 500, because the fault is not ours. */
export class MusicBrainzError extends Error {
  // Declared, not a constructor parameter property: Node strips types without
  // compiling, so `constructor(readonly status)` is not allowed here.
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MusicBrainzError";
    this.status = status;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- What MusicBrainz sends -------------------------------------------------
// Only the fields we actually read. MusicBrainz sends a great deal more.

export interface MusicBrainzArtist {
  id: string;
  name: string;
  country?: string;
  type?: string;
  disambiguation?: string;
  tags?: { name: string; count?: number }[];
  // `ended` is false for a band that still exists, and `end` is then absent
  "life-span"?: { begin?: string; end?: string | null; ended?: boolean | null };
  "begin-area"?: { name: string };
  relations?: {
    type: string;
    begin?: string | null;
    end?: string | null;
    attributes?: string[];
    artist?: { id?: string; name: string };
  }[];
  "release-groups"?: {
    id: string;
    title: string;
    "first-release-date"?: string;
    "primary-type"?: string;
    "secondary-types"?: string[];
  }[];
}

// --- Mapping rules ----------------------------------------------------------

/** A tag is a genre for this encyclopedia only if it reads as punk-adjacent.
 *  MusicBrainz tags are free text: "rock", "seen live", "90s" all show up.
 *  The second half of the list is the subgenres whose name says neither "punk"
 *  nor "hardcore" — crossover thrash, youth crew, deathrock — and which would
 *  otherwise be thrown away. It follows src/data/genres.ts on the frontend. */
const PUNK_TAG = new RegExp([
  "punk", "hardcore", "crust", "d-beat", "emo", "screamo", "anarcho", "oi!",
  "grindcore", "powerviolence", "thrashcore", "fastcore", "mincecore", "cybergrind",
  "metalcore", "deathcore", "mathcore", "crossover", "beatdown", "youth crew",
  "straight edge", "deathrock", "psychobilly", "riot grrrl", "queercore",
  "taqwacore", "ska",
].join("|"), "i");

/** MusicBrainz release vocabulary translated into the one the frontend filters on. */
const RELEASE_TYPES: Record<string, string> = {
  Album: "Full-length",
  EP: "EP",
  Single: "Single",
  Demo: "Demo",
  Live: "Live album",
  Compilation: "Compilation",
  Bootleg: "Bootleg",
  Split: "Split",
  Video: "Video",
};

const MEMBER_RELATION = "member of band";
const MIN_YEAR = 1900;
const MAX_GENRES = 20;

/** How far down the tag list a punk tag may sit and still count. */
const MAIN_TAGS = 3;

/** Punk-adjacent, but not punk. These read as punk to PUNK_TAG — "post-punk"
 *  contains "punk" — and they are exactly what drags U2, The Smiths and New Order
 *  into a tag search. They stay valid genre LABELS on a band that qualifies
 *  otherwise; they just cannot be what qualifies it. */
//  Anchored on the whole tag, so the punk fusions — "ska punk", "folk punk",
//  "art punk" — are unaffected.
const ADJACENT_TAGS = new RegExp(`^(${[
  "post-punk", "post-punk revival", "new wave", "no wave",
  "gothic rock", "goth rock", "pub rock", "dance-punk",
  "punk blues",      // Nick Cave
  "ska", "2 tone",   // Madness: 2 Tone ska came out of the punk scene, but is not punk
].join("|")})$`, "i");

/** A band name reduced to what two sources can be compared on.
 *
 *  db.json says "The Misfits", MusicBrainz says "Misfits". Comparing the raw
 *  strings imported the same band twice. */
export const comparableName = (name: string) =>
  name
    // "Porão" becomes "Porao" + a combining tilde, which is then dropped
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // MusicBrainz writes "Cap’n Jazz" and "blink‐182" with typographic punctuation
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, "-")
    .trim()
    .toLowerCase()
    .replace(/^(the|los|les|die|el)\s+/, "");

/** Is this really a punk band?
 *
 *  Searching MusicBrainz for tag:"punk" returns U2, Depeche Mode and The Cure: one
 *  person tagging a band is enough to match. Two conditions, both from the site's
 *  own Rules page — "the music must BE punk or hardcore, not be LABELLED punk":
 *
 *  1. a punk tag must be one of the band's MAIN tags, among the three most voted;
 *  2. that tag must be punk itself, not merely punk-adjacent.
 *
 *  A band with no tags is not punk, it is undocumented. And a purely post-punk
 *  band is not rejected from the encyclopedia — only from the automatic
 *  ingestion. Joy Division is in db.json because a human put it there. */
export const looksPunk = (artist: MusicBrainzArtist) => {
  const main = [...(artist.tags ?? [])]
    .sort((one, other) => (other.count ?? 0) - (one.count ?? 0))
    .slice(0, MAIN_TAGS);

  return main.some((tag) => PUNK_TAG.test(tag.name) && !ADJACENT_TAGS.test(tag.name.trim()));
};

/** MusicBrainz dates are "1981", "1981-05" or "1981-05-12"; the schema accepts a
 *  four-digit year and nothing else. Anything implausible is dropped rather than
 *  passed on, because one bad date would fail the whole ingestion. */
const toYear = (date?: string | null) => {
  const year = date?.slice(0, 4) ?? "";
  if (!/^\d{4}$/.test(year)) return "";
  const asNumber = Number(year);
  if (asNumber < MIN_YEAR || asNumber > new Date().getFullYear() + 1) return "";
  return year;
};

/** A member's years, as the band page prints them.
 *
 *  "1977-1984" when both are known, "1977-" while they are still in the band,
 *  and the year alone when only the end survived — joining blindly produced
 *  "-1990", which the page showed as "(-1990)". */
export const toPeriod = (begin: string, end: string) => {
  if (begin) return `${begin}-${end}`;
  return end;
};

const toGenres = (tags: MusicBrainzArtist["tags"]) => {
  const punk = (tags ?? [])
    .filter((tag) => PUNK_TAG.test(tag.name))
    // Most agreed-upon tag first: the count is how many people voted for it.
    .sort((one, other) => (other.count ?? 0) - (one.count ?? 0))
    .map((tag) => tag.name.toLowerCase().trim());

  return [...new Set(punk)].slice(0, MAX_GENRES);
};

const toAlbums = (releases: MusicBrainzArtist["release-groups"]): Album[] =>
  (releases ?? []).map((release) => {
    // A secondary type ("Live", "Demo") is more precise than the primary one.
    const raw = release["secondary-types"]?.[0] ?? release["primary-type"];
    return {
      title: release.title,
      year: toYear(release["first-release-date"]),
      type: raw ? RELEASE_TYPES[raw] ?? raw : "Unknown",
    };
  });

/** The sleeve the Cover Art Archive serves for a release group, 500px wide.
 *  Built, not requested: the archive answers 404 when it holds nothing, and the
 *  page falls back to its placeholder. Checking here would cost one HTTP call per
 *  band for a picture that may never be looked at. */
const coverArtUrl = (releaseGroupId: string) =>
  `https://coverartarchive.org/release-group/${releaseGroupId}/front-500`;

/** Every sleeve this band could be pictured by, best first: studio albums from
 *  the oldest, then everything else. A compilation sleeve is a poor portrait, but
 *  it beats no picture.
 *
 *  A list rather than one URL because the archive answers 500 or 404 for releases
 *  it holds no art for — four of the 81 bands pointed at exactly that. The caller
 *  walks the list until one answers. */
export const coverArtCandidates = (releases: MusicBrainzArtist["release-groups"]) => {
  if (!releases?.length) return [];

  const byDate = [...releases].sort((one, other) =>
    (one["first-release-date"] ?? "9999").localeCompare(other["first-release-date"] ?? "9999"));

  const isStudioAlbum = (release: (typeof byDate)[number]) =>
    release["primary-type"] === "Album" && !release["secondary-types"]?.length;

  return [...byDate.filter(isStudioAlbum), ...byDate.filter((release) => !isStudioAlbum(release))]
    .map((release) => coverArtUrl(release.id));
};

/** The quick path used at ingestion: the best candidate, unverified. */
const toImage = (releases: MusicBrainzArtist["release-groups"]) =>
  coverArtCandidates(releases)[0] ?? null;

const toMembers = (relations: MusicBrainzArtist["relations"]): Member[] =>
  (relations ?? [])
    .filter((relation) => relation.type === MEMBER_RELATION && relation.artist?.name)
    .map((relation) => ({
      name: relation.artist!.name,
      instrument: (relation.attributes ?? []).join(", "),
      // An open period means the musician is still in the band, and prints as
      // "1977-". Knowing only the end used to print "-1990", which reads as a
      // negative number rather than a missing start, so that case prints the
      // year alone. Knowing neither prints nothing at all.
      period: toPeriod(toYear(relation.begin), toYear(relation.end)),
    }));

const toStatus = (lifeSpan: MusicBrainzArtist["life-span"]) => {
  if (!lifeSpan) return "Unknown"; // MusicBrainz knows nothing: do not guess
  return lifeSpan.ended ? "Split-up" : "Active";
};

// --- The client -------------------------------------------------------------
// fetch is injected so the tests never reach the real MusicBrainz, exactly like
// createApp does. The server is the only thing that calls MusicBrainz: the browser
// talks to our API and nothing else.

export const createMusicBrainzClient = ({
  fetchImpl = fetch,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: CreateAppOptions = {}) => {
  // A 503 almost always means we were a fraction of a second too early, not that
  // MusicBrainz is down. Waiting once and asking again turns the most common
  // failure into something nobody sees. Any other status is not retried: asking
  // twice would not change a 404.
  const get = async (path: string, params: Record<string, string>) => {
    const url = `${MUSICBRAINZ_URL}/${path}?${new URLSearchParams({ ...params, fmt: "json" })}`;
    const call = () => fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });

    let response: Response;
    try {
      response = await call();
      if (response.status === RATE_LIMITED) {
        await wait(retryDelayMs);
        response = await call();
      }
    } catch (error) {
      console.error("MusicBrainz is unreachable:", error);
      throw new MusicBrainzError("MusicBrainz could not be reached.", 502);
    }

    if (response.status === NOT_FOUND) {
      throw new MusicBrainzError("MusicBrainz does not know this band.", 404);
    }
    if (!response.ok) {
      throw new MusicBrainzError("MusicBrainz refused the request.", 502);
    }

    return response.json();
  };

  return {
    /** Artists matching what someone typed. Search results carry no discography. */
    async searchArtists(query: string, limit = 25): Promise<MusicBrainzArtist[]> {
      const body = await get("artist", { query, limit: String(limit) });
      return (body as { artists?: MusicBrainzArtist[] }).artists ?? [];
    },

    /** Punk bands by tag, for the bulk ingestion. */
    async searchPunkBands(limit = 100, offset = 0): Promise<MusicBrainzArtist[]> {
      const body = await get("artist", {
        query: PUNK_QUERY,
        limit: String(limit),
        offset: String(offset),
      });
      return (body as { artists?: MusicBrainzArtist[] }).artists ?? [];
    },

    /** One artist, with everything a band page needs. */
    async getArtist(musicBrainzId: string): Promise<MusicBrainzArtist> {
      return await get(`artist/${musicBrainzId}`, { inc: LOOKUP_INCLUDES }) as MusicBrainzArtist;
    },

    /** The address the Cover Art Archive finally serves the file from.
     *
     *  coverartarchive.org answers 307 to archive.org, which answers 307 again to
     *  the storage node holding the file: three TLS handshakes before the first
     *  byte. Measured at 3.11 s, against 1.08 s for the resolved address — the
     *  same as a picture served from our own site. Following the redirects once,
     *  here, spares every visitor from following them again.
     *
     *  The resolved address names one storage node, which archive.org may one day
     *  move. If a sleeve ever stops appearing, `npm run backfill-art` resolves it
     *  again. Anything that fails returns the canonical URL untouched: a slow
     *  picture beats no picture. */
    async resolveArtwork(url: string | null): Promise<string | null> {
      if (!url) return url;

      try {
        const response = await fetchImpl(url, { method: "HEAD", redirect: "follow" });
        return response.ok && response.url ? response.url : url;
      } catch {
        return url;
      }
    },
  };
};

export type MusicBrainzClient = ReturnType<typeof createMusicBrainzClient>;

/** One MusicBrainz artist, as a Band ready to be saved. */
export const toBandFields = (artist: MusicBrainzArtist): Band => {
  const name = artist.name?.trim();
  if (!name) throw new Error("A MusicBrainz artist with no name is not a band.");

  const lifeSpan = artist["life-span"];

  return {
    name,
    source: "musicbrainz",
    musicBrainzId: artist.id,
    country: artist.country ?? "",
    location: artist["begin-area"]?.name ?? "",
    status: toStatus(lifeSpan),
    formed: toYear(lifeSpan?.begin),
    disbanded: toYear(lifeSpan?.end) || null,
    genre: toGenres(artist.tags),
    disambiguation: artist.disambiguation ?? "",
    // MusicBrainz holds no photographs; the Cover Art Archive holds the sleeves.
    image: toImage(artist["release-groups"]),
    albums: toAlbums(artist["release-groups"]),
    members: toMembers(artist.relations),
    type: artist.type ?? "Group",
    description: "",
    themes: "",
    label: "",
  };
};

/** The artist a band of ours really is, among what a search returned.
 *
 *  Used to backfill artwork for the hand-written bands. The rule is deliberately
 *  strict — the names must be equal once reduced by comparableName — because a
 *  loose match puts another band's sleeve on the page, which is worse than no
 *  picture at all. */
export const pickBestMatch = (name: string, artists: MusicBrainzArtist[]) =>
  artists.find((artist) => comparableName(artist.name) === comparableName(name));
