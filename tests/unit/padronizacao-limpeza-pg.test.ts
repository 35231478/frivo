/**
 * Limpeza única da digitação (lib/texto/limpeza.ts) — Prisma real, PostgreSQL real (schema descartável
 * via `prisma db push`). Prova:
 *  - PRÉVIA (planejar) lista o que mudaria (de → para) e NÃO grava;
 *  - APLICAR grava só os campos que mudam, em todas as entidades;
 *  - idempotente: aplicar de novo não acha mais nada;
 *  - multiempresa: a limpeza de uma empresa não toca na outra.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-limpeza-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_padroniza_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

vi.setConfig({ testTimeout: 60_000 });

describe.skipIf(!URL_PG)("Limpeza de digitação (PostgreSQL real)", () => {
  let prisma: any;
  let limpeza: typeof import("@/lib/texto/limpeza");

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=8`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    limpeza = await import("@/lib/texto/limpeza");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    // e1 — tudo "sujo"
    await prisma.cliente.create({ data: {
      id: "c1", empresaId: "e1", nome: "TERMOFRIO ENGENHARIA LTDA", cpfCnpj: "11222333000181",
      email: "VENDAS@Termofrio.COM", contato: "joão da silva", cidade: "GOIÂNIA", bairro: "SETOR CENTRAL",
      observacoes: "Cliente PEDIU revisão",
    } });
    await prisma.unidade.create({ data: { id: "u1", empresaId: "e1", clienteId: "c1", nome: "MATRIZ", logradouro: "av central", cidade: "GOIÂNIA" } });
    await prisma.contatoCliente.create({ data: { id: "ct1", empresaId: "e1", clienteId: "c1", nome: "ANA souza", cargo: "gerente de compras", email: "ANA@X.COM" } });
    await prisma.tecnico.create({ data: { id: "t1", empresaId: "e1", nome: "carlos EDUARDO", cpf: "11122233344", telefone: "6299990000", cidade: "aparecida de goiânia" } });
    await prisma.fornecedor.create({ data: { id: "f1", empresaId: "e1", nome: "FRIGELAR distribuidora", email: "X@Y.COM" } });
    await prisma.equipe.create({ data: { id: "eq1", empresaId: "e1", nome: "EQUIPE alpha" } });
    await prisma.usuario.create({ data: { id: "us1", empresaId: "e1", nome: "maria DAS dores", email: "maria@x.com", senha: "h" } });
    // e2 — também "sujo", para provar que a limpeza de e1 não encosta
    await prisma.cliente.create({ data: { id: "c2", empresaId: "e2", nome: "DA OUTRA EMPRESA LTDA", cpfCnpj: "11222333000343", cidade: "SÃO PAULO" } });
  }, 60_000);

  afterAll(async () => {
    if (!URL_PG) return;
    await prisma?.$executeRawUnsafe?.(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    await prisma?.$disconnect?.();
  });

  it("PRÉVIA lista o que mudaria e NÃO grava", async () => {
    const plano = await limpeza.planejarLimpezaCaixa("e1");
    expect(plano.totalCampos).toBeGreaterThan(0);
    expect(plano.totalRegistros).toBeGreaterThan(0);
    // tem a mudança do nome do cliente, de → para
    const mudCliente = plano.amostra.find((m) => m.id === "c1" && m.campo === "nome");
    expect(mudCliente).toBeTruthy();
    expect(mudCliente!.de).toBe("TERMOFRIO ENGENHARIA LTDA");
    expect(mudCliente!.para).toBe("Termofrio Engenharia Ltda");
    // cobre todas as entidades esperadas
    const entidades = plano.porEntidade.map((e) => e.entidade).sort();
    expect(entidades).toEqual(["clientes", "colaboradores", "contatos", "equipes", "fornecedores", "unidades", "usuarios"]);
    // nada foi gravado: o banco segue sujo
    const c = await prisma.cliente.findUnique({ where: { id: "c1" } });
    expect(c.nome).toBe("TERMOFRIO ENGENHARIA LTDA");
  });

  it("APLICAR grava a padronização em todas as entidades (e observação só perde espaços)", async () => {
    const res = await limpeza.aplicarLimpezaCaixa("e1");
    expect(res.totalCampos).toBeGreaterThan(0);

    const c = await prisma.cliente.findUnique({ where: { id: "c1" } });
    expect(c.nome).toBe("Termofrio Engenharia Ltda");
    expect(c.email).toBe("vendas@termofrio.com");
    expect(c.contato).toBe("João da Silva");
    expect(c.cidade).toBe("Goiânia");
    expect(c.bairro).toBe("Setor Central");
    expect(c.observacoes).toBe("Cliente PEDIU revisão"); // casing intacto

    expect((await prisma.unidade.findUnique({ where: { id: "u1" } })).nome).toBe("Matriz");
    const ct = await prisma.contatoCliente.findUnique({ where: { id: "ct1" } });
    expect(ct.nome).toBe("Ana Souza");
    expect(ct.cargo).toBe("Gerente de Compras");
    expect(ct.email).toBe("ana@x.com");
    expect((await prisma.tecnico.findUnique({ where: { id: "t1" } })).cidade).toBe("Aparecida de Goiânia");
    expect((await prisma.fornecedor.findUnique({ where: { id: "f1" } })).nome).toBe("Frigelar Distribuidora");
    expect((await prisma.equipe.findUnique({ where: { id: "eq1" } })).nome).toBe("Equipe Alpha");
    expect((await prisma.usuario.findUnique({ where: { id: "us1" } })).nome).toBe("Maria das Dores");
  });

  it("idempotente: aplicar de novo não acha mais nada", async () => {
    const plano = await limpeza.planejarLimpezaCaixa("e1");
    expect(plano.totalCampos).toBe(0);
    expect(plano.porEntidade).toHaveLength(0);
    const res = await limpeza.aplicarLimpezaCaixa("e1");
    expect(res.totalCampos).toBe(0);
  });

  it("multiempresa: a empresa e2 ficou intacta", async () => {
    const c2 = await prisma.cliente.findUnique({ where: { id: "c2" } });
    expect(c2.nome).toBe("DA OUTRA EMPRESA LTDA"); // nunca tocado pela limpeza de e1
    // e a limpeza de e2 enxerga o dela
    const plano2 = await limpeza.planejarLimpezaCaixa("e2");
    const mud = plano2.amostra.find((m) => m.id === "c2" && m.campo === "nome");
    expect(mud!.para).toBe("Da Outra Empresa Ltda");
  });
});
