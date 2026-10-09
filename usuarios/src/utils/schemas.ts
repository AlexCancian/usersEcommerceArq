import { z } from "zod";

export const loginSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: "E-mail é obrigatório." })
      .email("E-mail deve ser um endereço válido."),
    senha: z
      .string({ required_error: "Senha é obrigatória." })
      .min(1, "Senha não pode ser vazia."),
  }),
});

export const createUsuarioSchema = z.object({
  body: z.object({
    nome: z
      .string({ required_error: "Nome é obrigatório." })
      .min(2, "Nome deve ter pelo menos 2 caracteres."),
    email: z
      .string({ required_error: "E-mail é obrigatório." })
      .email("E-mail deve ser um endereço válido."),
    senha: z
      .string({ required_error: "Senha é obrigatória." })
      .min(6, "Senha deve ter no mínimo 6 caracteres."),
    perfil: z.enum(["cliente", "admin"]).optional().default("cliente"),
  }),
});

export const updateUsuarioSchema = z.object({
  body: z
    .object({
      nome: z.string().min(2, "Nome deve ter pelo menos 2 caracteres.").optional(),
      email: z.string().email("E-mail deve ser um endereço válido.").optional(),
      senha: z.string().min(6, "Senha deve ter no mínimo 6 caracteres.").optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "Ao menos um campo deve ser fornecido para atualização.",
    }),
});

export const createEnderecoSchema = z.object({
  body: z.object({
    apelido: z.string().optional(),
    cep: z
      .string({ required_error: "CEP é obrigatório." })
      .min(1, "CEP é obrigatório."),
    logradouro: z
      .string({ required_error: "Logradouro é obrigatório." })
      .min(1, "Logradouro é obrigatório."),
    numero: z.string().optional(),
    complemento: z.string().optional(),
    cidade: z
      .string({ required_error: "Cidade é obrigatória." })
      .min(1, "Cidade é obrigatória."),
    uf: z
      .string({ required_error: "UF é obrigatória." })
      .length(2, "UF deve ter exatamente 2 caracteres."),
    principal: z.boolean().optional().default(false),
  }),
});

export const enderecoIdParamSchema = z.object({
  params: z.object({
    id: z.string().uuid("ID do endereço deve ser um UUID válido."),
  }),
});
