import mongoose from "mongoose";
import { IItemReserva, IReserva, Reserva, StatusReserva } from "../models/reserva.model.js";

// true: reserva criada (primeira vez). false: pedidoId já existe (evento repetido, RN05).
export const criarReserva = async (
  pedidoId: string,
  itens: IItemReserva[]
): Promise<boolean> => {
  try {
    await Reserva.create({ pedidoId, itens, status: "processando" });
    return true;
  } catch (erro) {
    if (erro instanceof mongoose.mongo.MongoServerError && erro.code === 11000) {
      return false;
    }
    throw erro;
  }
};

export const concluirReserva = async (
  pedidoId: string,
  status: StatusReserva
): Promise<void> => {
  await Reserva.updateOne({ pedidoId }, { $set: { status } });
};

// Aula 09: muda o status só a partir do esperado (filtro de estado = idempotência).
// Devolve a reserva (com os itens) se mudou; null se já não estava no status de origem.
export const mudarStatusReserva = async (
  pedidoId: string,
  de: StatusReserva,
  para: StatusReserva
): Promise<IReserva | null> => {
  return Reserva.findOneAndUpdate(
    { pedidoId, status: de },
    { $set: { status: para } },
    { new: true }
  ).lean<IReserva>();
};
