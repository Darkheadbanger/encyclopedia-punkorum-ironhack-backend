import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "./app.ts";
import User from "./models/User.model.ts";
import Band from "./models/Band.model.ts";

const app = () => createApp();

const credentials = {
  email: "joey@ramones.com",
  password: "hey-ho-lets-go",
  username: "joey",
};

/** Signs up then logs in, and returns the token the API handed back. */
const tokenFor = async (overrides = {}) => {
  const account = { ...credentials, ...overrides };
  await request(app()).post("/auth/signup").send(account);
  const login = await request(app())
    .post("/auth/login")
    .send({ email: account.email, password: account.password });
  return login.body.authToken as string;
};

beforeEach(async () => {
  await User.deleteMany({});
  await Band.deleteMany({});
});

describe("POST /auth/signup", () => {
  it("creates an account and answers 201", async () => {
    const response = await request(app()).post("/auth/signup").send(credentials);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ email: credentials.email, username: "joey" });
    expect(response.body.id).toMatch(/^[0-9a-f]{24}$/);
  });

  it("never returns the password, hashed or not", async () => {
    const response = await request(app()).post("/auth/signup").send(credentials);

    expect(response.body).not.toHaveProperty("password");
    expect(response.text).not.toContain(credentials.password);
  });

  it("stores the password hashed, never in clear text", async () => {
    await request(app()).post("/auth/signup").send(credentials);

    const stored = await User.findOne({ email: credentials.email }).select("+password");
    expect(stored?.password).not.toBe(credentials.password);
    expect(stored?.password).toMatch(/^\$2[aby]\$/); // a bcrypt hash
  });

  it("lowercases the email", async () => {
    const response = await request(app())
      .post("/auth/signup")
      .send({ ...credentials, email: "JOEY@Ramones.COM" });

    expect(response.status).toBe(201);
    expect(response.body.email).toBe("joey@ramones.com");
  });

  it("refuses an email already taken, whatever its case", async () => {
    await request(app()).post("/auth/signup").send(credentials);

    const response = await request(app())
      .post("/auth/signup")
      .send({ ...credentials, email: "JOEY@RAMONES.COM" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });

  it.each([
    ["no body at all", {}],
    ["a missing email", { password: "hey-ho-lets-go", username: "joey" }],
    ["a malformed email", { ...credentials, email: "not-an-email" }],
    ["a missing password", { email: "a@b.com", username: "joey" }],
    ["a password under 8 characters", { ...credentials, password: "short" }],
    ["a missing username", { email: "a@b.com", password: "hey-ho-lets-go" }],
    ["an email that is not text", { ...credentials, email: 42 }],
  ])("refuses %s", async (_label, body) => {
    const response = await request(app()).post("/auth/signup").send(body);
    expect(response.status).toBe(400);
    expect(response.body.error).toBeTruthy();
  });
});

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await request(app()).post("/auth/signup").send(credentials);
  });

  it("returns a token for valid credentials", async () => {
    const response = await request(app())
      .post("/auth/login")
      .send({ email: credentials.email, password: credentials.password });

    expect(response.status).toBe(200);
    expect(typeof response.body.authToken).toBe("string");
  });

  it("signs a token holding id, email and username — and no password", async () => {
    const response = await request(app())
      .post("/auth/login")
      .send({ email: credentials.email, password: credentials.password });

    const payload = jwt.verify(response.body.authToken, process.env.TOKEN_SECRET!) as Record<string, unknown>;
    expect(payload.email).toBe(credentials.email);
    expect(payload.username).toBe("joey");
    expect(payload.id).toMatch(/^[0-9a-f]{24}$/);
    expect(payload).not.toHaveProperty("password");
    expect(payload.exp).toBeTypeOf("number"); // the token expires
  });

  it("answers 401 for a wrong password", async () => {
    const response = await request(app())
      .post("/auth/login")
      .send({ email: credentials.email, password: "wrong-password" });

    expect(response.status).toBe(401);
    expect(response.body.authToken).toBeUndefined();
  });

  it("gives the same answer for an unknown email as for a wrong password", async () => {
    const unknownEmail = await request(app())
      .post("/auth/login")
      .send({ email: "nobody@ramones.com", password: credentials.password });
    const wrongPassword = await request(app())
      .post("/auth/login")
      .send({ email: credentials.email, password: "wrong-password" });

    // Different answers would let anyone test which accounts exist.
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });
});

describe("GET /auth/verify", () => {
  it("returns the payload for a valid token", async () => {
    const token = await tokenFor();

    const response = await request(app())
      .get("/auth/verify")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(credentials.email);
  });

  it.each([
    ["no Authorization header", undefined],
    ["a header without the Bearer keyword", "just-a-token"],
    ["a token that is not a JWT", "Bearer not-a-jwt"],
    ["a token signed with another secret", `Bearer ${jwt.sign({ id: "x" }, "another-secret")}`],
  ])("answers 401 with %s", async (_label, header) => {
    const call = request(app()).get("/auth/verify");
    if (header) call.set("Authorization", header);

    expect((await call).status).toBe(401);
  });

  it("answers 401 for an expired token", async () => {
    const expired = jwt.sign({ id: "x" }, process.env.TOKEN_SECRET!, { expiresIn: "-1s" });

    const response = await request(app())
      .get("/auth/verify")
      .set("Authorization", `Bearer ${expired}`);

    expect(response.status).toBe(401);
  });
});

describe("authorization on /bands", () => {
  const newBand = { name: "Ramones", country: "US" };

  it("lets anyone read the encyclopedia", async () => {
    expect((await request(app()).get("/bands")).status).toBe(200);
  });

  it.each([
    ["POST", (server: ReturnType<typeof app>) => request(server).post("/bands").send(newBand)],
    ["PUT", (server: ReturnType<typeof app>) => request(server).put("/bands/507f1f77bcf86cd799439011").send(newBand)],
    ["DELETE", (server: ReturnType<typeof app>) => request(server).delete("/bands/507f1f77bcf86cd799439011")],
  ])("refuses %s without a token", async (_label, call) => {
    expect((await call(app())).status).toBe(401);
  });

  it("allows writing once logged in", async () => {
    const token = await tokenFor();

    const created = await request(app())
      .post("/bands")
      .set("Authorization", `Bearer ${token}`)
      .send(newBand);
    expect(created.status).toBe(201);

    const updated = await request(app())
      .put(`/bands/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "The Ramones" });
    expect(updated.status).toBe(200);

    const deleted = await request(app())
      .delete(`/bands/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleted.status).toBe(204);
  });
});
