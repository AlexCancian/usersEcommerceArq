import mongoose from "mongoose";
import { IItemReserva, Reserva, StatusReserva } from "../models/reserva.model.js";

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
