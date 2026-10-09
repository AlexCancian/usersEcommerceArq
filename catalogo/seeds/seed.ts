import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { Categoria } from "../src/models/categoria.model.js";
import { Produto } from "../src/models/produto.model.js";

async function runSeed() {
  console.log("🌱 Conectando ao MongoDB para execução do seed do catálogo...");
  await mongoose.connect(env.MONGO_URI);

  console.log("📂 Sincronizando índices do Mongoose...");
  await Categoria.syncIndexes();
  await Produto.syncIndexes();

  // 1. As 3 Categorias Obrigatórias (Slide 2)
  const categoriasData = [
    { nome: "Celulares", slug: "celulares" },
    { nome: "Roupas", slug: "roupas" },
    { nome: "Livros", slug: "livros" },
  ];

  console.log("📦 Inserindo/Atualizando categorias (idempotente)...");
  for (const cat of categoriasData) {
    await Categoria.findOneAndUpdate(
      { slug: cat.slug },
      { $set: cat },
      { upsert: true, new: true }
    );
    console.log(`  ✓ Categoria pronta: ${cat.nome} (${cat.slug})`);
  }

  // 2. Pelo menos 10 produtos obrigatórios com atributos heterogêneos por categoria (Slide 2)
  const produtosData = [
    // --- CELULARES (atributos: memoria, cor, tela, 5G) ---
    {
      sku: "CEL-001",
      nome: "Smartphone X",
      categoria: "celulares",
      preco: 2499.9,
      ativo: true,
      atributos: {
        memoria: "128GB",
        cor: "preto",
        tela: "6.1 polegadas",
        conectividade: "5G",
      },
      estoque: { disponivel: 10, reservado: 0 },
    },
    {
      sku: "CEL-002",
      nome: "Smartphone Pro Max",
      categoria: "celulares",
      preco: 4899.0,
      ativo: true,
      atributos: {
        memoria: "256GB",
        cor: "titânio azul",
        tela: "6.7 polegadas",
        camera: "48MP",
      },
      estoque: { disponivel: 15, reservado: 2 },
    },
    {
      sku: "CEL-003",
      nome: "Smartphone Lite Edition",
      categoria: "celulares",
      preco: 1299.0,
      ativo: true,
      atributos: {
        memoria: "64GB",
        cor: "branco",
        tela: "6.4 polegadas",
      },
      estoque: { disponivel: 25, reservado: 1 },
    },
    {
      sku: "CEL-004",
      nome: "Smartphone Fold Ultra",
      categoria: "celulares",
      preco: 7999.0,
      ativo: true,
      atributos: {
        memoria: "512GB",
        cor: "preto fosco",
        tipo: "dobrável",
      },
      estoque: { disponivel: 5, reservado: 0 },
    },

    // --- ROUPAS (atributos: tamanho, tecido, cor, corte) ---
    {
      sku: "CAM-010",
      nome: "Camiseta básica",
      categoria: "roupas",
      preco: 59.9,
      ativo: true,
      atributos: {
        tamanho: "M",
        tecido: "algodão",
        gola: "redonda",
        cor: "cinza mescla",
      },
      estoque: { disponivel: 40, reservado: 0 },
    },
    {
      sku: "CAL-020",
      nome: "Calça Jeans Slim",
      categoria: "roupas",
      preco: 189.9,
      ativo: true,
      atributos: {
        tamanho: "42",
        tecido: "denim elastano",
        lavagem: "escura",
      },
      estoque: { disponivel: 20, reservado: 3 },
    },
    {
      sku: "JAQ-030",
      nome: "Jaqueta Corta-Vento",
      categoria: "roupas",
      preco: 299.0,
      ativo: true,
      atributos: {
        tamanho: "G",
        tecido: "poliéster impermeável",
        capuz: true,
        cor: "verde militar",
      },
      estoque: { disponivel: 12, reservado: 1 },
    },

    // --- LIVROS (atributos: autor, paginas, editora, ano, isbn) ---
    {
      sku: "LIV-101",
      nome: "Clean Architecture",
      categoria: "livros",
      preco: 94.5,
      ativo: true,
      atributos: {
        autor: "Robert C. Martin",
        paginas: 352,
        editora: "Alta Books",
        idioma: "Português",
      },
      estoque: { disponivel: 30, reservado: 4 },
    },
    {
      sku: "LIV-102",
      nome: "Domain-Driven Design",
      categoria: "livros",
      preco: 124.9,
      ativo: true,
      atributos: {
        autor: "Eric Evans",
        paginas: 560,
        editora: "Ciência Moderna",
        formato: "Capa comum",
      },
      estoque: { disponivel: 18, reservado: 0 },
    },
    {
      sku: "LIV-103",
      nome: "O Programador Pragmático",
      categoria: "livros",
      preco: 88.0,
      ativo: true,
      atributos: {
        autor: "David Thomas, Andrew Hunt",
        paginas: 344,
        editora: "Bookman",
        edicao: "2ª Edição Especial",
      },
      estoque: { disponivel: 22, reservado: 2 },
    },
  ];

  console.log("🛍️ Inserindo/Atualizando 10 produtos com atributos dinâmicos (idempotente)...");
  for (const prod of produtosData) {
    await Produto.findOneAndUpdate(
      { sku: prod.sku },
      { $set: prod },
      { upsert: true, new: true }
    );
    console.log(`  ✓ Produto pronto: [${prod.sku}] ${prod.nome} (${prod.categoria})`);
  }

  console.log("✨ Seed do catálogo finalizado com sucesso!");
}

runSeed()
  .catch((err) => {
    console.error("❌ Erro durante o seed do catálogo:", err);
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
