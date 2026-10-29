import { z } from "zod";
import { env } from "./config/env.js";
import { CatalogoIndisponivelError } from "./utils/errors.js";

// Aula 07, slide 37: pedidos pergunta ao catálogo direto pela rede interna,
// sem passar pelo gateway e sem token. A proteção é o catálogo não publicar porta.

const produtoCatalogoSchema = z.object({
  _id: z.string(),
  sku: z.string(),
  nome: z.string(),
  preco: z.number(),
  ativo: z.boolean(),
  estoque: z.object({
    disponivel: z.number(),
    reservado: z.number(),
  }),
});

export type ProdutoCatalogo = z.infer<typeof produtoCatalogoSchema>;

const TIMEOUT_MS = 3000; // sem timeout, um catálogo travado trava o checkout junto

// Um pedido só para todos os produtos (?ids=a,b,c), não um por produto.
export async function buscarProdutos(
  ids: string[],
  requestId?: string
): Promise<ProdutoCatalogo[]> {
  const headers: Record<string, string> = {};
  if (requestId) headers["x-request-id"] = requestId;

  let corpo: unknown;
  try {
    const r = await fetch(
      `${env.CATALOGO_URL}/produtos?ids=${encodeURIComponent(ids.join(","))}`,
      { headers, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!r.ok) throw new Error(`status ${r.status}`);
    corpo = await r.json();
  } catch {
    throw new CatalogoIndisponivelError(); // vira 503
  }

  const resultado = z.array(produtoCatalogoSchema).safeParse(corpo);
  if (!resultado.success) {
    throw new CatalogoIndisponivelError();
  }

  return resultado.data;
}
