// Moves the bands from db.json into MongoDB. Run it with: npm run seed
//
// The script empties the collection first, so running it twice does not create
// duplicates. db.json is the source data, not a database: the API never reads it.

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { connectToDatabase, disconnectFromDatabase } from "./db/index.ts";
import Band from "./models/Band.model.ts";
import type { BandFromJsonFile } from "./types/index.ts";

const file = new URL("./db.json", import.meta.url);

async function seed() {
  await connectToDatabase();

  const { bands }: { bands: BandFromJsonFile[] } = JSON.parse(await readFile(file, "utf8"));

  // "id", "source" and "editable" belong to the frontend, not to the database.
  const toInsert = bands.map(({ id, source, editable, ...band }) => band);

  const deleted = await Band.deleteMany({});
  console.log(`${deleted.deletedCount} band(s) deleted.`);

  const created = await Band.insertMany(toInsert);
  console.log(`${created.length} band(s) imported into MongoDB.`);

  await disconnectFromDatabase();
}

seed().catch(async (error: unknown) => {
  console.error("The seed failed:", error instanceof Error ? error.message : error);
  await disconnectFromDatabase();
  process.exit(1);
});
