// The /auth endpoints. The prefix itself is declared in app.ts.
//
// There is no /logout: the client simply drops its token. Adding one would mean
// keeping a list of revoked tokens server-side — a real feature, not a formality.

import { Router } from "express";
import * as authCtrl from "../controllers/auth.controller.ts";
import { isAuthenticated } from "../middleware/isAuthenticated.ts";

const router = Router();

router.post("/signup", authCtrl.signup);
router.post("/login", authCtrl.login);
router.get("/verify", isAuthenticated, authCtrl.verify);

export default router;
