# 03 - Contrato: Saga e resiliência (aula 09)

## Rotas HTTP (pelo gateway, `http://localhost:8080`)
| Método | Rota | Acesso (tag Kong) | Status |
|---|---|---|---|
| GET | `/pagamentos/:pedidoId` | logado (`*logado`) | 200 · 401 (Kong) · 404 não existe, não é UUID ou não é do usuário (admin vê todos) |
| GET | `/pagamentos` | admin (`*so-admin`) | 200 · 401 (Kong) · 403 (Kong; o serviço também devolve 403 se o perfil não for admin) |
| GET | `/health/pagamentos` | publico | 200 `{ status: "ok", banco: "conectado", circuitoBancoExterno }` · 500 `{ status: "erro", banco: "desconectado", circuitoBancoExterno }` |
| POST | `/pedidos/:id/cancelar` (alterada) | logado | 200 (publica `pedido.cancelado`, `motivo_cancelamento` = "Cancelado pelo cliente.") · 404 · 409 (ex.: `PAGO`) |

Resposta de pagamento (200):
```json
{
  "id": "uuid", "pedido_id": "uuid", "usuario_id": "uuid", "valor": "2499.9",
  "forma": "cartao", "cartao_final": "1111", "status": "APROVADO", "tentativas": 1,
  "codigo_transacao": "TX-1A2B3C", "motivo": null, "criado_em": "2026-11-05T18:30:00.000Z"
}
```
Erros no formato do projeto: `{ "erro": "Pagamento não existe ou não é seu." }`.

```ts
// pagamentos/src/utils/schemas.ts
export const pedidoIdParamSchema = z.object({
  params: z.object({ pedidoId: z.string().min(1, "pedidoId é obrigatório.") }),
});
```

## banco-falso (`http://localhost:9000`, fora do Kong; interno `http://banco-falso:3000`)
| Método | Rota | Corpo | Respostas |
|---|---|---|---|
| POST | `/cobrancas` | `{ valor: number > 0, cartaoFinal?: "dddd" \| null, referencia: string }` | 201 `{ aprovado: true, codigo, referencia, valor }` · 402 `{ aprovado: false, motivo: "saldo insuficiente" }` (final 0002) · 503 `{ erro }` (falhaPercent) · 400. Mesma referência → mesma resposta |
| POST | `/estornos` | `{ codigo?: string, referencia?: string }` (um dos dois) | 201 `{ estornado: true, codigo, referencia }` · 404 · 400 |
| GET | `/config` | — | 200 `{ latenciaMs, falhaPercent }` |
| POST | `/config` | `{ latenciaMs?: 0..60000, falhaPercent?: 0..100 }` | 200 · 400 |
| GET | `/health` | — | 200 |

## Eventos (envelope da aula 08; chave = pedidoId)
| Tipo | Tópico | Produtor | `dados` |
|---|---|---|---|
| `estoque.reservado` (alterado) | estoque | catalogo | + `cartaoFinal: string \| null` |
| `pedido.cancelado` | pedidos | pedidos | `{ usuarioId, clienteEmail, valorTotal, motivo }` |
| `pagamento.aprovado` | pagamentos | pagamentos | `{ usuarioId, clienteEmail, valor, codigoTransacao, tentativas }` |
| `pagamento.recusado` | pagamentos | pagamentos | `{ usuarioId, clienteEmail, valor, motivo, tentativas }` |
| `pagamento.estornado` | pagamentos | pagamentos | `{ usuarioId, clienteEmail, valor, codigoTransacao }` |

Consumidores (leitor tolerante: cada um valida só o que usa):
| Serviço (group) | Tópicos | Reação |
|---|---|---|
| pagamentos | estoque, pedidos | `estoque.reservado` → cobra · `pedido.cancelado` → CANCELADO ou estorno |
| catalogo | pedidos, pagamentos | `pagamento.aprovado` → confirma · `pagamento.recusado` / `pedido.cancelado` → libera |
| pedidos | estoque, pagamentos | `pagamento.aprovado` → PAGO (de AGUARDANDO_PAGAMENTO) · `pagamento.recusado` → CANCELADO com motivo (de AGUARDANDO_*) |
| notificacoes | pedidos, estoque, pagamentos | e-mails de aprovado, recusado e estornado |

## Banco (pagamentos, Postgres 16)
Tabela `pagamentos`: `id uuid PK`, `pedido_id uuid UNIQUE`, `usuario_id uuid`, `valor numeric(12,2) CHECK >= 0`, `forma text`,
`cartao_final text CHECK ~ '^[0-9]{4}$'`, `status "StatusPagamento"` (PENDENTE, APROVADO, RECUSADO, ERRO, CANCELADO, ESTORNADO),
`tentativas int CHECK >= 0 DEFAULT 0`, `codigo_transacao text`, `motivo text`, `criado_em timestamptz`. Sem FK (outros bancos).

Catálogo: `reservas.status` ganha `confirmado` e `liberado`.
