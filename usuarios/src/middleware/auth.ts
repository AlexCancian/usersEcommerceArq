import { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../utils/errors.js";

// Identidade injetada pelo gateway (aula 07): o Kong valida o JWT, apaga os
// X-User-* que vieram do cliente e escreve os valores tirados do token.
// O serviço não valida token: só lê os cabeçalhos, porque só o gateway alcança a rede interna.
export interface UsuarioIdentidade {
  id: string;
  email: string;
  perfil: "cliente" | "admin";
}

export interface AuthenticatedRequest extends Request {
  user?: UsuarioIdentidade;
}

export const lerIdentidade = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) => {
  const id = req.header("x-user-id");
  const email = req.header("x-user-email");
  const perfil = req.header("x-user-role");

  if (!id || !email || (perfil !== "cliente" && perfil !== "admin")) {
    throw new UnauthorizedError("Identidade ausente. Acesse pelo gateway.");
  }

  req.user = { id, email, perfil };
  next();
};
