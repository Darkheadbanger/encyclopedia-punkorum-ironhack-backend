// Signup, login and token check. Hashing lives in the User model, so nothing here
// ever touches a clear-text password beyond comparing it.

import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.model.ts";
import { TOKEN_ALGORITHM, TOKEN_EXPIRES_IN, tokenSecret } from "../config/jwt.ts";
import type { TokenPayload } from "../types/index.ts";

// Same answer whether the email is unknown or the password wrong: anything else
// would let a stranger discover which accounts exist.
const REJECTED = { error: "Incorrect email or password." };

export const signup = async (req: Request, res: Response) => {
  const { email, password, username } = req.body ?? {};
  // Only these three fields: a client must not be able to set anything else.
  const user = await User.create({ email, password, username });
  res.status(201).json(user); // toJSON strips the password hash
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(401).json(REJECTED);
    return;
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401).json(REJECTED);
    return;
  }

  const payload: TokenPayload = {
    id: user.id,
    email: user.email,
    username: user.username,
  };

  res.json({
    authToken: jwt.sign(payload, tokenSecret(), {
      algorithm: TOKEN_ALGORITHM,
      expiresIn: TOKEN_EXPIRES_IN,
    }),
  });
};

// Reached only through isAuthenticated, so the payload is already verified.
export const verify = async (req: Request, res: Response) => {
  res.json(req.payload);
};
