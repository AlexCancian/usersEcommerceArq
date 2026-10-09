import { PrismaClient, Perfil } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Iniciando execução do seed...");

  const saltRounds = 10;
  const adminSenhaHash = await bcrypt.hash("admin123", saltRounds);
  const clienteSenhaHash = await bcrypt.hash("cliente123", saltRounds);

  // 1. Usuário Administrador
  const adminEmail = "admin@loja.com";
  const existingAdmin = await prisma.usuario.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const admin = await prisma.usuario.create({
      data: {
        nome: "Administrador da Loja",
        email: adminEmail,
        senha_hash: adminSenhaHash,
        perfil: Perfil.admin,
      },
    });
    console.log(`✅ Usuário administrador criado: ${admin.email} (ID: ${admin.id})`);
  } else {
    console.log(`ℹ️ Usuário administrador já existe: ${existingAdmin.email}`);
  }

  // 2. Usuário Cliente com um endereço
  const clienteEmail = "cliente@loja.com";
  let cliente = await prisma.usuario.findUnique({
    where: { email: clienteEmail },
    include: { enderecos: true },
  });

  if (!cliente) {
    cliente = await prisma.usuario.create({
      data: {
        nome: "Cliente de Teste",
        email: clienteEmail,
        senha_hash: clienteSenhaHash,
        perfil: Perfil.cliente,
        enderecos: {
          create: {
            apelido: "Casa",
            cep: "01001-000",
            logradouro: "Praça da Sé",
            numero: "100",
            complemento: "Apto 101",
            cidade: "São Paulo",
            uf: "SP",
            principal: true,
          },
        },
      },
      include: { enderecos: true },
    });
    console.log(`✅ Usuário cliente com endereço criado: ${cliente.email} (ID: ${cliente.id})`);
  } else {
    console.log(`ℹ️ Usuário cliente já existe: ${cliente.email}`);

    // Garante que o cliente tenha ao menos um endereço sem duplicar
    if (cliente.enderecos.length === 0) {
      await prisma.endereco.create({
        data: {
          usuario_id: cliente.id,
          apelido: "Casa",
          cep: "01001-000",
          logradouro: "Praça da Sé",
          numero: "100",
          complemento: "Apto 101",
          cidade: "São Paulo",
          uf: "SP",
          principal: true,
        },
      });
      console.log(`✅ Endereço padrão associado ao cliente existente.`);
    }
  }

  console.log("✨ Seed concluído com sucesso e idempotência garantida!");
}

main()
  .catch((e) => {
    console.error("❌ Erro durante a execução do seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
