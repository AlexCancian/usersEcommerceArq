import {
  findUserByEmailWithPassword,
  SafeUsuario,
} from "../repositories/usuario.repository.js";
import { comparePassword } from "../utils/password.js";
import { signJWTToken } from "../utils/jwt.js";
import { UnauthorizedError } from "../utils/errors.js";

export interface LoginDTO {
  email: string;
  senha: string;
}

export interface LoginResponse {
  token: string;
  usuario: SafeUsuario;
}

export const loginService = async (data: LoginDTO): Promise<LoginResponse> => {
  const user = await findUserByEmailWithPassword(data.email);

  if (!user) {
    throw new UnauthorizedError("E-mail ou senha errados.");
  }

  const isPasswordValid = await comparePassword(data.senha, user.senha_hash);

  if (!isPasswordValid) {
    throw new UnauthorizedError("E-mail ou senha errados.");
  }

  const safeUsuario: SafeUsuario = {
    id: user.id,
    nome: user.nome,
    email: user.email,
    perfil: user.perfil,
    criado_em: user.criado_em,
  };

  const token = signJWTToken({
    sub: user.id,
    email: user.email,
    perfil: user.perfil,
  });

  return {
    token,
    usuario: safeUsuario,
  };
};
