// Encyclopedia Punkorum — l'application Express.
//
// Ce fichier construit l'app mais ne la démarre jamais : server.js s'en charge, et
// les tests l'importent directement. C'est la seule raison de ce découpage.

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";
import Band from "./models/Band.model.js";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const MUSICBRAINZ_URL = "https://musicbrainz.org/ws/2";

// MusicBrainz demande un moyen de contacter le propriétaire de l'app. On ne met
// AUCUNE donnée personnelle dans le code : MB_USER_AGENT se règle dans le .env.
const USER_AGENT = process.env.MB_USER_AGENT
  || "EncyclopediaPunkorum/1.0 (student project)";

// MusicBrainz autorise environ une requête par seconde et répond 503 au-delà.
// Garder les réponses quelques minutes nous laisse loin de la limite — les groupes
// de punk des années 70 ne changent pas très souvent.
const CACHE_TTL_MS = 5 * 60 * 1000;

export function createApp({ fetchImpl = fetch } = {}) {
  const app = express();

  // Seul notre frontend peut appeler cette API. Avec cors() sans options,
  // N'IMPORTE quel site pourrait la lire depuis le navigateur d'un visiteur.
  app.use(cors({ origin: FRONTEND_URL }));
  app.use(express.json({ limit: "100kb" })); // un groupe est petit

  // Un garde-fou contre un script qui martèlerait l'API.
  app.use(rateLimit({
    windowMs: 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Trop de requêtes, merci de ralentir." },
  }));

  // --- Routes : /bands -----------------------------------------------------
  //
  // Plus de lecture/écriture de fichier, plus de file d'attente maison : MongoDB
  // gère lui-même les écritures concurrentes. Chaque route tient en trois lignes.

  app.get("/bands", async (req, res, next) => {
    try {
      // Les plus récents d'abord, comme avant.
      // _id départage les groupes créés dans la même milliseconde : sans lui,
      // l'ordre de deux créations simultanées serait arbitraire.
      res.json(await Band.find().sort({ createdAt: -1, _id: -1 }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/bands/:id", async (req, res, next) => {
    try {
      const band = await Band.findById(req.params.id);
      if (!band) return res.status(404).json({ error: "Groupe introuvable." });
      res.json(band);
    } catch (error) {
      next(error);
    }
  });

  app.post("/bands", async (req, res, next) => {
    try {
      // Le serveur possède l'id, jamais le client : on retire celui du body.
      const { id, _id, ...donnees } = req.body ?? {};
      res.status(201).json(await Band.create(donnees));
    } catch (error) {
      next(error);
    }
  });

  app.put("/bands/:id", async (req, res, next) => {
    try {
      const { id, _id, ...donnees } = req.body ?? {};
      const band = await Band.findByIdAndUpdate(req.params.id, donnees, {
        new: true,          // renvoyer le document APRÈS modification
        runValidators: true, // sinon Mongoose ne valide qu'à la création
      });
      if (!band) return res.status(404).json({ error: "Groupe introuvable." });
      res.json(band);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/bands/:id", async (req, res, next) => {
    try {
      const band = await Band.findByIdAndDelete(req.params.id);
      if (!band) return res.status(404).json({ error: "Groupe introuvable." });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  // --- Route : proxy MusicBrainz -------------------------------------------
  // Un navigateur refuse d'envoyer l'en-tête User-Agent exigé par MusicBrainz
  // (c'est un "forbidden header name"). Un serveur, lui, le peut.

  const cache = new Map(); // url -> { expiresAt, body }

  app.get("/api/mb/*path", async (req, res, next) => {
    try {
      const path = req.params.path.join("/");
      const query = new URLSearchParams(req.query).toString();
      const url = `${MUSICBRAINZ_URL}/${path}?${query}`;

      const cached = cache.get(url);
      if (cached && cached.expiresAt > Date.now()) {
        res.set("X-Cache", "HIT");
        return res.json(cached.body);
      }

      const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });

      if (!response.ok) {
        // Un 503 signifie en général qu'on a dépassé la limite. Servir une réponse
        // périmée vaut bien mieux que de ne rien montrer à l'utilisateur.
        if (cached) {
          res.set("X-Cache", "STALE");
          return res.json(cached.body);
        }
        return res.status(response.status).json({ error: "La requête MusicBrainz a échoué." });
      }

      const body = await response.json();
      cache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, body });
      res.set("X-Cache", "MISS");
      res.json(body);
    } catch (error) {
      next(error);
    }
  });

  // --- Gestion centralisée des erreurs -------------------------------------
  // Aucune route ne construit elle-même une réponse d'erreur technique : elles
  // appellent next(error) et TOUT arrive ici. Un seul endroit à lire pour savoir
  // ce que l'API renvoie quand ça se passe mal.

  app.use((req, res) => {
    res.status(404).json({ error: "Endpoint inconnu." });
  });

  app.use((error, req, res, next) => {
    // Un document refusé par le schéma Mongoose : c'est une erreur du client.
    // On renvoie le premier message de validation, lisible tel quel par le formulaire.
    if (error instanceof mongoose.Error.ValidationError) {
      const premier = Object.values(error.errors)[0];
      return res.status(400).json({ error: premier.message });
    }

    // Une conversion refusée. Deux cas très différents :
    //  - sur _id : l'URL contient un id qui n'est pas un ObjectId (/bands/bonjour).
    //    Ce n'est pas un crash, c'est juste un groupe qui n'existe pas.
    //  - sur un autre champ : le client a envoyé { name: 42 }. C'est une erreur 400.
    if (error instanceof mongoose.Error.CastError) {
      if (error.path === "_id") {
        return res.status(404).json({ error: "Groupe introuvable." });
      }
      return res.status(400).json({ error: `"${error.path}" n'est pas du bon type.` });
    }

    // Un body que express.json() n'a pas su lire : faute du client, pas du serveur.
    if (error.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Le corps de la requête n'est pas du JSON valide." });
    }
    if (error.type === "entity.too.large") {
      return res.status(413).json({ error: "Le corps de la requête est trop volumineux." });
    }

    console.error(error);
    res.status(500).json({ error: "Une erreur est survenue sur le serveur." });
  });

  return app;
}
