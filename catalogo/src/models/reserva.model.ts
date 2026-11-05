import { Schema, model } from "mongoose";

export const STATUS_RESERVA = ["processando", "reservado", "insuficiente"] as const;
export type StatusReserva = (typeof STATUS_RESERVA)[number];

export interface IItemReserva {
  produtoId: string;
  quantidade: number;
}

export interface IReserva {
  pedidoId: string;
  itens: IItemReserva[];
  status: StatusReserva;
  criado_em: Date;
  atualizado_em: Date;
}

const ItemReservaSchema = new Schema<IItemReserva>(
  {
    produtoId: { type: String, required: true },
    quantidade: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

// Aula 08, slide "CATALOGO: RESERVAR SEM REPETIR": uma reserva por pedido, pedidoId único.
const ReservaSchema = new Schema<IReserva>(
  {
    pedidoId: { type: String, required: true, unique: true },
    itens: { type: [ItemReservaSchema], required: true },
    status: { type: String, enum: STATUS_RESERVA, required: true, default: "processando" },
  },
  {
    timestamps: { createdAt: "criado_em", updatedAt: "atualizado_em" },
    versionKey: false,
  }
);

export const Reserva = model<IReserva>("Reserva", ReservaSchema, "reservas");
