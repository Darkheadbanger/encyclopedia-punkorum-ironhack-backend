// Single source of truth for token signing. The secret is read at call time, never
// at import time, so a missing one fails loudly on use rather than silently.

export const TOKEN_ALGORITHM = "HS256" as const;

// jsonwebtoken only understands English units: "7d", not "7j".
export const TOKEN_EXPIRES_IN = "7d";

export const tokenSecret = () => {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) throw new Error("TOKEN_SECRET is missing from the environment.");
  return secret;
};
