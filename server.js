// Starts the Express app for real. Everything else lives in app.js, which the tests
// import without starting a server.

import { createApp } from "./app.js";

const PORT = process.env.PORT || 3001;
const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`Encyclopedia Punkorum API running on http://localhost:${PORT}`);
});

// Render (and Docker, and Ctrl+C) send SIGTERM/SIGINT and then kill the process a few
// seconds later. Closing the server first lets in-flight requests finish instead of
// being cut off mid-write.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down.`);
    server.close(() => process.exit(0));
  });
}
