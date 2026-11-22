# ADR 0001: Padrão em camadas (controllers, services, repositories)

Status: aceita (aula 06)

## Contexto
Os serviços nasceram de uma referência da disciplina (BackendTv). Sem uma convenção única, cada serviço organizaria o código de um jeito, e quem lê um deles não saberia onde achar a regra de negócio nem o acesso a dados.

## Decisão
Todos os serviços seguem `routes → controllers → services → repositories`:
- Controllers criam um Express `Router` (`export default router;`) e são finos: `try/catch` e `next(error)`.
- `routes.ts` conecta os prefixos com `routes.use(...)`.
- Services guardam a regra de negócio.
- Repositories isolam o acesso ao banco.

## Consequências
- Quem conhece um serviço navega em qualquer outro; a regra de negócio fica testável sem HTTP e sem banco.
- Custo: mais arquivos e uma camada a mais para atravessar em recursos triviais (um CRUD simples passa por quatro arquivos).
