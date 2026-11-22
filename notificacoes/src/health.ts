import { createServer, Server, ServerResponse } from "node:http";
import { kafkaDisponivel } from "./config/kafka.js";
import { smtpDisponivel } from "./config/smtp.js";
import { HealthNotificacoes, StatusHealth, httpDoStatus, verificar } from "./utils/health.js";

// HTTP mínimo (node:http, sem Express): só GET /health. Sem log de requisição (o Docker chama a cada 10 s).
// Essencial: kafka (fora = 503). Não essencial: smtp (fora = degradado, 200).
async function montarHealth(): Promise<HealthNotificacoes> {
  const [kafka, smtp] = await Promise.all([
    verificar(async () => {
      if (!(await kafkaDisponivel())) throw new Error("kafka fora");
    }),
    verificar(async () => {
      if (!(await smtpDisponivel())) throw new Error("smtp fora");
    }),
  ]);

  let status: StatusHealth = "ok";
  if (kafka === "fora") status = "fora do ar";
  else if (smtp === "fora") status = "degradado";

  return { servico: "notificacoes", status, dependencias: { kafka, smtp } };
}

function responder(res: ServerResponse, codigo: number, corpo: unknown): void {
  const json = JSON.stringify(corpo);
  res.writeHead(codigo, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    "Cache-Control": "no-store",
  });
  res.end(json);
}

export function iniciarServidorHealth(porta: number): Server {
  const server = createServer((req, res) => {
    const caminho = (req.url ?? "").split("?")[0];
    if (req.method !== "GET" || caminho !== "/health") {
      responder(res, 404, { erro: "Rota não encontrada." });
      return;
    }
    montarHealth()
      .then((corpo) => responder(res, httpDoStatus(corpo.status), corpo))
      .catch(() => {
        // Nunca deveria acontecer (verificar() não lança), mas o health não pode devolver 500.
        responder(res, 503, {
          servico: "notificacoes",
          status: "fora do ar",
          dependencias: { kafka: "fora", smtp: "fora" },
        } satisfies HealthNotificacoes);
      });
  });
  server.listen(porta, () => {
    console.log(`[notificacoes] /health escutando na porta ${porta}`);
  });
  return server;
}
