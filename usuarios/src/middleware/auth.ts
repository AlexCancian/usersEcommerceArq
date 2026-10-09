import { Request, Response, NextFunction } from "express";
import { verifyJWTToken, TokenPayload } from "../utils/jwt.js";
import { UnauthorizedError, ForbiddenError } from "../utils/errors.js";

export interface AuthenticatedRequest<
  P = Record<string, any>,
  ResBody = any,
  ReqBody = any,
  ReqQuery = any,
> extends Request<P, ResBody, ReqBody, ReqQuery> {
  user?: TokenPayload;
}

export const authenticateJWT = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("Token não fornecido.");
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = verifyJWTToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    throw new UnauthorizedError("Token inválido ou expirado.");
  }
};

export const requireRoles = (roles: ("cliente" | "admin")[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new UnauthorizedError("Usuário não autenticado.");
    }

    if (!roles.includes(req.user.perfil)) {
      throw new ForbiddenError(
        "Acesso negado: permissão insuficiente para esta ação."
      );
    }

    next();
  };
};
