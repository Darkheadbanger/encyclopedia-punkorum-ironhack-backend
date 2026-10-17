// Starts the Express application for real. Everything else lives in app.ts, which
// the tests import without ever opening a port.
//
// Import order matters: "dotenv/config" must run FIRST, because app.ts reads
// process.env as soon as it is loaded.

import "dotenv/config";
import { createApp } from "./app.ts";
import { tokenSecret } from "./config/jwt.ts";
import { connectToDatabase } from "./db/index.ts";

const PORT = process.env.PORT || 3001;

// Same reasoning as the database below, applied to the signing secret: tokenSecret()
// throws on use, so without this check the server would boot happily and only break
// on the first login, as a generic 500. Better to never start.
tokenSecret();

// Connect to MongoDB BEFORE opening the port. If the database does not answer the
// server does not start: a startup that fails loudly beats an API that accepts
// requests only to answer 500 to every one of them.
try {
  await connectToDatabase();
} catch (error) {
  console.error("Could not connect to MongoDB:", error instanceof Error ? error.message : error);
  process.exit(1);
}

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`Encyclopedia Punkorum API on port ${PORT}`);
  // Printed because a wrong FRONTEND_URL is invisible otherwise: the browser reports
  // a CORS error, the server reports nothing at all. One log line saves the hunt.
  console.log(`Accepting browser requests from ${process.env.FRONTEND_URL ?? "http://localhost:5173"}`);
});

// Render (and Docker, and Ctrl+C) send SIGTERM/SIGINT, then kill the process a few
// seconds later. Closing the server first lets in-flight requests finish instead of
// being cut off mid-air.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down.`);
    server.close(() => process.exit(0));
  });
}
