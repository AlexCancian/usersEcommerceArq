import { Schema, model, Document } from "mongoose";

export interface ICategoria extends Document {
  nome: string;
  slug: string;
  criado_em: Date;
  atualizado_em: Date;
}

const CategoriaSchema = new Schema<ICategoria>(
  {
    nome: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
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

export const Categoria = model<ICategoria>("Categoria", CategoriaSchema, "categorias");
