/**
 * Loja de Módulos — PR 1, com o Prisma real num PostgreSQL real e as rotas de verdade. Prova:
 *  - a tabela nasce VAZIA e isso significa TUDO LIGADO (nada muda para quem nunca mexeu);
 *  - desligar grava UMA linha com a auditoria (quem e quando); religar mantém o rastro;
 *  - o NÚCLEO não desliga nem por chamada direta à função que grava;
 *  - DEPENDÊNCIA: desligar Estoque arrasta Compras; ligar Compras com Estoque off é recusado;
 *  - MULTIEMPRESA: o módulo desligado numa empresa não desliga na outra (o pior defeito possível);
 *  - o GATE DA API: escrever num módulo desligado é 403 — nem o administrador master passa — e
 *    a leitura de dado antigo continua de pé (desligar não apaga);
 *  - a DEGRADAÇÃO GRACIOSA, a regra mais importante: com o Estoque desligado, informar o consumo
 *    de material e CONCLUIR a OS (com a amarra da prestação ligada) não falha — o consumo fica
 *    registrado na OS e o razão do estoque não se mexe;
 *  - o CRON pula a empresa sem o módulo e volta a rodar ao religar, sem retroativo;
 *  - a tela de Configurações (ligar/desligar) é blindada a quem não administra a empresa.
 *
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/modulos-pg
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_modulos_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

/** Por padrão o administrador master da e1 — o caso mais forte: nem ele passa pelo módulo off. */
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

