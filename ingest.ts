// Fills the encyclopedia from MusicBrainz. Run it with: npm run ingest
//
// Idempotent and NON-DESTRUCTIVE, which is the whole point: it only inserts bands
// it does not already have, and never touches an existing one. Someone corrects a
// date through the site, this script runs again, the correction stays. Once a band
// is in the database it belongs to the site, not to MusicBrainz.
//
// MusicBrainz allows about one request per second, and each band needs a second
// call for its discography and line-up. A hundred bands therefore takes roughly
// two minutes — a script, never a web request.

import "dotenv/config";
import { connectToDatabase, disconnectFromDatabase } from "./db/index.ts";
import Band from "./models/Band.model.ts";
import {
  comparableName,
  createMusicBrainzClient,
  looksPunk,
  toBandFields,
} from "./services/musicbrainz.ts";

const DEFAULT_COUNT = 100;
const POLITE_DELAY_MS = 1100; // their limit is one request per second

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const count = Number(process.argv[2]) || DEFAULT_COUNT;

async function ingest() {
  await connectToDatabase();
  // The unique index on musicBrainzId is what guarantees no duplicate, even if two
  // runs overlap. Mongo builds it, so wait for it before writing.
  await Band.init();

  const musicBrainz = createMusicBrainzClient();

  console.log(`Asking MusicBrainz for ${count} punk bands...`);
  const artists = await musicBrainz.searchPunkBands(count);
  console.log(`${artists.length} found.`);

  let imported = 0;
  let skipped = 0;
  let rejected = 0;
  let failed = 0;

  // The bands seeded from db.json carry no MusicBrainz id, so matching on the id
  // alone would import Ramones a second time. Every existing name is loaded once
  // and compared in memory — one query instead of one per candidate.
  const known = new Set(
    (await Band.find().select("name")).map((band) => comparableName(band.name))
  );

  for (const [index, artist] of artists.entries()) {
    const position = `[${index + 1}/${artists.length}]`;

    if (known.has(comparableName(artist.name))) {
      skipped++;
      console.log(`${position} ${artist.name} — already here, left untouched`);
      continue;
    }

    try {
      // The search result has no discography, no line-up and no tag counts: this
      // is the call that gets them, and the reason the script is slow.
      await wait(POLITE_DELAY_MS);
      const full = await musicBrainz.getArtist(artist.id);

      // tag:"punk" also matches U2 and Depeche Mode. A punk encyclopedia says no.
      if (!looksPunk(full)) {
        rejected++;
        console.log(`${position} ${artist.name} — not a punk band, skipped`);
        continue;
      }

      const fields = toBandFields(full);
      // Once here rather than in every visitor's browser: the Cover Art Archive
      // address redirects twice before the file arrives.
      fields.image = await musicBrainz.resolveArtwork(fields.image);

      const band = await Band.create(fields);
      known.add(comparableName(band.name));
      imported++;
      console.log(`${position} ${band.name} — imported (${band.albums.length} release(s), ${band.members.length} member(s))`);
    } catch (error) {
      // One bad band must not end the run: log it and carry on.
      failed++;
      console.error(`${position} ${artist.name} — failed:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\nDone. ${imported} imported, ${skipped} already present, ${rejected} not punk, ${failed} failed.`);
  console.log(`${await Band.countDocuments()} bands in the database.`);

  await disconnectFromDatabase();
}

ingest().catch(async (error: unknown) => {
  console.error("The ingestion failed:", error instanceof Error ? error.message : error);
  await disconnectFromDatabase();
  process.exit(1);
});
