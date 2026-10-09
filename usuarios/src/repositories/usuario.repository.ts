import { prisma } from "../config/db.js";
import { Perfil } from "@prisma/client";

export interface SafeUsuario {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  criado_em: Date;
}

const safeUsuarioSelect = {
  id: true,
  nome: true,
  email: true,
  perfil: true,
  criado_em: true,
};

export const findUserByEmailWithPassword = async (email: string) => {
  return prisma.usuario.findUnique({
    where: { email },
  });
};

export const findUserByIdSafe = async (id: string): Promise<SafeUsuario | null> => {
  return prisma.usuario.findUnique({
    where: { id },
    select: safeUsuarioSelect,
  });
};

export const findUserByIdWithPassword = async (id: string) => {
  return prisma.usuario.findUnique({
    where: { id },
  });
};

export const createUser = async (data: {
  nome: string;
  email: string;
  senha_hash: string;
  perfil?: Perfil;
}): Promise<SafeUsuario> => {
  return prisma.usuario.create({
    data: {
      nome: data.nome,
      email: data.email,
      senha_hash: data.senha_hash,
      perfil: data.perfil ?? Perfil.cliente,
    },
    select: safeUsuarioSelect,
  });
};

export const updateUser = async (
  id: string,
  data: {
    nome?: string;
    email?: string;
    senha_hash?: string;
  }
): Promise<SafeUsuario> => {
  return prisma.usuario.update({
    where: { id },
    data,
    select: safeUsuarioSelect,
  });
};

export const findAllUsersSafe = async (): Promise<SafeUsuario[]> => {
  return prisma.usuario.findMany({
    select: safeUsuarioSelect,
    orderBy: { criado_em: "desc" },
  });
};

export const checkEmailExists = async (
  email: string,
  excludeId?: string
): Promise<boolean> => {
  const user = await prisma.usuario.findFirst({
    where: {
      email,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  return Boolean(user);
};
