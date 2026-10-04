// strict-types.ts has no exports: it changes Mongoose globally. The only way to
// test it is to declare a throwaway schema and watch what Mongoose does with a
// wrong type.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import "./strict-types.ts";

// A model name no other test uses, registered once for this file.
const Throwaway = mongoose.model(
  "StrictTypesProbe",
  new mongoose.Schema({ text: String, count: Number, flag: Boolean }),
);

const errorFor = async (fields: Record<string, unknown>) => {
  try {
    await new Throwaway(fields).validate();
    return null;
  } catch (error) {
    return error as mongoose.Error.ValidationError;
  }
};

describe("global Mongoose strictness", () => {
  // Default Mongoose would store the string "42" here. An API that silently
  // rewrites what it is sent also silently accepts the frontend's typos.
  it("refuses a number for a String field instead of casting it", async () => {
    const error = await errorFor({ text: 42 });
    expect(error?.errors.text).toBeDefined();
  });

  it("refuses a string for a Number field", async () => {
    const error = await errorFor({ count: "12" });
    expect(error?.errors.count).toBeDefined();
  });

  it("refuses a string for a Boolean field", async () => {
    const error = await errorFor({ flag: "true" });
    expect(error?.errors.flag).toBeDefined();
  });

  it("still accepts the right types", async () => {
    expect(await errorFor({ text: "punk", count: 1977, flag: true })).toBeNull();
  });

  // The failure is a ValidationError, which is what makes the central handler
  // answer 400 instead of 500.
  it("fails with a ValidationError, so the API answers 400", async () => {
    const error = await errorFor({ text: 42 });
    expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
  });
});
