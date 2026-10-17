// The /reviews endpoints. The prefix itself is declared in app.ts.
//
// Reading is public, like the bands: an encyclopedia is meant to be consulted.
// Writing requires an account. Changing or deleting one requires being its
// author — that second check lives in the controller, because it needs the
// document itself, which a middleware would have to load a second time.

import { Router } from "express";
import * as reviewCtrl from "../controllers/review.controller.ts";
import { isAuthenticated } from "../middleware/isAuthenticated.ts";

const router = Router();

router.get("/", reviewCtrl.getAllReviews);
router.get("/:id", reviewCtrl.getOneReview);

router.post("/", isAuthenticated, reviewCtrl.createReview);
router.put("/:id", isAuthenticated, reviewCtrl.modifyReview);
router.delete("/:id", isAuthenticated, reviewCtrl.deleteReview);

export default router;
