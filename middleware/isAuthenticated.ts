// Rejects any request without a valid token, and hands the payload to the routes.
//
// A 401 is an expected outcome, not a failure: this middleware answers directly
// instead of calling next(error).

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { TOKEN_ALGORITHM, tokenSecret } from "../config/jwt.ts";
import type { TokenPayload } from "../types/index.ts";

const BEARER = "Bearer ";

export const isAuthenticated = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith(BEARER)) {
    res.status(401).json({ error: "Token missing or invalid." });
    return;
  }

  try {
    // Pinning the algorithm blocks the "alg: none" and HS/RS confusion attacks.
    req.payload = jwt.verify(header.slice(BEARER.length), tokenSecret(), {
      algorithms: [TOKEN_ALGORITHM],
    }) as TokenPayload;
    next();
  } catch {
    // Malformed, tampered with, expired, or signed by someone else.
    res.status(401).json({ error: "Token missing or invalid." });
  }
};
