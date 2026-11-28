/**
 * Leva I.2 — grupo B, com as rotas reais e o Prisma real num PostgreSQL real:
 *  5. medição/fatura (POST /api/medicoes e PUT /api/medicoes/[id]): o preço da tabela do cliente não muda sem a
 *     permissão "Alterar preço de tabela" (403, nada gravado); com ela, só com o motivo (400 sem ele,
 *     { precoTabela: true }); gravado, a trilha (empresa_eventos, PRECO_TABELA_FATURA) registra o documento, quem, o
 *     quê e o motivo; editar com o preço já gravado não pede de novo; cliente sem tabela, livre;
 *  6. reajuste em massa (POST /api/cadastros/tabelas-preco/[id]/reajustes e .../desfazer): a prévia não grava; aplicar
 *     grava os preços e o lote (antes/depois); só os escolhidos; motivo obrigatório; quem não edita tabela = 403; tabela
 *     de outra empresa = 404; desfazer volta só os itens que estão como o lote deixou (o mudado depois fica, com
 *     aviso), mesmo depois de salvar a tabela no editor (linhas recriadas); desfazer de novo pega o lote anterior;
 *     sem lote = 409.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/leva-i2-b-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva_i2b_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 60_000 });

type Quem = "operador" | "comPermissao" | "semConfig";
const perms = (quem: Quem): Permissoes => {
  const p = permissoesTotais();
  if (quem === "operador") p.orcamentos = { ...p.orcamentos, alterarPrecoTabela: false };
  if (quem === "semConfig") p.configuracoes = { ...p.configuracoes, gerenciar: false };
  return p;
};
const logar = (quem: Quem, empresaId = "e1") => {
  const id = { operador: "uOp", comPermissao: "uPerm", semConfig: "uVer" }[quem];
  sessao.atual = { user: { id, name: id, email: `${id}@ficticio.test`, empresaId, tecnicoId: null, role: "OPERADOR", permissoes: perms(quem) } };
};

async function chamar(rota: string, metodo: string, corpo?: unknown, params: Record<string, string> = {}) {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest("http://localhost/api/x", { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe.skipIf(!URL_PG)("Leva I.2 — grupo B (PostgreSQL real)", () => {
  let prisma: any;

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["medicoes", "medicoes/[id]", "cadastros/[entidade]/[id]/reajustes", "cadastros/[entidade]/[id]/reajustes/desfazer", "cadastros/[entidade]/[id]"]
      .map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Refrigeração Fictícia", cnpj: "12345678000190", email: "e@ficticio.test" }, { id: "e2", nome: "Outra Fictícia", cnpj: "98765432000110", email: "o@ficticio.test" }] });
    await prisma.usuario.createMany({ data: ["uOp", "uPerm", "uVer"].map((id) => ({ id, empresaId: "e1", nome: `Pessoa ${id}`, email: `${id}@ficticio.test`, senha: "x" })) });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1" }, { empresaId: "e2" }] });
    await prisma.servico.createMany({ data: [
      { id: "sLimp", empresaId: "e1", codigo: "LIMP01", nome: "Limpeza", valorPadrao: 200 },
      { id: "sInst", empresaId: "e1", codigo: "INST01", nome: "Instalação", valorPadrao: 1000 },
      { id: "sVisita", empresaId: "e1", codigo: "VIS01", nome: "Visita", valorPadrao: 90 },
    ] });
    await prisma.produto.create({ data: { id: "pFiltro", empresaId: "e1", nome: "Filtro", unidade: "un", valorPadrao: 100, saldo: 10 } });
    // Tabela da medição: Limpeza 150 e Filtro 80
    await prisma.tabelaPreco.create({ data: { id: "tab", empresaId: "e1", nome: "Contrato fictício", itens: { create: [
      { servicoId: "sLimp", tipoPreco: "VALOR_FIXO", valorFixo: 150, valorFinal: 150 }, { produtoId: "pFiltro", tipoPreco: "VALOR_FIXO", valorFixo: 80, valorFinal: 80 },
    ] } } });
    await prisma.tabelaPreco.create({ data: { id: "tabOutra", empresaId: "e2", nome: "Da outra empresa" } });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Fictício", cpfCnpj: "22101333000111", tabelaPrecoId: "tab" },
      { id: "c2", empresaId: "e1", nome: "Padaria Fictícia", cpfCnpj: "22101333000192" },
    ] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  describe("5. medição/fatura — preço de tabela travado", () => {
    const corpo = (clienteId: string, sv: number, pr = 80, extra: Record<string, unknown> = {}) => ({
      clienteId, tipo: "ADICIONAL", descontoValor: 0, descontoPercent: 0, ...extra,
      itens: [
        { tipo: "SERVICO", servicoId: "sLimp", descricao: "Limpeza", quantidade: 1, valorUnitario: sv },
        { tipo: "PRODUTO", produtoId: "pFiltro", descricao: "Filtro", quantidade: 2, valorUnitario: pr },
      ],
    });
    const trilha = () => prisma.empresaEvento.findMany({ where: { empresaId: "e1", tipo: "PRECO_TABELA_FATURA" }, orderBy: { criadoEm: "asc" } });

    it("no preço da tabela: grava sem motivo e sem trilha", async () => {
      logar("operador");
      const r = await chamar("medicoes", "POST", corpo("c1", 150, 80));
      expect(r.status).toBe(201);
      expect(await trilha()).toHaveLength(0);
    });

    it("fora da tabela sem a permissão: 403 com precoTabela, nada gravado (serviço e produto)", async () => {
      logar("operador");
      const antes = await prisma.medicao.count();
      const r = await chamar("medicoes", "POST", corpo("c1", 120));
      expect(r.status).toBe(403);
      expect(r.json).toMatchObject({ precoTabela: true, erro: expect.stringMatching(/Limpeza.*Alterar preço de tabela/) });
      expect((await chamar("medicoes", "POST", corpo("c1", 150, 70))).status).toBe(403);
      expect(await prisma.medicao.count()).toBe(antes);
    });

    it("com a permissão: sem motivo 400; com motivo grava e a trilha registra o documento, quem, o quê e o motivo", async () => {
      logar("comPermissao");
      const sem = await chamar("medicoes", "POST", corpo("c1", 120));
      expect(sem.status).toBe(400);
      expect(sem.json.precoTabela).toBe(true);
      expect((await chamar("medicoes", "POST", corpo("c1", 120, 80, { motivoPrecoTabela: "ok" }))).status).toBe(400);
      const r = await chamar("medicoes", "POST", corpo("c1", 120, 70, { motivoPrecoTabela: "Desconto negociado em reunião" }));
      expect(r.status).toBe(201);
      const [ev] = await trilha();
      expect(ev.usuarioId).toBe("uPerm");
      expect(ev.detalhe).toBe(`Medição ${r.json.numero}: Preço de tabela alterado: Limpeza (R$ 150,00 → R$ 120,00); Filtro (R$ 80,00 → R$ 70,00). Motivo: Desconto negociado em reunião`);
    });

    it("editar (PUT): o preço já gravado não pede de novo; mudar de novo pede; a fatura avulsa aparece como Fatura", async () => {
      logar("comPermissao");
      const r = await chamar("medicoes", "POST", corpo("c1", 120, 80, { motivoPrecoTabela: "Desconto negociado em reunião" }));
      const id = r.json.id;
      const n = (await trilha()).length;
      logar("operador");
      expect((await chamar("medicoes/[id]", "PUT", corpo("c1", 120, 80, { descricao: "Só a descrição" }), { id })).status).toBe(200);
      expect(await trilha()).toHaveLength(n);
      const outra = await chamar("medicoes/[id]", "PUT", corpo("c1", 110), { id });
      expect(outra.status).toBe(403);
      expect(Number((await prisma.medicaoItem.findFirst({ where: { medicaoId: id, servicoId: "sLimp" } })).valorUnitario)).toBe(120);
      logar("comPermissao");
      expect((await chamar("medicoes/[id]", "PUT", corpo("c1", 110), { id })).status).toBe(400);
      await prisma.medicao.update({ where: { id }, data: { avulsa: true } });
      expect((await chamar("medicoes/[id]", "PUT", corpo("c1", 110, 80, { motivoPrecoTabela: "Ajuste combinado por e-mail" }), { id })).status).toBe(200);
      const ultima = (await trilha()).at(-1);
      expect(ultima.detalhe).toMatch(new RegExp(`^Fatura ${r.json.numero}: Preço de tabela alterado: Limpeza \\(R\\$ 150,00 → R\\$ 110,00\\)\\. Motivo: Ajuste combinado por e-mail$`));
    });

    it("livre: cliente sem tabela, item fora da tabela e linha sem catálogo", async () => {
      logar("operador");
      expect((await chamar("medicoes", "POST", corpo("c2", 10, 10))).status).toBe(201);
      expect((await chamar("medicoes", "POST", { clienteId: "c1", itens: [
        { tipo: "SERVICO", servicoId: "sVisita", descricao: "Visita", quantidade: 1, valorUnitario: 55 },
        { tipo: "SERVICO", descricao: "Serviço avulso", quantidade: 1, valorUnitario: 1 },
      ] })).status).toBe(201);
    });
  });

  describe("6. reajuste em massa da tabela de preço", () => {
    const R = "cadastros/[entidade]/[id]/reajustes";
    const D = "cadastros/[entidade]/[id]/reajustes/desfazer";
    const P = { entidade: "tabelas-preco", id: "tReaj" };
    const precos = async () => Object.fromEntries((await prisma.tabelaPrecoItem.findMany({ where: { tabelaId: "tReaj" }, include: { servico: true } }))
      .map((i: any) => [i.servico.nome, [i.tipoPreco, i.valorFixo == null ? null : Number(i.valorFixo), i.descontoPercent == null ? null : Number(i.descontoPercent), Number(i.valorFinal)]]));

    beforeAll(async () => {
      await prisma.tabelaPreco.create({ data: { id: "tReaj", empresaId: "e1", nome: "Para reajustar", itens: { create: [
        { servicoId: "sLimp", tipoPreco: "VALOR_FIXO", valorFixo: 150, valorFinal: 150 },
        { servicoId: "sVisita", tipoPreco: "VALOR_FIXO", valorFixo: 33.33, valorFinal: 33.33 },
        // Desconto 10% sobre o padrão 1000 = 900
        { servicoId: "sInst", tipoPreco: "DESCONTO_PERCENTUAL", descontoPercent: 10, valorFinal: 900 },
      ] } } });
    });

    it("sem lote: GET vazio e desfazer = 409; a rota só existe para tabelas de preço", async () => {
      logar("comPermissao");
      expect((await chamar(R, "GET", undefined, P)).json).toEqual({ ultimo: null });
      expect((await chamar(D, "POST", {}, P)).status).toBe(409);
      expect((await chamar(R, "POST", { tipo: "VALOR", valor: 1 }, { entidade: "produtos", id: "tReaj" })).status).toBe(404);
    });

    it("permissão e validação: quem não edita tabela = 403; outra empresa = 404; motivo obrigatório para aplicar", async () => {
      logar("semConfig");
      expect((await chamar(R, "POST", { tipo: "PERCENTUAL", valor: 10, previa: true }, P)).status).toBe(403);
      expect((await chamar(D, "POST", {}, P)).status).toBe(403);
      logar("comPermissao");
      expect((await chamar(R, "POST", { tipo: "PERCENTUAL", valor: 10, previa: true }, { ...P, id: "tabOutra" })).status).toBe(404);
      const sem = await chamar(R, "POST", { tipo: "PERCENTUAL", valor: 10, previa: false, motivo: "ok" }, P);
      expect(sem.status).toBe(400);
      expect(sem.json.erro).toMatch(/motivo/);
      expect((await chamar(R, "POST", { tipo: "PERCENTUAL", valor: 0 }, P)).status).toBe(400);
      expect(await prisma.tabelaPrecoReajuste.count()).toBe(0);
    });

    it("prévia (todos, %): item, preço atual → novo, sem gravar nada", async () => {
      logar("comPermissao");
      const antes = await precos();
      const r = await chamar(R, "POST", { tipo: "PERCENTUAL", valor: 10, previa: true }, P);
      expect(r.status).toBe(200);
      expect(r.json.previa).toBe(true);
      expect(r.json.linhas.map((l: any) => [l.descricao, l.antes.valorFinal, l.depois.valorFinal])).toEqual([["Instalação", 900, 990], ["Limpeza", 150, 165], ["Visita", 33.33, 36.66]]);
      expect(await precos()).toEqual(antes);
      expect(await prisma.tabelaPrecoReajuste.count()).toBe(0);
    });

    it("aplicar: grava os preços (desconto % vira valor fixo), o lote com antes/depois e quem; e o GET mostra o lote", async () => {
      logar("comPermissao");
      const r = await chamar(R, "POST", { tipo: "PERCENTUAL", valor: 10, previa: false, motivo: "Reajuste anual do contrato" }, P);
      expect(r.status).toBe(201);
      expect(await precos()).toEqual({ "Instalação": ["VALOR_FIXO", 990, null, 990], Limpeza: ["VALOR_FIXO", 165, null, 165], Visita: ["VALOR_FIXO", 36.66, null, 36.66] });
      const lote = await prisma.tabelaPrecoReajuste.findUnique({ where: { id: r.json.loteId } });
      expect(lote).toMatchObject({ empresaId: "e1", tabelaPrecoId: "tReaj", usuarioId: "uPerm", tipo: "PERCENTUAL", motivo: "Reajuste anual do contrato", desfeitoEm: null });
      expect(Number(lote.valor)).toBe(10);
      expect(lote.itens.find((i: any) => i.descricao === "Instalação")).toMatchObject({ servicoId: "sInst", antes: { tipoPreco: "DESCONTO_PERCENTUAL", descontoPercent: 10, valorFinal: 900 }, depois: { tipoPreco: "VALOR_FIXO", valorFixo: 990 } });
      const g = await chamar(R, "GET", undefined, P);
      expect(g.json.ultimo).toMatchObject({ id: lote.id, tipo: "PERCENTUAL", valor: 10, motivo: "Reajuste anual do contrato", usuarioNome: "Pessoa uPerm", itens: 3 });
    });

    it("só os selecionados (R$), depois do editor salvar a tabela (linhas recriadas)", async () => {
      logar("comPermissao");
      // O editor grava a tabela inteira: as linhas são recriadas (ids novos) com os mesmos preços
      const atuais = await prisma.tabelaPrecoItem.findMany({ where: { tabelaId: "tReaj" } });
      const salvo = await chamar("cadastros/[entidade]/[id]", "PUT", { itens: atuais.map((i: any) => ({ servicoId: i.servicoId, produtoId: null, tipoPreco: i.tipoPreco, valorFixo: Number(i.valorFixo), descontoPercent: null, bloqueado: false })) }, P);
      expect(salvo.status).toBe(200);
      const limp = await prisma.tabelaPrecoItem.findFirst({ where: { tabelaId: "tReaj", servicoId: "sLimp" } });
      expect(atuais.map((i: any) => i.id)).not.toContain(limp.id);
      const r = await chamar(R, "POST", { tipo: "VALOR", valor: -5, itemIds: [limp.id], previa: false, motivo: "Ajuste só da limpeza" }, P);
      expect(r.status).toBe(201);
      expect(r.json.linhas).toHaveLength(1);
      expect((await precos()).Limpeza).toEqual(["VALOR_FIXO", 160, null, 160]);
      expect((await precos()).Visita).toEqual(["VALOR_FIXO", 36.66, null, 36.66]);
    });

    it("desfazer: o último lote; o item mudado depois fica (com aviso); desfazer de novo pega o lote anterior, pelo serviço", async () => {
      logar("comPermissao");
      // O lote 2 (só a Limpeza) é o último: desfazer volta a Limpeza para 165
      const p1 = await chamar(D, "POST", { previa: true }, P);
      expect(p1.json.plano.voltam.map((v: any) => [v.descricao, v.atual, v.preco.valorFinal])).toEqual([["Limpeza", 160, 165]]);
      expect((await chamar(D, "POST", {}, P)).status).toBe(200);
      expect((await precos()).Limpeza).toEqual(["VALOR_FIXO", 165, null, 165]);
      // Alguém muda a Visita à mão depois do lote 1
      await prisma.tabelaPrecoItem.updateMany({ where: { tabelaId: "tReaj", servicoId: "sVisita" }, data: { valorFixo: 40, valorFinal: 40 } });
      const p2 = await chamar(D, "POST", { previa: true }, P);
      expect(p2.json.lote.motivo).toBe("Reajuste anual do contrato");
      expect(p2.json.plano.ignorados).toEqual([{ descricao: "Visita", motivo: "alterado" }]);
      const d = await chamar(D, "POST", { previa: false }, P);
      expect(d.status).toBe(200);
      // Instalação volta ao desconto de 10% (valor final pelo padrão do catálogo); Limpeza a 150; Visita fica 40
      expect(await precos()).toEqual({ "Instalação": ["DESCONTO_PERCENTUAL", null, 10, 900], Limpeza: ["VALOR_FIXO", 150, null, 150], Visita: ["VALOR_FIXO", 40, null, 40] });
      const lotes = await prisma.tabelaPrecoReajuste.findMany({ where: { tabelaPrecoId: "tReaj" } });
      expect(lotes.every((l: any) => l.desfeitoEm && l.desfeitoPorId === "uPerm")).toBe(true);
      expect((await chamar(R, "GET", undefined, P)).json.ultimo).toBeNull();
      expect((await chamar(D, "POST", {}, P)).status).toBe(409);
    });
  });
});
