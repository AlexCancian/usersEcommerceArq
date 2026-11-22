# ADR 0002: PostgreSQL para usuários e MongoDB para o catálogo

Status: aceita (aula 06)

## Contexto
Os dois domínios têm necessidades opostas. Usuários exigem integridade relacional (e-mail único, endereços que pertencem a um usuário). O catálogo tem produtos muito diferentes entre si: um celular tem memória e tela, uma camiseta tem tamanho e cor, um livro tem autor e ISBN.

## Decisão
- `usuarios` usa PostgreSQL 16 (Prisma): chaves estrangeiras, `CASCADE`, unicidade estrita.
- `catalogo` usa MongoDB 7 (Mongoose): atributos livres por categoria no campo `atributos`, estoque embutido no documento.
- Cada serviço tem o seu banco e nenhum outro serviço o acessa. (Depois vieram o Postgres de `pedidos` e o de `pagamentos`: ADR 0006 e 0008.)

## Consequências
- O catálogo evolui sem migration quando surge uma categoria nova.
- Perde-se o que o banco relacional garantia: no Mongo, a validação dos atributos fica só no Zod da aplicação.
- Duas tecnologias para operar, e nenhuma transação atravessa os bancos (o que leva à saga, ADR 0008).
