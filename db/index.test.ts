// connectToDatabase / disconnectFromDatabase.
//
// test/setup.ts has already connected Mongoose to its own in-memory server, so this
// file disconnects first, runs against a server of its own, and leaves Mongoose
// disconnected — which setup.ts handles fine.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectToDatabase, disconnectFromDatabase } from "./index.ts";

const DISCONNECTED = 0;
const CONNECTED = 1;

const originalUri = process.env.MONGODB_URI;
let mongo: MongoMemoryServer;

beforeAll(async () => {
  await mongoose.disconnect(); // drop the connection test/setup.ts opened
  mongo = await MongoMemoryServer.create();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  process.env.MONGODB_URI = originalUri;
});

describe("connectToDatabase", () => {
  it("connects to the database named in MONGODB_URI", async () => {
    process.env.MONGODB_URI = `${mongo.getUri()}encyclopedia-punkorum-probe`;

    const connection = await connectToDatabase();

    expect(mongoose.connection.readyState).toBe(CONNECTED);
    expect(connection.connections[0].name).toBe("encyclopedia-punkorum-probe");
  });

  // The log is the only feedback at startup that the right database was reached —
  // this is what caught the URI with no database name, which silently wrote to "test".
  it("logs the database it reached", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.MONGODB_URI = `${mongo.getUri()}encyclopedia-punkorum-probe`;

    await connectToDatabase();

    expect(log).toHaveBeenCalledWith(expect.stringContaining("encyclopedia-punkorum-probe"));
    log.mockRestore();
  });

  it("rejects when the server cannot be reached, so server.ts can refuse to start", async () => {
    await mongoose.disconnect();
    // Port 1 is never a MongoDB. The timeout goes in the URI because that is the
    // only place this module takes options from; the default is 30 seconds.
    process.env.MONGODB_URI = "mongodb://127.0.0.1:1/probe?serverSelectionTimeoutMS=300";

    await expect(connectToDatabase()).rejects.toThrow();
  });
});

describe("disconnectFromDatabase", () => {
  it("closes the connection", async () => {
    process.env.MONGODB_URI = mongo.getUri();
    await connectToDatabase();
    expect(mongoose.connection.readyState).toBe(CONNECTED);

    await disconnectFromDatabase();

    expect(mongoose.connection.readyState).toBe(DISCONNECTED);
  });

  // seed.ts calls it in its catch block, where the connection may never have opened.
  it("does not throw when there is nothing to close", async () => {
    await disconnectFromDatabase();
    await expect(disconnectFromDatabase()).resolves.toBeUndefined();
  });
});
