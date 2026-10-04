// The /bands endpoints. The prefix itself is declared in app.ts.
//
// Reading is public — an encyclopedia is meant to be consulted. Writing requires
// an account, and so does searching MusicBrainz, because that costs an external
// call on someone else's servers.
//
// A factory, not a ready-made router: the MusicBrainz client is injected, which is
// how the tests answer for MusicBrainz without touching the network.

import { Router } from "express";
import * as bandCtrl from "../controllers/band.controller.ts";
import { createIngestController } from "../controllers/ingest.controller.ts";
import { isAuthenticated } from "../middleware/isAuthenticated.ts";
import type { MusicBrainzClient } from "../services/musicbrainz.ts";

export const createBandRouter = (musicBrainz: MusicBrainzClient) => {
  const router = Router();
  const ingestCtrl = createIngestController(musicBrainz);

  // Before "/:id", or Express reads "upstream" as a band id.
  router.get("/upstream", isAuthenticated, ingestCtrl.searchUpstream);
  router.post("/import", isAuthenticated, ingestCtrl.importBand);

  router.get("/", bandCtrl.getAllBands);
  router.get("/:id", bandCtrl.getOneBand);

  router.post("/", isAuthenticated, bandCtrl.createBand);
  router.put("/:id", isAuthenticated, bandCtrl.modifyBand);
  router.delete("/:id", isAuthenticated, bandCtrl.deleteBand);

  return router;
};
