import {
  findEnderecosByUsuarioId,
  findEnderecoById,
  createEndereco,
  deleteEnderecoById,
  CreateEnderecoData,
} from "../repositories/endereco.repository.js";
import { NotFoundError } from "../utils/errors.js";

export type CreateEnderecoDTO = Omit<CreateEnderecoData, "usuario_id">;

export const listEnderecosService = async (usuarioId: string) => {
  return findEnderecosByUsuarioId(usuarioId);
};

export const createEnderecoService = async (
  usuarioId: string,
  data: CreateEnderecoDTO
) => {
  return createEndereco({
    ...data,
    usuario_id: usuarioId,
  });
};

export const deleteEnderecoService = async (
  usuarioId: string,
  enderecoId: string
) => {
  const endereco = await findEnderecoById(enderecoId);

  if (!endereco || endereco.usuario_id !== usuarioId) {
    throw new NotFoundError("Endereço não existe ou não pertence a este usuário.");
  }

  await deleteEnderecoById(enderecoId);
};
