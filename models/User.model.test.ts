// The User schema. Two things here are security, not formatting: the password is
// hashed by the model itself, and toJSON never lets the hash out.

import { describe, it, expect, afterEach } from "vitest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "./User.model.ts";

const PLAINTEXT = "hey-ho-lets-go";

const account = (overrides: Record<string, unknown> = {}) => ({
  email: "joey@ramones.com",
  password: PLAINTEXT,
  username: "joey",
  ...overrides,
});

const errorsOf = async (fields: Record<string, unknown>) => {
  try {
    await new User(fields).validate();
    return {} as mongoose.Error.ValidationError["errors"];
  } catch (error) {
    return (error as mongoose.Error.ValidationError).errors;
  }
};

afterEach(async () => {
  await User.deleteMany({});
});

describe("User schema — validation", () => {
  it("accepts a complete account", async () => {
    expect(await errorsOf(account())).toEqual({});
  });

  it.each(["email", "password", "username"])("refuses an account with no %s", async (field) => {
    const fields = account();
    delete (fields as Record<string, unknown>)[field];
    expect((await errorsOf(fields))[field]).toBeDefined();
  });

  it.each([
    "joey",
    "joey@",
    "@ramones.com",
    "joey@ramones",
    "joey ramone@ramones.com",
  ])("refuses %s as an email", async (email) => {
    expect((await errorsOf(account({ email }))).email?.message).toBe("This email is not valid.");
  });

  it("refuses a password shorter than 8 characters", async () => {
    const errors = await errorsOf(account({ password: "1234567" }));
    expect(errors.password?.message).toMatch(/at least 8 characters/);
  });

  // The rule only means something if it applies to what the user typed: the hash
  // is always 60 characters, so validating it would check nothing.
  it("applies the length rule to the typed password, not to the hash", async () => {
    await expect(new User(account({ password: "short" })).save()).rejects.toThrow(/at least 8/);
  });

  it("lowercases and trims the email, so Joey@ and joey@ are one account", () => {
    expect(new User(account({ email: "  JOEY@Ramones.com " })).email).toBe("joey@ramones.com");
  });
});

describe("User schema — password hashing", () => {
  it("never stores the password in clear text", async () => {
    const user = await new User(account()).save();

    expect(user.password).not.toBe(PLAINTEXT);
    expect(user.password).toMatch(/^\$2[aby]\$/); // a bcrypt hash
    expect(await bcrypt.compare(PLAINTEXT, user.password)).toBe(true);
  });

  // Without the isModified check, saving any other field would hash the hash, and
  // the account could never log in again.
  it("does not hash the hash when another field changes", async () => {
    const user = await new User(account()).save();
    const hash = user.password;

    user.username = "joey-r";
    await user.save();

    expect(user.password).toBe(hash);
    expect(await bcrypt.compare(PLAINTEXT, user.password)).toBe(true);
  });

  it("hashes again when the password really changes", async () => {
    const user = await new User(account()).save();
    const firstHash = user.password;

    user.password = "sheena-is-a-punk-rocker";
    await user.save();

    expect(user.password).not.toBe(firstHash);
    expect(await bcrypt.compare("sheena-is-a-punk-rocker", user.password)).toBe(true);
  });
});

describe("User schema — toJSON", () => {
  it("strips the password, even if a route forgets to", async () => {
    const user = await new User(account()).save();
    const json = user.toJSON() as unknown as Record<string, unknown>;

    expect(json.password).toBeUndefined();
    expect(json.id).toBe(user._id.toString());
    expect(json._id).toBeUndefined();
    expect(json.__v).toBeUndefined();
    expect(json.email).toBe("joey@ramones.com");
  });

  it("survives JSON.stringify, which is what res.json() actually calls", async () => {
    const user = await new User(account()).save();
    expect(JSON.stringify(user)).not.toContain("$2");
  });
});

describe("User schema — unique email", () => {
  it("refuses a second account with the same email", async () => {
    // The unique index is built by Mongo, not by a validator: without this wait the
    // test would pass even if the index were missing.
    await User.init();
    await new User(account()).save();

    await expect(new User(account({ username: "other" })).save())
      .rejects.toMatchObject({ code: 11000 });
  });
});
