-- CreateEnum
CREATE TYPE "StatusPedido" AS ENUM ('AGUARDANDO_ESTOQUE', 'AGUARDANDO_PAGAMENTO', 'PAGO', 'CANCELADO');

-- CreateTable
-- Sem FK para usuarios e produtos: moram em outros bancos.
CREATE TABLE "carrinho_itens" (
    "usuario_id" UUID NOT NULL,
    "produto_id" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,

    CONSTRAINT "carrinho_itens_pkey" PRIMARY KEY ("usuario_id","produto_id"),
    CONSTRAINT "carrinho_itens_quantidade_check" CHECK ("quantidade" > 0)
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "cliente_email" TEXT NOT NULL,
    "status" "StatusPedido" NOT NULL DEFAULT 'AGUARDANDO_ESTOQUE',
    "valor_total" DECIMAL(12,2) NOT NULL,
    "endereco_entrega" JSONB NOT NULL,
    "forma_pagamento" TEXT NOT NULL,
    "cartao_final" TEXT,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_pedido" (
    "pedido_id" UUID NOT NULL,
    "produto_id" TEXT NOT NULL,
    "nome_produto" TEXT NOT NULL,
    "preco_unitario" DECIMAL(12,2) NOT NULL,
    "quantidade" INTEGER NOT NULL,

    CONSTRAINT "itens_pedido_pkey" PRIMARY KEY ("pedido_id","produto_id")
);

-- AddForeignKey (mesmo banco)
ALTER TABLE "itens_pedido" ADD CONSTRAINT "itens_pedido_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
