-- CreateEnum
CREATE TYPE "StatusPagamento" AS ENUM ('PENDENTE', 'APROVADO', 'RECUSADO', 'ERRO', 'CANCELADO', 'ESTORNADO');

-- CreateTable
-- Sem FK para pedidos e usuarios: moram em outros bancos.
CREATE TABLE "pagamentos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pedido_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "forma" TEXT,
    "cartao_final" TEXT,
    "status" "StatusPagamento" NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "codigo_transacao" TEXT,
    "motivo" TEXT,
    "criado_em" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pagamentos_valor_check" CHECK ("valor" >= 0),
    CONSTRAINT "pagamentos_tentativas_check" CHECK ("tentativas" >= 0),
    CONSTRAINT "pagamentos_cartao_final_check" CHECK ("cartao_final" IS NULL OR "cartao_final" ~ '^[0-9]{4}$')
);

-- Idempotência (aula 09): o mesmo pedido nunca tem dois pagamentos.
CREATE UNIQUE INDEX "pagamentos_pedido_id_key" ON "pagamentos"("pedido_id");
