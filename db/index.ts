// La connexion à MongoDB.
//
// Un seul endroit se connecte à la base : server.ts appelle connectToDatabase()
// AVANT d'ouvrir le port. Si la base ne répond pas, le serveur ne démarre pas du
// tout — c'est voulu. Mieux vaut un serveur qui refuse de démarrer qu'un serveur
// qui accepte des requêtes et renvoie une erreur 500 à chacune.

import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI
  || "mongodb://127.0.0.1:27017/encyclopedia-punkorum";

export async function connectToDatabase() {
  const connection = await mongoose.connect(MONGODB_URI);
  console.log(`Connecté à MongoDB : ${connection.connections[0].name}`);
  return connection;
}

export async function disconnectFromDatabase() {
  await mongoose.disconnect();
}
