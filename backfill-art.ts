// Finds artwork for the bands that have none. Run it with: npm run backfill-art
//
// The hand-written bands from db.json carry no picture: MusicBrainz is asked for
// each of them by name, and the Cover Art Archive URL of its first album is stored.
//
// NON-DESTRUCTIVE, and narrower than the ingestion: it writes ONE field, `image`,
// and only on a band where it is still empty. Nothing else about the band is read
// from MusicBrainz, so a correction made on the site survives this script. A name
// that does not match exactly is left alone — another band's sleeve is worse than
// no sleeve.

import "dotenv/config";
import { connectToDatabase, disconnectFromDatabase } from "./db/index.ts";
import Band from "./models/Band.model.ts";
import {
  coverArtCandidates,
  createMusicBrainzClient,
  pickBestMatch,
} from "./services/musicbrainz.ts";

const POLITE_DELAY_MS = 1100; // MusicBrainz allows about one request per second
const SEARCH_LIMIT = 10;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The first sleeve the archive actually holds, as the address it finally serves
 *  the file from.
 *
 *  The Cover Art Archive answers 404 — and sometimes 500 — for a release it has
 *  no art for, so the best candidate is not always available. Asking before
 *  storing the URL is what keeps a broken picture off the page.
 *
 *  The probe already follows the two redirects, so keeping response.url costs
 *  nothing and spares every visitor from following them again — 3.11 s against
 *  1.08 s, measured. See resolveArtwork() in services/musicbrainz.ts. */
const firstAvailable = async (urls: string[]) => {
  for (const url of urls) {
    try {
      const response = await fetch(url, { method: "HEAD", redirect: "follow" });
      if (response.ok) return response.url || url;
    } catch {
      // Network hiccup on this one: try the next release.
    }
  }
  return null;
};

async function backfill() {
  await connectToDatabase();

  const musicBrainz = createMusicBrainzClient();
  const bands = await Band.find({ $or: [{ image: null }, { image: "" }] }).select("name");
  console.log(`${bands.length} band(s) without a picture.`);

  let found = 0;
  let unmatched = 0;
  let noArt = 0;
  let failed = 0;

  for (const [index, band] of bands.entries()) {
    const position = `[${index + 1}/${bands.length}]`;

    try {
      await wait(POLITE_DELAY_MS);
      const candidates = await musicBrainz.searchArtists(band.name, SEARCH_LIMIT);
      const match = pickBestMatch(band.name, candidates);

      if (!match) {
        unmatched++;
        console.log(`${position} ${band.name} — no exact match on MusicBrainz, left alone`);
        continue;
      }

      await wait(POLITE_DELAY_MS);
      const artist = await musicBrainz.getArtist(match.id);
      // Every release, best first, until the archive answers for one of them.
      const image = await firstAvailable(coverArtCandidates(artist["release-groups"]));

      if (!image) {
        noArt++;
        console.log(`${position} ${band.name} — matched, but no sleeve in the archive`);
        continue;
      }

      // One field, by id: no validation of the rest, nothing else overwritten.
      await Band.updateOne({ _id: band._id }, { $set: { image } });
      found++;
      console.log(`${position} ${band.name} — artwork found`);
    } catch (error) {
      failed++;
      console.error(`${position} ${band.name} — failed:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\nDone. ${found} with artwork, ${unmatched} unmatched, ${noArt} without a release, ${failed} failed.`);
  console.log(`${await Band.countDocuments({ image: { $nin: [null, ""] } })} of ${await Band.countDocuments()} bands now have a picture.`);

  await disconnectFromDatabase();
}

backfill().catch(async (error: unknown) => {
  console.error("The backfill failed:", error instanceof Error ? error.message : error);
  await disconnectFromDatabase();
  process.exit(1);
});
