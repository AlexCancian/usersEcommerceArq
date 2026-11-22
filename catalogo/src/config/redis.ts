import { Redis } from "ioredis";
import { env } from "./env.js";

// Cliente Redis do cache (aula 10). Sem fila offline e sem retry por comando:
// Redis fora = o comando falha na hora e a vitrine responde pelo Mongo (X-Cache: OFF).
export const redis = new Redis(env.REDIS_URL, {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  commandTimeout: 200,
  connectTimeout: 1000,
  retryStrategy: (tentativa: number) => Math.min(tentativa * 500, 5000),
});

// Log só na transição, para não inundar a saída a cada tentativa de reconexão.
let disponivel: boolean | null = null;

redis.on("error", () => {
  if (disponivel !== false) {
    disponivel = false;
    console.warn("[catalogo] cache indisponível (Redis); a vitrine responde pelo Mongo");
  }
});

redis.on("ready", () => {
  if (disponivel !== true) {
    disponivel = true;
    console.log("[catalogo] cache disponível (Redis)");
  }
});

// Espera o "ready" por até `ms`. Resolve true/false; nunca lança.
export function aguardarRedisPronto(ms: number): Promise<boolean> {
  if (redis.status === "ready") return Promise.resolve(true);
  return new Promise<boolean>((resolver) => {
    const aoFicarPronto = (): void => {
      clearTimeout(timer);
      resolver(true);
    };
    const timer = setTimeout(() => {
      redis.off("ready", aoFicarPronto);
      resolver(false);
    }, ms);
    redis.once("ready", aoFicarPronto);
  });
}

export async function desconectarRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
