# ADR 0006: Pedidos com Postgres próprio e chamada síncrona ao catálogo

Status: aceita (aula 07)

## Contexto
O checkout precisa de preço e nome atuais dos produtos, que pertencem ao catálogo (outro banco). Um banco compartilhado acoplaria os serviços; copiar o catálogo para o pedidos duplicaria dados que mudam.

## Decisão
- `pedidos` tem o seu próprio PostgreSQL, **sem chave estrangeira** para usuários e produtos (são outros bancos).
- No checkout, consulta o catálogo direto pela rede interna, sem passar pelo Kong: `GET /produtos?ids=a,b,c`, **uma chamada para todos os itens**, com timeout de 3 s e `x-request-id` repassado.
- Preço e nome são **copiados** para `itens_pedido`: o histórico do pedido não muda se o produto mudar.

## Consequências
- Acoplamento temporal: catálogo fora ou lento faz o checkout responder 503. Carrinho consultado por dono e lista de pedidos continuam funcionando.
- O pedido nasce em `AGUARDANDO_ESTOQUE`; quem o faz andar são os eventos (ADR 0007).
- Sem FK entre bancos, a integridade de `usuario_id` e `produto_id` é só da aplicação.
- Como o `?ids=` alimenta o checkout, ele nunca é cacheado (ADR 0011).
