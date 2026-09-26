// Transfère les groupes de db.json vers MongoDB. À lancer UNE fois : npm run seed
//
// Le script vide d'abord la collection, pour qu'un deuxième lancement ne crée pas
// 16 doublons. Les anciens id (des UUID) sont abandonnés : Mongo génère ses propres
// _id, et le frontend ne connaît de toute façon que les id renvoyés par l'API.

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { connectToDatabase, disconnectFromDatabase } from "./db/index.js";
import Band from "./models/Band.model.js";

const fichier = new URL("./db.json", import.meta.url);

async function seed() {
  await connectToDatabase();

  const { bands } = JSON.parse(await readFile(fichier, "utf8"));

  // "id", "source" et "editable" appartiennent au frontend, pas à la base.
  const aInserer = bands.map(({ id, source, editable, ...groupe }) => groupe);

  const supprimes = await Band.deleteMany({});
  console.log(`${supprimes.deletedCount} groupe(s) supprimé(s).`);

  const crees = await Band.insertMany(aInserer);
  console.log(`${crees.length} groupe(s) importé(s) dans MongoDB.`);

  await disconnectFromDatabase();
}

seed().catch(async (erreur) => {
  console.error("Le seed a échoué :", erreur.message);
  await disconnectFromDatabase();
  process.exit(1);
});
