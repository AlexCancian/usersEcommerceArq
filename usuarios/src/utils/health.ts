import { z } from "zod";

// ---- comum (aula 10: /health com ok | degradado | fora do ar)
export const estadoDependenciaSchema = z.enum(["ok", "fora"]);
export const statusHealthSchema = z.enum(["ok", "degradado", "fora do ar"]);
export type EstadoDependencia = z.infer<typeof estadoDependenciaSchema>;
export type StatusHealth = z.infer<typeof statusHealthSchema>;

// Corta a promessa em `ms`; o timer não segura o processo.
export async function comLimite<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error("tempo esgotado")), ms);
    timer.unref();
  });
  try {
    return await Promise.race([promessa, limite]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Executa o teste com limite; qualquer erro ou estouro = "fora". Nunca lança.
export async function verificar(
  teste: () => Promise<unknown>,
  ms = 2000
): Promise<EstadoDependencia> {
  try {
    await comLimite(teste(), ms);
    return "ok";
  } catch {
    return "fora";
  }
}

export function httpDoStatus(status: StatusHealth): 200 | 503 {
  return status === "fora do ar" ? 503 : 200;
}

// ---- usuarios
export const healthUsuariosSchema = z
  .object({
    servico: z.literal("usuarios"),
    status: statusHealthSchema,
    dependencias: z.object({ banco: estadoDependenciaSchema }).strict(),
  })
  .strict();
export type HealthUsuarios = z.infer<typeof healthUsuariosSchema>;
