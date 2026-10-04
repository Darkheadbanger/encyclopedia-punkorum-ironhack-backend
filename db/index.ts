// The MongoDB connection.
//
// A single place connects to the database: server.ts calls connectToDatabase()
// BEFORE opening the port. If the database does not answer, the server does not
// start at all — that is on purpose. A server that refuses to start beats a server
// that accepts requests and answers 500 to every one of them.

import mongoose from "mongoose";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/encyclopedia-punkorum";

// Read at call time, not at import time, like tokenSecret() in config/jwt.ts.
// Reading it at import time would mean the module had to be loaded AFTER
// "dotenv/config" — an invisible ordering rule, and an untestable function.
const mongoUri = () => process.env.MONGODB_URI || DEFAULT_URI;

export async function connectToDatabase() {
  const connection = await mongoose.connect(mongoUri());
  console.log(`Connected to MongoDB: ${connection.connections[0].name}`);
  return connection;
}

export async function disconnectFromDatabase() {
  await mongoose.disconnect();
}
