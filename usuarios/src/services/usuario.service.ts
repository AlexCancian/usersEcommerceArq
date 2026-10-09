import {
  createUser,
  findUserByIdSafe,
  updateUser,
  findAllUsersSafe,
  checkEmailExists,
  SafeUsuario,
} from "../repositories/usuario.repository.js";
import { hashPassword } from "../utils/password.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { Perfil } from "@prisma/client";

export interface CreateUsuarioDTO {
  nome: string;
  email: string;
  senha: string;
  perfil?: "cliente" | "admin";
}

export interface UpdateUsuarioDTO {
  nome?: string;
  email?: string;
  senha?: string;
}

export const createUsuarioService = async (
  data: CreateUsuarioDTO
): Promise<SafeUsuario> => {
  const emailAlreadyExists = await checkEmailExists(data.email);

  if (emailAlreadyExists) {
    throw new ConflictError("Este e-mail já está cadastrado.");
  }

  const senha_hash = await hashPassword(data.senha);

  return createUser({
    nome: data.nome,
    email: data.email,
    senha_hash,
    perfil: data.perfil ? (data.perfil as Perfil) : Perfil.cliente,
  });
};

export const getMeService = async (userId: string): Promise<SafeUsuario> => {
  const user = await findUserByIdSafe(userId);

  if (!user) {
    throw new NotFoundError("Usuário não encontrado.");
  }

  return user;
};

export const updateMeService = async (
  userId: string,
  data: UpdateUsuarioDTO
): Promise<SafeUsuario> => {
  if (data.email) {
    const emailAlreadyExists = await checkEmailExists(data.email, userId);
    if (emailAlreadyExists) {
      throw new ConflictError("Este e-mail já está cadastrado.");
    }
  }

  const updatePayload: {
    nome?: string;
    email?: string;
    senha_hash?: string;
  } = {};

  if (data.nome) updatePayload.nome = data.nome;
  if (data.email) updatePayload.email = data.email;
  if (data.senha) {
    updatePayload.senha_hash = await hashPassword(data.senha);
  }

  return updateUser(userId, updatePayload);
};

export const getAllUsuariosService = async (): Promise<SafeUsuario[]> => {
  return findAllUsersSafe();
};
