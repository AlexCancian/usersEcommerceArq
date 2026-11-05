-- AlterTable (aula 08): motivo do cancelamento automático por estoque.insuficiente
ALTER TABLE "pedidos" ADD COLUMN "motivo_cancelamento" TEXT;
