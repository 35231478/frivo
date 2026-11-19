/**
 * Loja de Módulos — leva ESTOQUE, com o Prisma real num PostgreSQL real e as rotas de verdade:
 *  - o gate do Estoque nas suas rotas de API (403 com o módulo, nem o administrador master passa)
 *    e a empresa vizinha seguindo normal;
 *  - a CASCATA Compras↔Estoque agora clicável: desligar Estoque arrasta Compras (com aviso),
 *    ligar Compras sem Estoque é recusado dizendo o que falta, e a ordem certa religa os dois;
 *  - o PADRÃO DOS CAMPOS-PONTE no servidor: o que é do módulo some, o que é do núcleo fica —
 *    o consumo de material e a conclusão da OS continuam, e o material consumido permanece;
 *  - a NF de compra: com o Estoque desligado ela ainda vira CONTA A PAGAR e NÃO mexe no razão,
 *    avisando; com o Estoque ligado, o razão é lançado como sempre;
 *  - desligar NUNCA apaga: produtos, movimentações e saldo ficam, e religar devolve tudo;
 *  - o sino (núcleo) não vira 403: só para de contar o que é de módulo desligado.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/modulos-estoque-pg
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_mod_estoque_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
const XML = readFileSync(path.resolve(__dirname, "fixtures/nfe/nfe-4521-frigelar.xml"), "utf8");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// O sino agenda trabalho para DEPOIS de responder (`after`), que só existe dentro do ciclo de um
// pedido de verdade. Fora dele, o resto da rota é o mesmo — e é o que este teste olha.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => {} }));
const logar = (o: { id?: string; empresaId?: string; role?: string; permissoes?: Permissoes } = {}) => {
  const id = o.id ?? "uAdmin";
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId: o.empresaId ?? "e1", role: o.role ?? "ADMIN", permissoes: o.permissoes ?? permissoesTotais(), tecnicoId: null } };
};

vi.setConfig({ testTimeout: 90_000 });

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}, busca = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${busca}`, {
    method: metodo, headers: { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const res: Response = await (mod as any)[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Loja de Módulos — Estoque (PostgreSQL real)", () => {
  let prisma: any;
  let mod: typeof import("@/lib/modulos/servidor");
  let notas: typeof import("@/lib/compras/notas");
  let seq = 0;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], {
      cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    mod = await import("@/lib/modulos/servidor");
    notas = await import("@/lib/compras/notas");

    // O CNPJ da empresa casa com o destinatário do XML da fixture (senão a importação recusa)
    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uAdmin", empresaId: "e1", nome: "Gabi Gestora", email: "g@x.com", senha: "x", role: "ADMIN" },
      { id: "uOp", empresaId: "e1", nome: "Caio Operador", email: "c@x.com", senha: "x", role: "OPERADOR" },
      { id: "uB", empresaId: "e2", nome: "Beto", email: "b@x.com", senha: "x", role: "ADMIN" },
    ] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.cliente.create({ data: { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" } });
    await prisma.servico.create({ data: { id: "sInst", empresaId: "e1", codigo: "INST01", nome: "Instalação split", valorPadrao: 800 } });
    await prisma.produto.createMany({ data: [
      { id: "p1", empresaId: "e1", nome: "Gás R410A", unidade: "KG", saldo: 10 },
      { id: "p2", empresaId: "e1", nome: "Capacitor", unidade: "un", saldo: 4 },
      { id: "p9", empresaId: "e2", nome: "Da outra", unidade: "un", saldo: 7 },
    ] });
    // a amarra que trava a conclusão enquanto o material não é prestado: o caminho mais exigente
    await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { osExigirPrestacaoMaterial: true } });
    logar();
  }, 180_000);

  afterEach(async () => {
    logar();
    await prisma.empresaModulo.deleteMany({});
    mod.esquecerModulos();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const desligar = (modulo: string) => mod.definirModulo("e1", modulo, false, "uAdmin");
  const ligar = (modulo: string) => mod.definirModulo("e1", modulo, true, "uAdmin");

  /* ═════════ o gate nas rotas do Estoque ═════════ */

  describe("A API do Estoque recusa o módulo desligado", () => {
    const lista = () => chamar("estoque", "GET");

    it("ligado: a lista do estoque responde com os produtos", async () => {
      const r = await lista();
      expect(r.status).toBe(200);
    });

    it("desligado: 403 com o módulo e a mensagem que a tela precisa", async () => {
      await desligar("estoque");
      const r = await lista();
      expect(r.status).toBe(403);
      expect(r.json.modulo).toBe("estoque");
      expect(r.json.erro).toContain("Estoque");
      expect(r.json.erro).toContain("Configurações");
    });

    it("desligado: separar material da OS também é recusado (é operação do módulo)", async () => {
      await desligar("estoque");
      const r = await chamar("ordens/[id]/separacao", "POST", { materiais: [] }, { id: "os-qualquer" });
      expect(r).toMatchObject({ status: 403, json: { modulo: "estoque" } });
    });

    it("a empresa vizinha não sente nada", async () => {
      await desligar("estoque");
      logar({ id: "uB", empresaId: "e2" });
      expect((await lista()).status).toBe(200);
    });

    it("sem permissão continua 403 de PERMISSÃO (o RBAC é a primeira porta)", async () => {
      logar({ id: "uOp", role: "OPERADOR", permissoes: montarPermissoes({ ordens: ["visualizar"] }) });
      const r = await lista();
      expect(r.status).toBe(403);
      expect(r.json.modulo).toBeUndefined();
    });
  });

  /* ═════════ a cascata, agora pela tela ═════════ */

  describe("Cascata Compras ↔ Estoque pela tela de Configurações", () => {
    const ver = () => chamar("configuracoes/modulos", "GET");
    const definir = (modulo: string, ativo: boolean) => chamar("configuracoes/modulos", "PUT", { modulo, ativo });
    const previa = (modulo: string, ativo: boolean) => chamar("configuracoes/modulos", "POST", { modulo, ativo });

    it("a tela passa a oferecer os três (Frota, Compras e Estoque)", async () => {
      const r = await ver();
      expect(r.status).toBe(200);
      expect(r.json.modulos.map((m: any) => m.id)).toEqual(["veiculos", "compras", "estoque"]);
      expect(r.json.modulos.every((m: any) => m.ativo)).toBe(true);
    });

    it("a prévia avisa, ANTES de desligar, que Compras cai junto", async () => {
      const p = await previa("estoque", false);
      expect(p.json.arrastados).toEqual(["compras"]);
      expect(p.json.aviso).toContain("Compras depende deste módulo");
      expect(p.json.aviso).toContain("Nada é apagado");
      // e nada foi desligado só por perguntar
      expect(await prisma.empresaModulo.count()).toBe(0);
    });

    it("desligar o Estoque pela tela arrasta Compras — as duas linhas, com auditoria", async () => {
      const r = await definir("estoque", false);
      expect(r.status).toBe(200);
      expect(r.json.arrastados).toEqual(["compras"]);
      expect(r.json.aviso).toContain("Compras depende deste módulo");
      const estado = Object.fromEntries(r.json.modulos.map((m: any) => [m.id, m.ativo]));
      expect(estado).toMatchObject({ estoque: false, compras: false, veiculos: true });
      const linhas = await prisma.empresaModulo.findMany({ orderBy: { modulo: "asc" }, select: { modulo: true, ativo: true, alteradoPorId: true } });
      expect(linhas).toMatchObject([{ modulo: "compras", ativo: false, alteradoPorId: "uAdmin" }, { modulo: "estoque", ativo: false, alteradoPorId: "uAdmin" }]);
    });

    it("ligar Compras com o Estoque desligado: 409 dizendo o que falta", async () => {
      await definir("estoque", false);
      const r = await definir("compras", true);
      expect(r.status).toBe(409);
      expect(r.json.erro).toContain("Estoque");
      expect(await mod.temModulo("e1", "compras")).toBe(false);
    });

    it("na ordem certa, os dois voltam", async () => {
      await definir("estoque", false);
      expect((await definir("estoque", true)).status).toBe(200);
      expect((await definir("compras", true)).status).toBe(200);
      expect(await mod.temModulo("e1", "compras")).toBe(true);
      expect(await mod.temModulo("e1", "estoque")).toBe(true);
    });

    it("desligar Compras sozinho NÃO derruba o Estoque (a dependência tem um sentido)", async () => {
      const r = await definir("compras", false);
      expect(r.json.arrastados).toEqual([]);
      expect(await mod.temModulo("e1", "estoque")).toBe(true);
    });
  });

  /* ═════════ o núcleo continua inteiro ═════════ */

  describe("Campos-ponte: o que é do Estoque some, o que é da OS fica", () => {
    const novaOs = async () => {
      const os = await prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OSE-${++seq}`, clienteId: "c1", criadoPorId: "uAdmin", status: "EM_ANDAMENTO", origem: "RECORRENTE", descricao: "Preventiva" } });
      await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: os.id, titulo: "Preventiva", status: "CONCLUIDA" } });
      const item = await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 800, valorBase: 800 } });
      const material = await prisma.osMaterial.create({ data: { ordemServicoId: os.id, osItemId: item.id, produtoId: "p1", descricao: "Gás R410A", unidade: "KG", comportamento: "INCLUSO_NO_SERVICO", quantidade: 3, quantidadePadrao: 3, valorVendaUnit: 90, origem: "SOLTO" } });
      return { os, materialId: material.id };
    };
    const saldo = async () => Number((await prisma.produto.findUnique({ where: { id: "p1" } })).saldo);
    const razao = () => prisma.movimentacaoEstoque.count({ where: { produtoId: "p1" } });

    afterEach(async () => {
      await prisma.movimentacaoEstoque.deleteMany({});
      await prisma.produto.update({ where: { id: "p1" }, data: { saldo: 10 } });
    });

    it("com o Estoque desligado, informar consumo e CONCLUIR a OS continuam funcionando", async () => {
      await desligar("estoque");
      const { os, materialId } = await novaOs();
      const consumo = await chamar("ordens/[id]/consumo", "POST", { materiais: [{ id: materialId, quantidade: 3 }] }, { id: os.id });
      expect(consumo.json?.erro ?? consumo.status).toBe(200);
      const concluir = await chamar("ordens/[id]", "PUT", { status: "CONCLUIDA" }, { id: os.id });
      expect(concluir.json?.erro ?? concluir.status).toBe(200);
      expect((await prisma.ordemServico.findUnique({ where: { id: os.id } })).status).toBe("CONCLUIDA");
    });

    it("…e o MATERIAL CONSUMIDO permanece na OS: o custo do serviço é do núcleo", async () => {
      await desligar("estoque");
      const { os, materialId } = await novaOs();
      await chamar("ordens/[id]/consumo", "POST", { materiais: [{ id: materialId, quantidade: 2 }] }, { id: os.id });
      const m = await prisma.osMaterial.findUnique({ where: { id: materialId } });
      expect(m).toMatchObject({ estadoSeparacao: "CONSUMIDO", consumidoPorId: "uAdmin" });
      expect(Number(m.quantidadeConsumida)).toBe(2);
      expect(Number(m.valorVendaUnit)).toBe(90); // o valor do material continua na OS
      expect(await prisma.osHistorico.count({ where: { ordemServicoId: os.id, acao: "Consumo de material informado" } })).toBe(1);
      // o que NÃO existe é o razão: nem movimento, nem saldo mexido
      expect(await razao()).toBe(0);
      expect(await saldo()).toBe(10);
    });

    it("com o Estoque ligado, o mesmo consumo baixa o saldo (nada mudou para quem usa o módulo)", async () => {
      const { os, materialId } = await novaOs();
      await chamar("ordens/[id]/consumo", "POST", { materiais: [{ id: materialId, quantidade: 3 }] }, { id: os.id });
      expect(await saldo()).toBe(7);
      expect(await razao()).toBe(1);
    });
  });

  /* ═════════ a NF de compra ═════════ */

  describe("NF de compra: conta a pagar sim, razão não", () => {
    const importar = () => notas.importarNota({ empresaId: "e1", usuarioId: "uAdmin", xml: XML });
    const escolhasDe = async (notaId: string) => {
      const itens = await prisma.notaCompraItem.findMany({ where: { notaId }, orderBy: { numeroItem: "asc" }, select: { id: true } });
      // cada item vira um produto novo (o de-para aprende) — o que importa aqui é o que acontece com o razão
      return itens.map((i: any, n: number) => ({ itemId: i.id, novo: { nome: `Item da NF ${n + 1}` } }));
    };
    const limpar = async () => {
      await prisma.contaPagar.deleteMany({});
      await prisma.movimentacaoEstoque.deleteMany({});
      await prisma.notaCompraItem.deleteMany({});
      await prisma.deParaProdutoFornecedor.deleteMany({});
      await prisma.notaCompra.deleteMany({});
      await prisma.produto.deleteMany({ where: { empresaId: "e1", NOT: { id: { in: ["p1", "p2"] } } } });
    };
    afterEach(limpar);

    it("com o Estoque DESLIGADO: a dívida com o fornecedor nasce, o razão fica intacto — e a nota avisa", async () => {
      await desligar("estoque");
      const { nota } = await importar();
      const r = await notas.lancarNota({ empresaId: "e1", usuarioId: "uAdmin", notaId: nota.id, escolhas: await escolhasDe(nota.id), podePrecificar: true });

      expect(await prisma.contaPagar.count()).toBeGreaterThan(0);
      expect(r.contas.length).toBeGreaterThan(0);
      expect(r.contas.reduce((t: number, c: any) => t + c.valor, 0)).toBeGreaterThan(0);
      expect(await prisma.movimentacaoEstoque.count()).toBe(0);
      expect(r.avisos.join(" ")).toContain("Estoque desligado");
      expect((await prisma.notaCompra.findUnique({ where: { id: nota.id } })).status).toBe("LANCADA");
    });

    it("com o Estoque LIGADO: a mesma nota lança o razão e as contas (o caminho normal)", async () => {
      const { nota } = await importar();
      const r = await notas.lancarNota({ empresaId: "e1", usuarioId: "uAdmin", notaId: nota.id, escolhas: await escolhasDe(nota.id), podePrecificar: true });
      expect(await prisma.movimentacaoEstoque.count()).toBeGreaterThan(0);
      expect(await prisma.contaPagar.count()).toBe(r.contas.length);
      expect(r.avisos.join(" ")).not.toContain("Estoque desligado");
    });
  });

  /* ═════════ desligar não apaga ═════════ */

  describe("Desligar nunca apaga; religar devolve tudo", () => {
    it("produtos, movimentações e saldo ficam no banco com o módulo desligado", async () => {
      await prisma.movimentacaoEstoque.create({ data: { empresaId: "e1", produtoId: "p2", tipo: "ENTRADA", origem: "COMPRA", quantidade: 4, saldoApos: 4 } });
      const antes = { produtos: await prisma.produto.count({ where: { empresaId: "e1" } }), movs: await prisma.movimentacaoEstoque.count(), saldo: Number((await prisma.produto.findUnique({ where: { id: "p2" } })).saldo) };

      await desligar("estoque");
      expect(await prisma.produto.count({ where: { empresaId: "e1" } })).toBe(antes.produtos);
      expect(await prisma.movimentacaoEstoque.count()).toBe(antes.movs);

      await ligar("estoque");
      const r = await chamar("estoque", "GET");
      expect(r.status).toBe(200);
      expect(Number((await prisma.produto.findUnique({ where: { id: "p2" } })).saldo)).toBe(antes.saldo);
      await prisma.movimentacaoEstoque.deleteMany({});
    });
  });

  /* ═════════ o sino ═════════ */

  describe("O sino é do núcleo: não dá 403, só para de contar o que é de módulo desligado", () => {
    const sino = () => chamar("alertas", "GET");

    /** Uma OS viva com material por separar: é o que alimenta a fila do sino. */
    const osNaFila = async () => {
      const os = await prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OSF-${++seq}`, clienteId: "c1", criadoPorId: "uAdmin", status: "EM_ANDAMENTO", origem: "MANUAL", descricao: "Troca de compressor" } });
      const item = await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 800, valorBase: 800 } });
      await prisma.osMaterial.create({ data: { ordemServicoId: os.id, osItemId: item.id, produtoId: "p1", descricao: "Gás R410A", unidade: "KG", comportamento: "INCLUSO_NO_SERVICO", quantidade: 3, quantidadePadrao: 3, valorVendaUnit: 90, origem: "SOLTO" } });
      return os;
    };

    it("com o Estoque LIGADO, a fila de separação conta no sino (a massa existe)", async () => {
      await osNaFila();
      const r = await sino();
      expect(r.status).toBe(200);
      expect(r.json.separacoesPendentes).toBeGreaterThan(0);
      await prisma.osMaterial.deleteMany({});
      await prisma.osItemOrcamento.deleteMany({});
      await prisma.ordemServico.deleteMany({});
    });

    it("com o Estoque desligado, a MESMA fila some do sino — e o resto responde", async () => {
      await osNaFila();
      await desligar("estoque");
      const r = await sino();
      expect(r.status).toBe(200);
      expect(r.json.separacoesPendentes).toBe(0);
      expect(r.json.devolucoesPendentes).toBe(0);
      expect(r.json).toHaveProperty("total");
      // a OS e o material continuam no banco: o sino só deixou de contar
      expect(await prisma.osMaterial.count()).toBe(1);
      await prisma.osMaterial.deleteMany({});
      await prisma.osItemOrcamento.deleteMany({});
      await prisma.ordemServico.deleteMany({});
    });

    it("com a Frota desligada, os avisos de veículo somem do sino", async () => {
      await prisma.veiculo.create({ data: { empresaId: "e1", placa: "ABC1D23", modelo: "Saveiro", marca: "VW", status: "MANUTENCAO" } });
      await mod.definirModulo("e1", "veiculos", false, "uAdmin");
      const r = await sino();
      expect(r.status).toBe(200);
      expect(r.json.veiculosManutencao).toBe(0);
      expect(r.json.checklistPendente).toBe(0);
      // e o veículo continua no banco: o sino só deixou de contar
      expect(await prisma.veiculo.count({ where: { empresaId: "e1" } })).toBe(1);
      await prisma.veiculo.deleteMany({});
    });
  });
});
