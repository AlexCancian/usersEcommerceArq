import { Schema, model, Document } from "mongoose";

export interface IEstoque {
  disponivel: number;
  reservado: number;
}

export interface IProduto extends Document {
  sku: string;
  nome: string;
  categoria: string;
  preco: number;
  ativo: boolean;
  atributos: Record<string, any>;
  estoque: IEstoque;
  criado_em: Date;
  atualizado_em: Date;
}

const EstoqueSchema = new Schema<IEstoque>(
  {
    disponivel: { type: Number, required: true, min: 0, default: 0 },
    reservado: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false }
);

const ProdutoSchema = new Schema<IProduto>(
  {
    sku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    nome: {
      type: String,
      required: true,
      trim: true,
    },
    categoria: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    preco: {
      type: Number,
      required: true,
      min: 0,
    },
    ativo: {
      type: Boolean,
      default: true,
      index: true,
    },
    atributos: {
      type: Schema.Types.Mixed,
      default: {},
    },
    estoque: {
      type: EstoqueSchema,
      required: true,
    },
  },
  {
    timestamps: { createdAt: "criado_em", updatedAt: "atualizado_em" },
    versionKey: false,
    toJSON: {
      transform: (doc, ret) => {
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

// Índices já definidos nos campos do Schema (sku: unique, categoria: index, ativo: index)

export const Produto = model<IProduto>("Produto", ProdutoSchema, "produtos");
