// isAuthenticated, tested on its own with fake req/res objects.
//
// app.test.ts already checks that a write without a token answers 401. What this
// file adds is the reason WHY each token is refused — in particular the forged
// ones, which no HTTP test would think to send.

import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { isAuthenticated } from "./isAuthenticated.ts";
import { TOKEN_ALGORITHM, tokenSecret } from "../config/jwt.ts";

const payload = { id: "507f1f77bcf86cd799439011", email: "joey@ramones.com", username: "joey" };

const sign = (overrides: jwt.SignOptions = {}, secret = tokenSecret()) =>
  jwt.sign(payload, secret, { algorithm: TOKEN_ALGORITHM, expiresIn: "1h", ...overrides });

// Only the three things the middleware actually touches.
const fakeRes = () => {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res;
};

const run = (authorization?: string) => {
  const req = { headers: authorization ? { authorization } : {} } as Request;
  const res = fakeRes();
  const next = vi.fn() as unknown as NextFunction;

  isAuthenticated(req, res as unknown as Response, next);
  return { req, res, next };
};

const REFUSED = { error: "Token missing or invalid." };

describe("isAuthenticated — accepted", () => {
  it("calls next and puts the payload on the request", () => {
    const { req, res, next } = run(`Bearer ${sign()}`);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0); // it answered nothing itself
    expect(req.payload).toMatchObject(payload);
  });
});

describe("isAuthenticated — refused with 401", () => {
  it.each([
    ["no Authorization header", undefined],
    ["an empty header", ""],
    ["a header with no scheme", "a-token"],
    ["the wrong scheme", "Basic am9leTpzZWNyZXQ="],
    ["a lowercase scheme", "bearer a-token"],
    ["Bearer with no token", "Bearer "],
    ["a token that is not a JWT", "Bearer not-a-jwt"],
  ])("refuses %s", (unused, authorization) => {
    const { res, next } = run(authorization);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual(REFUSED);
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses a token signed with another secret", () => {
    const { res, next } = run(`Bearer ${sign({}, "not-our-secret")}`);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses an expired token", () => {
    const { res } = run(`Bearer ${sign({ expiresIn: "-1s" })}`);
    expect(res.statusCode).toBe(401);
  });

  // The attack this protects against: an attacker re-signs the payload with
  // algorithm "none", so no secret is needed. Pinning algorithms blocks it.
  it("refuses an unsigned token claiming alg: none", () => {
    const unsigned = jwt.sign(payload, "", { algorithm: "none" });
    const { res, next } = run(`Bearer ${unsigned}`);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses a tampered payload", () => {
    const [header, body, signature] = sign().split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, id: "000000000000000000000000" }))
      .toString("base64url");

    const { res } = run(`Bearer ${header}.${forged}.${signature}`);
    expect(res.statusCode).toBe(401);
    expect(body).not.toBe(forged); // sanity check: the payload really was changed
  });

  // A 401 is an expected answer, not a server fault: it must not reach the central
  // error handler, which would turn it into a 500.
  it("never calls next(error)", () => {
    const { next } = run("Bearer not-a-jwt");
    expect(next).not.toHaveBeenCalled();
  });
});
