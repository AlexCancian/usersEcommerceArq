import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

// Payload do token (aula 07, slide 7): o Kong usa o campo "perfil"
// para achar o consumer (key_claim_name: perfil) e decidir as rotas de admin.
export interface TokenPayload {
  sub: string; // id do usuário
  email: string;
  perfil: "cliente" | "admin"; // vem do banco
}

// usuarios é o ÚNICO serviço que emite tokens. Quem valida é o gateway.
export const signJWTToken = (payload: TokenPayload): string => {
  return jwt.sign({ ...payload, iss: "usuarios" }, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "2h",
  });
};
