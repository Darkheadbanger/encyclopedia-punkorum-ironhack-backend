// Démarre l'application Express pour de vrai. Tout le reste vit dans app.js, que
// les tests importent sans jamais ouvrir de port.
//
// L'ordre des imports compte : "dotenv/config" doit s'exécuter EN PREMIER, car
// app.js lit process.env dès son chargement.

import "dotenv/config";
import { createApp } from "./app.js";
import { connectToDatabase } from "./db/index.js";

const PORT = process.env.PORT || 3001;

// On se connecte à MongoDB AVANT d'ouvrir le port. Si la base ne répond pas, le
// serveur ne démarre pas : mieux vaut un démarrage qui échoue franchement qu'une
// API qui accepte les requêtes pour renvoyer une erreur 500 à chacune.
try {
  await connectToDatabase();
} catch (erreur) {
  console.error("Impossible de se connecter à MongoDB :", erreur.message);
  process.exit(1);
}

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`API Encyclopedia Punkorum sur http://localhost:${PORT}`);
});

// Render (et Docker, et Ctrl+C) envoient SIGTERM/SIGINT puis tuent le processus
// quelques secondes plus tard. Fermer le serveur d'abord laisse les requêtes en
// cours se terminer au lieu d'être coupées en plein vol.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} reçu, arrêt en cours.`);
    server.close(() => process.exit(0));
  });
}
