// Log padronizado (aula 10): [<servico>] <verbo> <tipo> pedidoId=<id|-> correlationId=<id|-> chave=valor
const SERVICO = "pagamentos";

export type VerboEvento =
  | "publicou"
  | "recebeu"
  | "processou"
  | "compensou"
  | "ignorou"
  | "descartou"
  | "falhou";

const LIMITE_TEXTO = 200;

function umaLinha(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().slice(0, LIMITE_TEXTO);
}

export function logEvento(
  verbo: VerboEvento,
  tipo: string,
  pedidoId: string | null,
  correlationId: string | null,
  extras?: Record<string, string | number>
): void {
  const partes = [
    `[${SERVICO}] ${verbo} ${tipo}`,
    `pedidoId=${pedidoId ?? "-"}`,
    `correlationId=${correlationId ?? "-"}`,
  ];
  if (extras) {
    for (const [chave, valor] of Object.entries(extras)) {
      const texto = typeof valor === "string" ? valor : String(valor);
      partes.push(chave === "motivo" || chave === "erro" ? `${chave}="${umaLinha(texto)}"` : `${chave}=${texto}`);
    }
  }
  const linha = partes.join(" ");
  if (verbo === "falhou" || verbo === "descartou") {
    console.error(linha);
  } else {
    console.log(linha);
  }
}

// Descrição segura de um erro: nunca o objeto inteiro, nunca stack.
export function descreverErro(erro: unknown): string {
  if (!(erro instanceof Error)) return "erro desconhecido";
  const comCodigo = erro as Error & { code?: unknown; responseCode?: unknown };
  if (comCodigo.code !== undefined && comCodigo.code !== null) {
    const resposta =
      comCodigo.responseCode !== undefined ? ` responseCode=${String(comCodigo.responseCode)}` : "";
    return `${erro.name} code=${String(comCodigo.code)}${resposta}`;
  }
  // Erros do Prisma sem code (validação, inicialização) trazem query/SQL na mensagem: só o nome.
  if (erro.name.startsWith("Prisma")) return erro.name;
  return umaLinha(`${erro.name}: ${erro.message}`);
}

// X-Request-Id só é aceito se for seguro para log e para repassar adiante.
export function lerRequestId(valor: string | undefined): string | undefined {
  if (valor === undefined) return undefined;
  return /^[A-Za-z0-9-]{1,64}$/.test(valor) ? valor : undefined;
}
