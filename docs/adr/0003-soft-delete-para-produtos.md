# ADR 0003: Soft delete para produtos

Status: aceita (aula 06)

## Contexto
Um produto removido pode já ter aparecido em pedidos. Apagar o documento deixaria o histórico sem referência e quebraria consultas a pedidos antigos.

## Decisão
`DELETE /produtos/:id` apenas marca `ativo = false`. Listagens públicas só trazem produtos ativos. O documento físico permanece.

## Consequências
- O histórico de pedidos continua íntegro, e reativar um produto é só trocar a flag.
- A coleção só cresce, e todo filtro de vitrine precisa lembrar do `ativo: true`.
- `GET /produtos/:id` ainda devolve o produto inativo (comportamento mantido); o checkout recusa produto inativo com 409.
