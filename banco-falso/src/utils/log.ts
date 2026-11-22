const LIMITE_TEXTO = 200;

function umaLinha(texto: string): string {
  return texto.replace(/\s+/g, " ").trim().slice(0, LIMITE_TEXTO);
}

// Descrição segura de um erro: nunca o objeto inteiro, nunca stack.
// Prisma/Postgres (code), rede (code): só "<name> code=<code>"; o resto: "<name>: <message>" truncado.
export function descreverErro(erro: unknown): string {
  if (!(erro instanceof Error)) return "erro desconhecido";
  const comCodigo = erro as Error & { code?: unknown; responseCode?: unknown };
  if (comCodigo.code !== undefined && comCodigo.code !== null) {
    const resposta =
      comCodigo.responseCode !== undefined ? ` responseCode=${String(comCodigo.responseCode)}` : "";
    return `${erro.name} code=${String(comCodigo.code)}${resposta}`;
  }
  // Erros do Prisma sem code (validação, inicialização) trazem a query/SQL na mensagem: só o nome.
  if (erro.name.startsWith("Prisma")) return erro.name;
  return umaLinha(`${erro.name}: ${erro.message}`);
}

// X-Request-Id só é aceito se for seguro para log e para repassar adiante.
export function lerRequestId(valor: string | undefined): string | undefined {
  if (valor === undefined) return undefined;
  return /^[A-Za-z0-9-]{1,64}$/.test(valor) ? valor : undefined;
}
