import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface TokenPayload {
  id: string;
  email: string;
  perfil: "cliente" | "admin";
}

export const signJWTToken = (
  payload: TokenPayload,
  expiresIn: string = "24h"
): string => {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn } as jwt.SignOptions);
};

export const verifyJWTToken = (token: string): TokenPayload => {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
};
