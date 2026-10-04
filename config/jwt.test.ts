// The token configuration. Three lines of code, but each one is a decision that
// would be expensive to get wrong.

import { describe, it, expect, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import { TOKEN_ALGORITHM, TOKEN_EXPIRES_IN, tokenSecret } from "./jwt.ts";

const original = process.env.TOKEN_SECRET;

afterEach(() => {
  process.env.TOKEN_SECRET = original;
});

describe("token configuration", () => {
  it("pins a symmetric algorithm", () => {
    expect(TOKEN_ALGORITHM).toBe("HS256");
  });

  // jsonwebtoken only understands English units. "7j" would be read as a number of
  // milliseconds, giving a token that expires 7 milliseconds after being issued.
  it("expresses the lifetime in a unit jsonwebtoken understands", () => {
    expect(TOKEN_EXPIRES_IN).toBe("7d");

    const token = jwt.sign({}, "a-secret", { expiresIn: TOKEN_EXPIRES_IN });
    const { exp, iat } = jwt.decode(token) as { exp: number; iat: number };

    expect(exp - iat).toBe(7 * 24 * 60 * 60);
  });
});

describe("tokenSecret", () => {
  it("returns the secret from the environment", () => {
    process.env.TOKEN_SECRET = "a-secret";
    expect(tokenSecret()).toBe("a-secret");
  });

  // Read at call time, not at import time: a missing secret fails loudly on the
  // first signature instead of crashing the whole module graph on startup.
  it("throws when the secret is missing", () => {
    delete process.env.TOKEN_SECRET;
    expect(() => tokenSecret()).toThrow(/TOKEN_SECRET is missing/);
  });

  it("throws when the secret is an empty string", () => {
    process.env.TOKEN_SECRET = "";
    expect(() => tokenSecret()).toThrow(/TOKEN_SECRET is missing/);
  });
});
