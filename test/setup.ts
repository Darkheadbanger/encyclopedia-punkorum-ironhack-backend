// Shared test harness: a real MongoDB, started in memory.
//
// Schema validation, ObjectId casting and query behaviour are therefore the genuine
// ones — the database layer is never mocked.

import { beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// Tests never use the real signing secret.
process.env.TOKEN_SECRET ??= "test-secret-not-used-anywhere-else";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120_000); // the very first run downloads the mongod binary

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
