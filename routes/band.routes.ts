// The /bands endpoints. The prefix itself is declared in app.ts.
//
// Reading is public — an encyclopedia is meant to be consulted. Writing requires
// an account.

import { Router } from "express";
import * as bandCtrl from "../controllers/band.controller.ts";
import { isAuthenticated } from "../middleware/isAuthenticated.ts";

const router = Router();

router.get("/", bandCtrl.getAllBands);
router.get("/:id", bandCtrl.getOneBand);

router.post("/", isAuthenticated, bandCtrl.createBand);
router.put("/:id", isAuthenticated, bandCtrl.modifyBand);
router.delete("/:id", isAuthenticated, bandCtrl.deleteBand);

export default router;
