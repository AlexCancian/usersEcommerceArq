import { prisma } from "../config/db.js";

export interface CreateEnderecoData {
  usuario_id: string;
  apelido?: string;
  cep: string;
  logradouro: string;
  numero?: string;
  complemento?: string;
  cidade: string;
  uf: string;
  principal?: boolean;
}

export const findEnderecosByUsuarioId = async (usuarioId: string) => {
  return prisma.endereco.findMany({
    where: { usuario_id: usuarioId },
    orderBy: [{ principal: "desc" }, { id: "asc" }],
  });
};

export const findEnderecoById = async (id: string) => {
  return prisma.endereco.findUnique({
    where: { id },
  });
};

export const resetPrincipalForUsuario = async (usuarioId: string) => {
  return prisma.endereco.updateMany({
    where: { usuario_id: usuarioId, principal: true },
    data: { principal: false },
  });
};

export const createEndereco = async (data: CreateEnderecoData) => {
  if (data.principal) {
    await resetPrincipalForUsuario(data.usuario_id);
  }

  return prisma.endereco.create({
    data: {
      usuario_id: data.usuario_id,
      apelido: data.apelido,
      cep: data.cep,
      logradouro: data.logradouro,
      numero: data.numero,
      complemento: data.complemento,
      cidade: data.cidade,
      uf: data.uf.toUpperCase(),
      principal: data.principal ?? false,
    },
  });
};

export const deleteEnderecoById = async (id: string) => {
  return prisma.endereco.delete({
    where: { id },
  });
};
