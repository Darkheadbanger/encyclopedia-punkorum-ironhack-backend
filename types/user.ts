// The types of a user account.

export interface User {
  email: string;
  password: string; // always the bcrypt hash, never the plaintext password
  username: string;
}

// What a client is allowed to see of an account: everything but the password.
export type PublicUser = Omit<User, "password"> & { id: string };

// What the JWT carries. A JWT is not encrypted: anyone can read its contents. So
// nothing sensitive goes in here, and never the password.
export interface TokenPayload {
  id: string;
  email: string;
  username: string;
}
