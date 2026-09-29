// Teaches TypeScript that isAuthenticated puts a payload on the request.

import type { TokenPayload } from "./user.ts";

declare global {
  namespace Express {
    interface Request {
      payload?: TokenPayload;
    }
  }
}

export {};