describe.skipIf(!URL_PG)("Loja de Módulos — entitlement por empresa (PostgreSQL real)", () => {
  let prisma: any;
  let mod: typeof import("@/lib/modulos/servidor");
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

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12345678000190", email: "e@x.com" },
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
    await prisma.produto.create({ data: { id: "p1", empresaId: "e1", nome: "Gás R410A", unidade: "KG" } });
    await prisma.fornecedor.create({ data: { id: "f1", empresaId: "e1", nome: "Refrimar", documento: "44555666000177" } });
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

  const linhas = () => prisma.empresaModulo.findMany({
    orderBy: { modulo: "asc" },
    select: { empresaId: true, modulo: true, ativo: true, alteradoPorId: true, alteradoEm: true },
  });

  /* ═════════ a tabela ═════════ */

  describe("A tabela nasce vazia, e isso quer dizer TUDO LIGADO", () => {
    it("sem nenhuma linha, a empresa tem todos os módulos — é o estado de produção hoje", async () => {
      expect(await linhas()).toHaveLength(0);
      expect([...(await mod.modulosDesligados("e1"))]).toEqual([]);
      for (const id of ["veiculos", "compras", "estoque", "financeiro"]) {
        expect(await mod.temModulo("e1", id), id).toBe(true);
      }
    });

    it("desligar grava UMA linha só, com quem e quando — e o resto continua sem linha nenhuma", async () => {
      await mod.definirModulo("e1", "veiculos", false, "uAdmin");
      const l = await linhas();
      expect(l).toHaveLength(1);
      expect(l[0]).toMatchObject({ empresaId: "e1", modulo: "veiculos", ativo: false, alteradoPorId: "uAdmin" });
      expect(l[0].alteradoEm).toBeInstanceOf(Date);
      expect(await mod.temModulo("e1", "veiculos")).toBe(false);
      expect(await mod.temModulo("e1", "compras")).toBe(true);
    });

    it("religar mantém a linha e o rastro novo (a mesma linha, pela única em empresa+módulo)", async () => {
      await mod.definirModulo("e1", "veiculos", false, "uAdmin");
      await mod.definirModulo("e1", "veiculos", true, "uOp");
      const l = await linhas();
      expect(l).toHaveLength(1);
      expect(l[0]).toMatchObject({ ativo: true, alteradoPorId: "uOp" });
      expect(await mod.temModulo("e1", "veiculos")).toBe(true);
    });

    it("o estado para a tela traz a auditoria por extenso; sem linha, nem auditoria", async () => {
      await mod.definirModulo("e1", "veiculos", false, "uAdmin");
      const [compras, frota] = await mod.estadoDosModulos("e1", ["compras", "veiculos"]);
      expect(frota).toMatchObject({ id: "veiculos", nome: "Frota", ativo: false, alteradoPor: "Gabi Gestora" });
      expect(frota.alteradoEm).toBeInstanceOf(Date);
      expect(compras).toMatchObject({ id: "compras", ativo: true, alteradoEm: null, alteradoPor: null });
    });
  });

  /* ═════════ núcleo e dependências ═════════ */

  describe("O núcleo não desliga; a dependência é respeitada", () => {
    it("desligar o núcleo é recusado — e não grava nada", async () => {
      for (const id of ["ordens", "clientes", "configuracoes"]) {
        const r = await mod.definirModulo("e1", id, false, "uAdmin");
        expect(r.ok, id).toBe(false);
        expect(r.erro, id).toMatch(/núcleo/);
      }
      expect(await linhas()).toHaveLength(0);
    });

    it("módulo que não existe no catálogo é recusado", async () => {
      expect(await mod.definirModulo("e1", "modulo-inventado", false, "uAdmin")).toMatchObject({ ok: false });
      expect(await linhas()).toHaveLength(0);
    });

    it("desligar Estoque ARRASTA Compras — as duas linhas, na mesma transação", async () => {
      const r = await mod.definirModulo("e1", "estoque", false, "uAdmin");
      expect(r).toMatchObject({ ok: true, arrastados: ["compras"] });
      expect((await linhas()).map((l: any) => [l.modulo, l.ativo])).toEqual([["compras", false], ["estoque", false]]);
      expect(await mod.temModulo("e1", "compras")).toBe(false);
    });

    it("ligar Compras com Estoque desligado é recusado, dizendo o que falta", async () => {
      await mod.definirModulo("e1", "estoque", false, "uAdmin");
      const r = await mod.definirModulo("e1", "compras", true, "uAdmin");
      expect(r.ok).toBe(false);
      expect(r.erro).toContain("Estoque");
      expect(await mod.temModulo("e1", "compras")).toBe(false);
    });

    it("ligando o Estoque de volta, Compras pode ser religado", async () => {
      await mod.definirModulo("e1", "estoque", false, "uAdmin");
      await mod.definirModulo("e1", "estoque", true, "uAdmin");
      expect((await mod.definirModulo("e1", "compras", true, "uAdmin")).ok).toBe(true);
      expect(await mod.temModulo("e1", "compras")).toBe(true);
    });
  });

  /* ═════════ multiempresa ═════════ */

  it("o módulo desligado numa empresa NÃO desliga na outra (nem com o cache já quente)", async () => {
    await mod.temModulo("e2", "veiculos"); // esquenta o cache da e2 ANTES de mexer na e1
    await mod.definirModulo("e1", "veiculos", false, "uAdmin");
    expect(await mod.temModulo("e1", "veiculos")).toBe(false);
    expect(await mod.temModulo("e2", "veiculos")).toBe(true);
    expect((await linhas()).every((l: any) => l.empresaId === "e1")).toBe(true);
  });

  /* ═════════ o gate da API ═════════ */

  describe("Frota desligada: a API recusa escrever e não mente na leitura", () => {
    let placa = 0;
    const criarVeiculo = () => chamar("veiculos", "POST", { placa: `ABC${++placa}D23`, modelo: "Saveiro", marca: "VW" });
    const lista = () => chamar("veiculos", "GET");

    it("ligada: a lista responde e o cadastro passa do portão", async () => {
      const r = await criarVeiculo();
      expect(r.json?.erro ?? r.status).toBeLessThan(300);
      const l = await lista();
      expect(l.status).toBe(200);
      expect(l.json.length).toBeGreaterThan(0);
    });

    it("desligada: cadastrar veículo é 403 — com o módulo e a mensagem que a tela precisa", async () => {
      await mod.definirModulo("e1", "veiculos", false, "uAdmin");
      const r = await criarVeiculo();
      expect(r.status).toBe(403);
      expect(r.json.modulo).toBe("veiculos");
      expect(r.json.erro).toContain("Frota");
      expect(r.json.erro).toContain("Configurações");
    });

    it("desligada: a LISTA devolve vazio em vez de 403 — quem chama é o formulário da OS e da equipe (núcleo)", async () => {
      await prisma.veiculo.create({ data: { empresaId: "e1", placa: "XYZ9A88", modelo: "Strada", marca: "Fiat" } });
      await mod.definirModulo("e1", "veiculos", false, "uAdmin");
      expect(await lista()).toMatchObject({ status: 200, json: [] });
      expect(await chamar("veiculos", "GET", undefined, {}, "?resumo=1")).toMatchObject({ status: 200, json: [] });
      // e os veículos continuam no banco: desligar nunca apaga
      expect(await prisma.veiculo.count({ where: { empresaId: "e1" } })).toBeGreaterThan(0);
    });

    it("a empresa que NÃO desligou segue cadastrando na mesma rota", async () => {
      await mod.definirModulo("e1", "veiculos", false, "uAdmin");
      logar({ id: "uB", empresaId: "e2" });
      const r = await criarVeiculo();
      expect(r.json?.erro ?? r.status).toBeLessThan(300);
    });

    it("sem permissão continua 403 de PERMISSÃO: o RBAC vem primeiro, são camadas distintas", async () => {
      logar({ id: "uOp", role: "OPERADOR", permissoes: montarPermissoes({ ordens: ["visualizar"] }) });
      const r = await criarVeiculo();
      expect(r.status).toBe(403);
      expect(r.json.erro).toContain("Sem permissão");
      expect(r.json.modulo).toBeUndefined();
    });
  });

  describe("Compras desligado: não nasce pedido novo, mas o que existe continua à vista", () => {
    const novoPedido = () => chamar("pedidos-compra", "POST", {
      fornecedorId: "f1", motivoAvulso: "Reposição de estoque",
      itens: [{ produtoId: "p1", descricao: "Gás R410A", unidade: "KG", quantidade: 2 }],
    });

    it("ligado: o pedido é criado", async () => {
      const r = await novoPedido();
      expect(r.json?.erro ?? r.status).toBeLessThan(300);
      expect(await prisma.pedidoCompraInterno.count()).toBeGreaterThan(0);
    });

    it("desligado: criar é 403 com o módulo, e nenhum pedido novo entra no banco", async () => {
      const antes = await prisma.pedidoCompraInterno.count();
      await mod.definirModulo("e1", "compras", false, "uAdmin");
      const r = await novoPedido();
      expect(r.status).toBe(403);
      expect(r.json).toMatchObject({ modulo: "compras" });
      expect(r.json.erro).toContain("Compras");
      expect(await prisma.pedidoCompraInterno.count()).toBe(antes);
    });

    it("sem a permissão de Compras, o 403 é de PERMISSÃO: a porta do usuário vem primeiro", async () => {
      await mod.definirModulo("e1", "compras", false, "uAdmin");
      logar({ id: "uOp", role: "OPERADOR", permissoes: montarPermissoes({ ordens: ["visualizar"] }) });
      const r = await novoPedido();
      expect(r.status).toBe(403);
      expect(r.json.modulo).toBeUndefined(); // quem não tem a permissão não precisa saber o que a empresa usa
    });

    it("desligado: o pedido que já existia continua sendo lido; o que MEXE nele é recusado", async () => {
      const r0 = await novoPedido();
      expect(r0.json?.erro ?? r0.status).toBeLessThan(300);
      const pedido = await prisma.pedidoCompraInterno.findFirst({ orderBy: { criadoEm: "desc" } });
      await mod.definirModulo("e1", "compras", false, "uAdmin");
      expect((await chamar("pedidos-compra", "GET")).status).toBe(200);
      expect((await chamar("pedidos-compra/[id]", "GET", undefined, { id: pedido.id })).status).toBe(200);
      const c = await chamar("pedidos-compra/[id]/cancelar", "POST", { motivo: "teste" }, { id: pedido.id });
      expect(c).toMatchObject({ status: 403, json: { modulo: "compras" } });
      expect((await prisma.pedidoCompraInterno.findUnique({ where: { id: pedido.id } })).status).not.toBe("CANCELADO");
    });
  });

  /* ═════════ a degradação graciosa ═════════ */

  describe("Degradação graciosa: o núcleo NUNCA quebra por um módulo opcional desligado", () => {
    /** OS recorrente (dispensa a trava de equipamento) com a atividade já concluída e um material. */
    const novaOs = async () => {
      const os = await prisma.ordemServico.create({ data: { empresaId: "e1", numero: `OSM-${++seq}`, clienteId: "c1", criadoPorId: "uAdmin", status: "EM_ANDAMENTO", origem: "RECORRENTE", descricao: "Preventiva" } });
      await prisma.atividadeOs.create({ data: { empresaId: "e1", ordemServicoId: os.id, titulo: "Preventiva", status: "CONCLUIDA" } });
      const item = await prisma.osItemOrcamento.create({ data: { ordemServicoId: os.id, tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 800, valorBase: 800 } });
      const material = await prisma.osMaterial.create({ data: { ordemServicoId: os.id, osItemId: item.id, produtoId: "p1", descricao: "Gás R410A", unidade: "KG", comportamento: "INCLUSO_NO_SERVICO", quantidade: 3, quantidadePadrao: 3, valorVendaUnit: 90, origem: "SOLTO" } });
      return { os, materialId: material.id };
    };
    const saldo = async () => Number((await prisma.produto.findUnique({ where: { id: "p1" } })).saldo);
    const razao = () => prisma.movimentacaoEstoque.count({ where: { produtoId: "p1" } });
    const informarConsumo = (osId: string, materialId: string, quantidade: number) =>
      chamar("ordens/[id]/consumo", "POST", { materiais: [{ id: materialId, quantidade }] }, { id: osId });
    const concluir = (osId: string) => chamar("ordens/[id]", "PUT", { status: "CONCLUIDA" }, { id: osId });

    beforeAll(async () => {
      // A amarra que trava a conclusão da OS enquanto o material não é prestado: LIGADA de
      // propósito, porque é o caminho em que o núcleo mais depende do estoque.
      await prisma.configuracao.update({ where: { empresaId: "e1" }, data: { osExigirPrestacaoMaterial: true } });
    });

    // Cada caso começa com 10 KG em estoque e o razão limpo
    beforeEach(async () => {
      await prisma.movimentacaoEstoque.deleteMany({});
      await prisma.produto.update({ where: { id: "p1" }, data: { saldo: 10 } });
    });

    it("com o Estoque LIGADO, informar o consumo baixa o saldo e lança no razão (o caminho normal)", async () => {
      const { os, materialId } = await novaOs();
      const r = await informarConsumo(os.id, materialId, 3);
      expect(r.json?.erro ?? r.status).toBe(200);
      expect(await saldo()).toBe(7);
      expect(await razao()).toBe(1);
    });

    it("com o Estoque DESLIGADO, informar o consumo NÃO falha: a OS registra e o razão fica intacto", async () => {
      await mod.definirModulo("e1", "estoque", false, "uAdmin");
      const { os, materialId } = await novaOs();

      // O PONTO DO PILOTO: isto não pode estourar nem responder 403
      const r = await informarConsumo(os.id, materialId, 3);
      expect(r.json?.erro ?? r.status).toBe(200);

      // o consumo FICA REGISTRADO na OS: o serviço aconteceu, e isso é do núcleo
      const m = await prisma.osMaterial.findUnique({ where: { id: materialId } });
      expect(m).toMatchObject({ estadoSeparacao: "CONSUMIDO", consumidoPorId: "uAdmin" });
      expect(Number(m.quantidadeConsumida)).toBe(3);
      expect(await prisma.osHistorico.count({ where: { ordemServicoId: os.id, acao: "Consumo de material informado" } })).toBe(1);
      // e o estoque não se mexeu: sem o módulo, não há razão nem saldo a manter
      expect(await saldo()).toBe(10);
      expect(await razao()).toBe(0);
    });

    it("CONCLUIR a OS com o Estoque desligado não falha — nem com a amarra da prestação ligada", async () => {
      await mod.definirModulo("e1", "estoque", false, "uAdmin");
      const { os, materialId } = await novaOs();
      expect((await informarConsumo(os.id, materialId, 3)).status).toBe(200);
      const r = await concluir(os.id);
      expect(r.json?.erro ?? r.status).toBe(200);
      expect((await prisma.ordemServico.findUnique({ where: { id: os.id } })).status).toBe("CONCLUIDA");
    });

    it("religando o Estoque, a baixa volta a acontecer — nada ficou quebrado no caminho", async () => {
      await mod.definirModulo("e1", "estoque", false, "uAdmin");
      await mod.definirModulo("e1", "estoque", true, "uAdmin");
      const { os, materialId } = await novaOs();
      expect((await informarConsumo(os.id, materialId, 2)).status).toBe(200);
      expect(await saldo()).toBe(8);
    });
  });

  /* ═════════ crons ═════════ */

  describe("Rotina automática: pausa na empresa sem o módulo, retoma quando religa", () => {
    it("`empresasComModulo` tira da lista só quem desligou", async () => {
      expect(await mod.empresasComModulo(["e1", "e2"], "financeiro")).toEqual(["e1", "e2"]);
      await mod.definirModulo("e1", "financeiro", false, "uAdmin");
      expect(await mod.empresasComModulo(["e1", "e2"], "financeiro")).toEqual(["e2"]);
      await mod.definirModulo("e1", "financeiro", true, "uAdmin");
      expect(await mod.empresasComModulo(["e1", "e2"], "financeiro")).toEqual(["e1", "e2"]);
    });

    it("o núcleo nunca é filtrado de uma rotina (nem se alguém gravar a linha na marra)", async () => {
      await prisma.empresaModulo.create({ data: { empresaId: "e1", modulo: "ordens", ativo: false } });
      expect(await mod.empresasComModulo(["e1", "e2"], "ordens")).toEqual(["e1", "e2"]);
    });

    it("a linha de núcleo gravada na marra não entra nem na LISTA de desligados (que vai para a tela)", async () => {
      await prisma.empresaModulo.createMany({ data: [
        { empresaId: "e1", modulo: "ordens", ativo: false },
        { empresaId: "e1", modulo: "veiculos", ativo: false },
      ] });
      mod.esquecerModulos();
      // a lista é o que o layout manda ao menu: núcleo ali seria o menu do Frivo sumindo
      expect([...(await mod.modulosDesligados("e1"))]).toEqual(["veiculos"]);
      expect(await mod.temModulo("e1", "ordens")).toBe(true);
    });
  });

  /* ═════════ o controle em Configurações ═════════ */

  describe("Ligar/desligar em Configurações: blindado a quem administra a empresa", () => {
    const ver = () => chamar("configuracoes/modulos", "GET");
    const definir = (modulo: string, ativo: boolean) => chamar("configuracoes/modulos", "PUT", { modulo, ativo });
    const previa = (modulo: string, ativo: boolean) => chamar("configuracoes/modulos", "POST", { modulo, ativo });

    it("quem administra vê os módulos com gate ligados, desliga um e a auditoria fica gravada", async () => {
      const antes = await ver();
      expect(antes.status).toBe(200);
      // a tela oferece os módulos COM GATE, na ordem do catálogo (a lista cresce a cada leva)
      expect(antes.json.modulos.map((m: any) => [m.id, m.ativo])).toEqual(
        [["veiculos", true], ["compras", true], ["equipamentos", true], ["qrcodes", true], ["estoque", true]]);

      const r = await definir("veiculos", false);
      expect(r.status).toBe(200);
      expect(r.json.modulos.find((m: any) => m.id === "veiculos")).toMatchObject({ ativo: false, alteradoPor: "Gabi Gestora" });
      expect(await linhas()).toMatchObject([{ modulo: "veiculos", ativo: false, alteradoPorId: "uAdmin" }]);
      expect((await definir("veiculos", true)).json.modulos.find((m: any) => m.id === "veiculos").ativo).toBe(true);
    });

    it("quem não administra a empresa não vê nem mexe (403), e nada muda no banco", async () => {
      logar({ id: "uOp", role: "OPERADOR", permissoes: montarPermissoes({ veiculos: ["visualizar", "gerenciar"], compras: ["gerenciar"] }) });
      expect((await ver()).status).toBe(403);
      expect((await definir("veiculos", false)).status).toBe(403);
      expect(await linhas()).toHaveLength(0);
    });

    it("módulo fora do piloto não se desliga por aqui (a migração é módulo a módulo)", async () => {
      const r = await definir("financeiro", false);
      expect(r.status).toBe(400);
      expect(r.json.erro).toContain("ainda não");
      expect(await linhas()).toHaveLength(0);
    });

    it("ligar Compras sem Estoque devolve 409 explicando o que falta", async () => {
      await mod.definirModulo("e1", "estoque", false, "uAdmin");
      const r = await definir("compras", true);
      expect(r.status).toBe(409);
      expect(r.json.erro).toContain("Estoque");
    });

    it("a prévia conta o que cai junto, antes de desligar", async () => {
      expect((await previa("compras", false)).json).toMatchObject({ arrastados: [], aviso: "" });
      // (o Estoque ainda não é desligável pela tela; a prévia já sabe a cascata para quando for)
      const p = await previa("estoque", false);
      expect(p.json.arrastados).toEqual(["compras"]);
      expect(p.json.aviso).toContain("Compras depende deste módulo");
    });
  });
});
