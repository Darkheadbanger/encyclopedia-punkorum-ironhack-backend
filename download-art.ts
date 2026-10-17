// Downloads the remote artwork once and stores it with the frontend.
// Run it with: npm run download-art
//
// Why: a coverartarchive.org URL answers 307 to archive.org, which answers 307
// again to a storage node. Three TLS handshakes for 79 KB — measured at 2.0 s
// before the first pixel appears, on every visitor's first view of a band. Served
// from the site's own origin, the same file arrives in milliseconds.
//
// The files land in the frontend's public/ folder, next to anti-cimex.jpg: that
// is what Netlify serves, so they survive a deploy. The database then holds a
// path ("/images/green-day.jpg") instead of a third-party URL.
//
// Re-running is safe: a band already pointing at a local path is skipped.
//
// NOTE: db.json still holds `null` for these bands. After a `npm run seed`, run
// `npm run backfill-art` then this script again to get the pictures back.

import "dotenv/config";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { connectToDatabase, disconnectFromDatabase } from "./db/index.ts";
import Band from "./models/Band.model.ts";

// Overridable, because the frontend lives in a sibling repository.
const PUBLIC_IMAGES = process.env.FRONTEND_IMAGES_DIR
  || "../encylopedia-punkorum-ironhack/public/images";

/** A band name turned into a file name: "Die Ärzte" -> "die-arzte".
 *
 *  A name written in another alphabet leaves nothing behind — "Гражданская
 *  оборона" produced a file called ".jpg" — so the band's id is the fallback. */
const toFileName = (name: string, fallback: string) => {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || `band-${fallback}`;
};

async function download() {
  await connectToDatabase();
  await mkdir(PUBLIC_IMAGES, { recursive: true });

  // Only the ones still pointing somewhere else than our own site.
  const bands = await Band.find({ image: /^https?:\/\// }).select("name image");
  console.log(`${bands.length} band(s) with a remote picture.`);

  let saved = 0;
  let failed = 0;
  let totalBytes = 0;

  const taken = new Set<string>();

  for (const [index, band] of bands.entries()) {
    const position = `[${index + 1}/${bands.length}]`;

    // Two bands could reduce to the same file name; the second gets a suffix.
    const base = toFileName(band.name, band._id.toString());
    let fileName = `${base}.jpg`;
    for (let suffix = 2; taken.has(fileName); suffix++) {
      fileName = `${base}-${suffix}.jpg`;
    }
    taken.add(fileName);

    try {
      const response = await fetch(band.image!, { redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(`${PUBLIC_IMAGES}/${fileName}`, bytes);

      await Band.updateOne({ _id: band._id }, { $set: { image: `/images/${fileName}` } });

      saved++;
      totalBytes += bytes.length;
      console.log(`${position} ${band.name} — ${fileName} (${Math.round(bytes.length / 1024)} Ko)`);
    } catch (error) {
      // One missing sleeve must not stop the run: the page falls back to its
      // placeholder, and the band keeps its remote URL for a later attempt.
      failed++;
      console.error(`${position} ${band.name} — failed:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`\nDone. ${saved} saved (${Math.round(totalBytes / 1024)} Ko total), ${failed} failed.`);

  const remote = await Band.countDocuments({ image: /^https?:\/\// });
  const local = await Band.countDocuments({ image: /^\/images\// });
  console.log(`${local} band(s) served from our own site, ${remote} still remote.`);

  const folder = await stat(PUBLIC_IMAGES);
  console.log(`Images in ${PUBLIC_IMAGES} (directory: ${folder.isDirectory()}).`);

  await disconnectFromDatabase();
}

download().catch(async (error: unknown) => {
  console.error("The download failed:", error instanceof Error ? error.message : error);
  await disconnectFromDatabase();
  process.exit(1);
});
