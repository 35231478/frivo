/**
 * Padronização — leva 1: Tipos de OS e Tipos de problema no cadastro padrão (lib/cadastros).
 * Rotas reais com o Prisma real num PostgreSQL real (schema descartável via `prisma db push`).
 *
 *  - a rota genérica (/api/cadastros/tipos-os, /tipos-problema) e as antigas (/api/tipos-os,
 *    /api/tipos-problema) são a MESMA implementação: uma regra só;
 *  - criar grava na empresa da sessão, ativo, com os padrões (cor da paleta, exige equipamento);
 *  - o schema recusa campo desconhecido (empresaId pelo corpo = 400) e nome vazio;
 *  - editar é parcial (o que não veio não muda); inativar nunca apaga; reativar não zera nada;
 *  - permissão por ação: ler é de qualquer usuário logado (as telas de OS precisam do catálogo);
 *    gravar, inativar e ver o impacto exigem Configurações › gerenciar;
 *  - multiempresa: o registro de outra empresa não é lido, editado, inativado nem contado;
 *  - a rota antiga, sem ?ativo, devolve ativos e inativos com os formulários ativos (como sempre);
 *  - lista paginada no servidor, com busca, contagem das abas e ordenação por uso;
 *  - impacto antes de inativar: atividades de OS, recorrências de contrato, formulários, cronogramas
 *    de PMOC e colaboradores com a competência — só da empresa.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/padronizacao-leva1-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { CADASTROS, ENTIDADES_CADASTRO } from "@/lib/cadastros/registro";
import { corDado } from "@/lib/ui/tokens";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_leva1_pg_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: empresaId === "e1" ? "uA" : "uB", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes } };
};
/** Usuário comum do escritório: opera OS, mas não tem Configurações › gerenciar */
const semConfig = () => logar(montarPermissoes({ configuracoes: ["visualizar"], ordens: ["visualizar", "criar", "editar"], clientes: ["visualizar"] }));

async function chamar(rota: string, metodo: string, params: Record<string, string> = {}, corpo?: unknown, query = "") {
  const mod = await import(/* @vite-ignore */ `@/app/api/${rota}/route`);
  const req = new NextRequest(`http://localhost/api/x${query}`, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null };
}
/** A rota genérica e a antiga, para provar que são a mesma regra */
const ROTAS = {
  "tipos-os": { antiga: "tipos-os", modelo: "tipoOs" },
  "tipos-problema": { antiga: "tipos-problema", modelo: "tipoProblema" },
} as const;
type Ent = keyof typeof ROTAS;
const generica = {
  colecao: (e: Ent, metodo: string, corpo?: unknown, query = "") => chamar("cadastros/[entidade]", metodo, { entidade: e }, corpo, query),
  item: (e: Ent, id: string, metodo: string, corpo?: unknown) => chamar("cadastros/[entidade]/[id]", metodo, { entidade: e, id }, corpo),
  impacto: (e: Ent, id: string) => chamar("cadastros/[entidade]/[id]/impacto", "GET", { entidade: e, id }),
};
const antiga = {
  colecao: (e: Ent, metodo: string, corpo?: unknown, query = "") => chamar(ROTAS[e].antiga, metodo, {}, corpo, query),
  item: (e: Ent, id: string, metodo: string, corpo?: unknown) => chamar(`${ROTAS[e].antiga}/[id]`, metodo, { id }, corpo),
};

describe.skipIf(!URL_PG)("Leva 1: Tipos de OS e Tipos de problema no cadastro padrão (PostgreSQL real)", () => {
  let prisma: any;
  const tabela = (e: Ent) => prisma[ROTAS[e].modelo];
  const linha = (e: Ent, id: string) => tabela(e).findUnique({ where: { id } });
  const nomes = (lista: any[]) => lista.map((x) => x.nome);

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    process.env.NEXTAUTH_SECRET ||= "segredo-de-teste-0123456789abcdef";
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    await Promise.all(["cadastros/[entidade]", "cadastros/[entidade]/[id]", "cadastros/[entidade]/[id]/impacto", "tipos-os", "tipos-os/[id]", "tipos-problema", "tipos-problema/[id]"]
      .map((r) => import(/* @vite-ignore */ `@/app/api/${r}/route`)));

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total Engenharia Ltda", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com" },
    ] });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x" },
      { id: "uB", empresaId: "e2", nome: "Da outra", email: "b@x.com", senha: "x" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "1" },
      { id: "cB", empresaId: "e2", nome: "Cliente da outra", cpfCnpj: "2" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" }, { id: "un2", empresaId: "e1", clienteId: "c1", nome: "Filial" },
      { id: "unB", empresaId: "e2", clienteId: "cB", nome: "Sede" },
    ] });
  }, 240_000);

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await prisma.$disconnect();
  });

  /** Catálogo de cada teste: um ativo cheio, um inativo e um de outra empresa — e os usos do tipo de OS */
  beforeEach(async () => {
    logar();
    await prisma.pmocCronograma.deleteMany(); await prisma.pmoc.deleteMany();
    await prisma.contratoRecorrenciaLocal.deleteMany(); await prisma.contrato.deleteMany();
    await prisma.atividadeOs.deleteMany(); await prisma.ordemServico.deleteMany();
    await prisma.formularioTemplate.deleteMany(); await prisma.tecnico.deleteMany();
    await prisma.tipoOs.deleteMany(); await prisma.tipoProblema.deleteMany();
    await prisma.tipoOs.createMany({ data: [
      { id: "tPrev", empresaId: "e1", nome: "Manutenção preventiva", descricao: "Visita mensal do contrato", cor: "#16a34a", exigeEquipamento: true },
      { id: "tVis", empresaId: "e1", nome: "Visita técnica", descricao: null, cor: "#2563eb", exigeEquipamento: false },
      { id: "tAnt", empresaId: "e1", nome: "Instalação antiga", descricao: "Fora de linha", cor: "#64748b", ativo: false },
      { id: "tB", empresaId: "e2", nome: "Manutenção da outra", cor: "#000000" },
    ] });
    await prisma.tipoProblema.createMany({ data: [
      { id: "pGela", empresaId: "e1", nome: "Ar não gela" }, { id: "pVaza", empresaId: "e1", nome: "Vazamento" },
      { id: "pAnt", empresaId: "e1", nome: "Barulho antigo", ativo: false }, { id: "pB", empresaId: "e2", nome: "Problema da outra" },
    ] });
  });

  /** Os usos do tipo "Manutenção preventiva" — e, de propósito, usos iguais na outra empresa, que não contam */
  async function semearUsos() {
    await prisma.ordemServico.createMany({ data: [
      { id: "os1", empresaId: "e1", numero: "OS-1", clienteId: "c1", criadoPorId: "uA", descricao: "Preventiva" },
      { id: "osB", empresaId: "e2", numero: "OS-1", clienteId: "cB", criadoPorId: "uB", descricao: "Da outra" },
    ] });
    await prisma.atividadeOs.createMany({ data: [
      { id: "a1", empresaId: "e1", ordemServicoId: "os1", titulo: "Janeiro", tipoOsId: "tPrev" }, { id: "a2", empresaId: "e1", ordemServicoId: "os1", titulo: "Fevereiro", tipoOsId: "tPrev" },
      { id: "a3", empresaId: "e1", ordemServicoId: "os1", titulo: "Março", tipoOsId: "tPrev" }, { id: "a4", empresaId: "e1", ordemServicoId: "os1", titulo: "Vistoria", tipoOsId: "tVis" },
      { id: "aB", empresaId: "e2", ordemServicoId: "osB", titulo: "Da outra", tipoOsId: "tB" },
    ] });
    await prisma.contrato.createMany({ data: [
      { id: "ct1", empresaId: "e1", clienteId: "c1", numero: "C-1", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01"), tipoOsRecorrenciaId: "tPrev" },
      { id: "ct2", empresaId: "e1", clienteId: "c1", numero: "C-2", tipo: "MANUTENCAO_PREVENTIVA", dataInicio: new Date("2026-01-01") },
    ] });
    await prisma.contratoRecorrenciaLocal.createMany({ data: [
      { id: "rl1", empresaId: "e1", contratoId: "ct2", unidadeId: "un1", tipoOsId: "tPrev" }, { id: "rl2", empresaId: "e1", contratoId: "ct2", unidadeId: "un2", tipoOsId: "tVis" },
    ] });
    await prisma.formularioTemplate.createMany({ data: [
      { id: "f1", empresaId: "e1", nome: "Checklist preventiva", tipoOsId: "tPrev" }, { id: "f2", empresaId: "e1", nome: "Checklist antigo", tipoOsId: "tPrev", ativo: false },
    ] });
    await prisma.pmoc.create({ data: { id: "pm1", empresaId: "e1", clienteId: "c1", unidadeId: "un1", nome: "PMOC Matriz", dataInicio: new Date("2026-01-01"), dataExpiracao: new Date("2026-12-31") } });
    await prisma.pmocCronograma.create({ data: { id: "pc1", pmocId: "pm1", tipoOsId: "tPrev", dataInicio: new Date("2026-01-01"), diaExecucao: 10 } });
    await prisma.tecnico.create({ data: { id: "tec1", empresaId: "e1", nome: "João", cpf: "1", telefone: "1", email: "j@x.com", competencias: { connect: [{ id: "tPrev" }, { id: "tVis" }] } } });
    await prisma.tecnico.create({ data: { id: "tec2", empresaId: "e1", nome: "Inativo", cpf: "2", telefone: "2", email: "i@x.com", ativo: false, competencias: { connect: [{ id: "tPrev" }] } } });
  }

  it("os dois cadastros estão no registro padrão, com gravação só para Configurações › gerenciar", () => {
    for (const e of ["tipos-os", "tipos-problema"] as const) {
      expect(ENTIDADES_CADASTRO).toContain(e);
      const p = CADASTROS[e].permissoes;
      expect(p.listar).toBeNull();
      for (const acao of ["criar", "editar", "inativar", "reativar"] as const) expect(p[acao], `${e} ${acao}`).toEqual([["configuracoes", "gerenciar"]]);
    }
    expect(CADASTROS["tipos-os"].modelo).toBe("tipoOs");
    expect(CADASTROS["tipos-problema"].modelo).toBe("tipoProblema");
  });

  describe.each(["tipos-os", "tipos-problema"] as const)("%s", (e) => {
    const A = e === "tipos-os" ? "tPrev" : "pGela", I = e === "tipos-os" ? "tAnt" : "pAnt", B = e === "tipos-os" ? "tB" : "pB";

    it.each([["genérica", generica], ["antiga", antiga]] as const)("criar pela rota %s: grava na empresa da sessão, ativo", async (_n, rota) => {
      const r = await rota.colecao(e, "POST", { nome: "  Higienização  " });
      expect(r.status).toBe(201);
      const gravado = await linha(e, r.json.id);
      expect(gravado).toMatchObject({ nome: "Higienização", empresaId: "e1", ativo: true });
      expect(r.json.empresaId ?? "e1").toBe("e1");
    });

    it("schema recusa campo desconhecido (empresaId pelo corpo) e nome vazio: 400 e nada é criado", async () => {
      const antes = await tabela(e).count();
      for (const rota of [generica, antiga]) {
        expect((await rota.colecao(e, "POST", { nome: "Intruso", empresaId: "e2" })).status).toBe(400);
        expect((await rota.colecao(e, "POST", { nome: "   " })).status).toBe(400);
        expect((await rota.colecao(e, "POST", {})).status).toBe(400);
        expect((await rota.item(e, A, "PATCH", { empresaId: "e2" })).status).toBe(400);
        expect((await rota.item(e, A, "PATCH", { nome: "" })).status).toBe(400);
      }
      expect(await tabela(e).count()).toBe(antes);
      expect((await linha(e, A)).empresaId).toBe("e1");
    });

    it("editar é parcial e a rota antiga (PUT) é a mesma regra", async () => {
      const antes = await linha(e, A);
      const r = await generica.item(e, A, "PATCH", { nome: "Renomeado" });
      expect(r.status).toBe(200);
      expect(r.json.nome).toBe("Renomeado");
      expect(await linha(e, A)).toMatchObject({ ...antes, nome: "Renomeado"});
      expect((await antiga.item(e, A, "PUT", { nome: "Pela antiga" })).status).toBe(200);
      expect((await linha(e, A)).nome).toBe("Pela antiga");
    });

    it("inativar (DELETE) nunca apaga; reativar (PATCH {ativo:true}) não zera nenhum campo", async () => {
      const antes = await linha(e, A);
      const total = await tabela(e).count();
      expect((await generica.item(e, A, "DELETE")).status).toBe(200);
      expect(await tabela(e).count()).toBe(total);
      expect(await linha(e, A)).toMatchObject({ ...antes, ativo: false});
      expect((await antiga.item(e, A, "PATCH", { ativo: true })).status).toBe(200);
      expect(await linha(e, A)).toMatchObject({ ...antes, ativo: true});
      // a rota antiga também só inativa
      expect((await antiga.item(e, A, "DELETE")).status).toBe(200);
      expect((await linha(e, A)).ativo).toBe(false);
      expect(await tabela(e).count()).toBe(total);
    });

    it("multiempresa: não lê, não edita, não inativa nem vê o impacto do registro de outra empresa", async () => {
      const antes = await linha(e, B);
      for (const rota of [generica, antiga]) {
        expect((await rota.item(e, B, "GET")).status).toBe(404);
        expect((await rota.item(e, B, "PATCH", { nome: "Invadido" })).status).toBe(404);
        expect((await rota.item(e, B, "PATCH", { ativo: false })).status).toBe(404);
        expect((await rota.item(e, B, "DELETE")).status).toBe(404);
        expect(nomes((await rota.colecao(e, "GET", undefined, "?ativo=todos")).json)).not.toContain(antes.nome);
      }
      expect((await generica.impacto(e, B)).status).toBe(404);
      expect(await linha(e, B)).toEqual(antes);
      // e a outra empresa enxerga só o dela
      logar(permissoesTotais(), "e2");
      expect(nomes((await generica.colecao(e, "GET", undefined, "?ativo=todos")).json)).toEqual([antes.nome]);
    });

    it("permissão por ação: sem Configurações › gerenciar só lê; sem login, nada", async () => {
      const antes = await tabela(e).findMany({ orderBy: { id: "asc" } });
      semConfig();
      for (const rota of [generica, antiga]) {
        expect((await rota.colecao(e, "GET")).status).toBe(200);
        expect((await rota.item(e, A, "GET")).status).toBe(200);
        expect((await rota.colecao(e, "POST", { nome: "Sem permissão" })).status).toBe(403);
        expect((await rota.item(e, A, "PATCH", { nome: "Sem permissão" })).status).toBe(403);
        expect((await rota.item(e, A, "PATCH", { ativo: false })).status).toBe(403);
        expect((await rota.item(e, I, "PATCH", { ativo: true })).status).toBe(403);
        expect((await rota.item(e, A, "DELETE")).status).toBe(403);
      }
      expect((await generica.impacto(e, A)).status).toBe(403);
      sessao.atual = null;
      for (const rota of [generica, antiga]) {
        expect((await rota.colecao(e, "GET")).status).toBe(401);
        expect((await rota.colecao(e, "POST", { nome: "Anônimo" })).status).toBe(401);
        expect((await rota.item(e, A, "DELETE")).status).toBe(401);
      }
      logar();
      expect(await tabela(e).findMany({ orderBy: { id: "asc" } })).toEqual(antes);
    });

    it("lista: a genérica devolve só os ativos por padrão; a antiga, todos (como sempre); ?ativo filtra nas duas", async () => {
      const ativos = (await generica.colecao(e, "GET")).json;
      expect(ativos.every((x: any) => x.ativo)).toBe(true);
      expect(ativos).toHaveLength(2);
      const todos = (await antiga.colecao(e, "GET")).json;
      expect(todos).toHaveLength(3);
      expect(todos.filter((x: any) => !x.ativo).map((x: any) => x.id)).toEqual([I]);
      expect(nomes(todos)).toEqual([...nomes(todos)].sort((a, b) => a.localeCompare(b, "pt-BR")));
      expect((await generica.colecao(e, "GET", undefined, "?ativo=nao")).json.map((x: any) => x.id)).toEqual([I]);
      expect((await antiga.colecao(e, "GET", undefined, "?ativo=sim")).json).toHaveLength(2);
    });

    it("lista paginada no servidor: página, total, contagem das abas e busca", async () => {
      // 26 a mais: a menor página é de 25, então a lista precisa passar disso para ter segunda página
      await tabela(e).createMany({ data: Array.from({ length: 26 }, (_, i) => ({ id: `extra${i}`, empresaId: "e1", nome: `Extra ${String(i).padStart(2, "0")}` })) });
      const p1 = (await generica.colecao(e, "GET", undefined, "?ativo=todos&pagina=1&por=25")).json;
      expect(p1).toMatchObject({ total: 29, pagina: 1, porPagina: 25, contagens: { ativos: 28, inativos: 1, todos: 29 } });
      expect(p1.itens).toHaveLength(25);
      const p2 = (await generica.colecao(e, "GET", undefined, "?ativo=todos&pagina=2&por=25")).json;
      expect(p2).toMatchObject({ total: 29, pagina: 2 });
      expect(p2.itens).toHaveLength(4);
      expect(new Set([...p1.itens, ...p2.itens].map((x: any) => x.id)).size).toBe(29);
      // a outra empresa nunca entra na página nem na contagem
      expect([...p1.itens, ...p2.itens].every((x: any) => x.id !== B)).toBe(true);
      // página além do fim: cai na última (a tela nunca fica numa página vazia)
      expect((await generica.colecao(e, "GET", undefined, "?ativo=todos&pagina=9&por=25")).json).toMatchObject({ pagina: 2 });
      const busca = (await generica.colecao(e, "GET", undefined, `?ativo=todos&pagina=1&q=${encodeURIComponent("antig")}`)).json;
      expect(busca.itens.map((x: any) => x.id)).toEqual([I]);
      expect(busca.total).toBe(1);
      // a contagem das abas não muda com a aba escolhida
      expect((await generica.colecao(e, "GET", undefined, "?ativo=nao&pagina=1")).json).toMatchObject({ total: 1, contagens: { ativos: 28, inativos: 1, todos: 29 } });
      // sem ?pagina, a rota continua devolvendo a lista inteira (os seletores das outras telas leem assim)
      expect((await generica.colecao(e, "GET", undefined, "?ativo=todos")).json).toHaveLength(29);
    });

    it("sem uso: o impacto diz que não está em uso", async () => {
      const r = await generica.impacto(e, I);
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ bloqueio: null, avisos: ["Não está em uso em nenhum registro."], usos: [] });
    });
  });

  describe("tipos de OS: o que é só deles", () => {
    it("criar com os padrões: cor da paleta e 'exige equipamento' ligado; o formulário manda \"false\" e grava false", async () => {
      const padrao = await generica.colecao("tipos-os", "POST", { nome: "Higienização" });
      expect(await linha("tipos-os", padrao.json.id)).toMatchObject({ cor: corDado.azulForte, exigeEquipamento: true, descricao: null });
      const semEquip = await generica.colecao("tipos-os", "POST", { nome: "Vistoria", descricao: " Sem equipamento ", cor: "#ff0000", exigeEquipamento: "false" });
      expect(semEquip.status).toBe(201);
      expect(await linha("tipos-os", semEquip.json.id)).toMatchObject({ cor: "#ff0000", exigeEquipamento: false, descricao: "Sem equipamento" });
      // o cadastro rápido de dentro da OS manda só o nome pela rota antiga
      const rapido = await antiga.colecao("tipos-os", "POST", { nome: "Rápido" });
      expect(await linha("tipos-os", rapido.json.id)).toMatchObject({ cor: corDado.azulForte, exigeEquipamento: true, ativo: true });
    });

    it("editar no contexto manda só o que mudou: a regra do equipamento e a cor ficam como estavam", async () => {
      expect((await generica.item("tipos-os", "tVis", "PATCH", { descricao: "Visita sem equipamento" })).status).toBe(200);
      expect(await linha("tipos-os", "tVis")).toMatchObject({ nome: "Visita técnica", descricao: "Visita sem equipamento", cor: "#2563eb", exigeEquipamento: false, ativo: true });
      // apagar a descrição é uma mudança (vai vazio e vira null)
      expect((await generica.item("tipos-os", "tPrev", "PATCH", { descricao: "" })).status).toBe(200);
      expect(await linha("tipos-os", "tPrev")).toMatchObject({ nome: "Manutenção preventiva", descricao: null, cor: "#16a34a", exigeEquipamento: true });
      expect((await generica.item("tipos-os", "tPrev", "PATCH", { exigeEquipamento: false })).status).toBe(200);
      expect((await linha("tipos-os", "tPrev")).exigeEquipamento).toBe(false);
      expect((await generica.item("tipos-os", "tPrev", "PATCH", { cor: "vermelho" })).status).toBe(400);
    });

    it("a rota antiga devolve cada tipo com os formulários ATIVOS (as telas de OS e de equipamento leem daqui)", async () => {
      await semearUsos();
      const todos = (await antiga.colecao("tipos-os", "GET")).json;
      const prev = todos.find((t: any) => t.id === "tPrev");
      expect(prev).toMatchObject({ nome: "Manutenção preventiva", cor: "#16a34a", ativo: true, exigeEquipamento: true });
      expect(prev.formularios).toEqual([{ id: "f1", nome: "Checklist preventiva" }]);
      expect(todos.find((t: any) => t.id === "tVis").formularios).toEqual([]);
      expect(prev._count).toEqual({ atividades: 3 });
    });

    it("lista ordenada por uso e por 'exige equipamento' (no servidor)", async () => {
      await semearUsos();
      const porUso = (dir: string) => generica.colecao("tipos-os", "GET", undefined, `?ativo=todos&pagina=1&ordem=uso&dir=${dir}`);
      expect((await porUso("desc")).json.itens.map((x: any) => [x.id, x._count.atividades])).toEqual([["tPrev", 3], ["tVis", 1], ["tAnt", 0]]);
      expect((await porUso("asc")).json.itens.map((x: any) => x.id)[0]).toBe("tAnt");
      const porRegra = (await generica.colecao("tipos-os", "GET", undefined, "?ativo=sim&pagina=1&ordem=exigeEquipamento")).json;
      expect(porRegra.itens.map((x: any) => x.exigeEquipamento)).toEqual([false, true]);
      // a busca também olha a descrição
      expect((await generica.colecao("tipos-os", "GET", undefined, `?ativo=todos&pagina=1&q=${encodeURIComponent("mensal do contrato")}`)).json.itens.map((x: any) => x.id)).toEqual(["tPrev"]);
    });

    it("impacto: atividades, recorrências de contrato (do contrato e por local), formulários ativos, PMOC e colaboradores ativos — só da empresa", async () => {
      await semearUsos();
      const r = await generica.impacto("tipos-os", "tPrev");
      expect(r.status).toBe(200);
      expect(r.json.bloqueio).toBeNull();
      expect(r.json.usos).toEqual([
        { rotulo: "3 atividades de OS", total: 3 }, { rotulo: "2 recorrências de contrato", total: 2 }, { rotulo: "1 formulário", total: 1 },
        { rotulo: "1 cronograma de PMOC", total: 1 }, { rotulo: "1 colaborador com a competência", total: 1 },
      ]);
      expect(r.json.avisos[0]).toBe("Em uso: 3 atividades de OS, 2 recorrências de contrato, 1 formulário, 1 cronograma de PMOC e 1 colaborador com a competência.");
      expect(r.json.avisos[1]).toContain("Nada é apagado");
      const vis = (await generica.impacto("tipos-os", "tVis")).json;
      expect(vis.usos).toEqual([{ rotulo: "1 atividade de OS", total: 1 }, { rotulo: "1 recorrência de contrato", total: 1 }, { rotulo: "1 colaborador com a competência", total: 1 }]);
    });

    it("inativar um tipo em uso não mexe nas atividades, nos contratos nem nos formulários que o usam", async () => {
      await semearUsos();
      expect((await generica.item("tipos-os", "tPrev", "DELETE")).status).toBe(200);
      expect((await linha("tipos-os", "tPrev")).ativo).toBe(false);
      expect(await prisma.atividadeOs.count({ where: { tipoOsId: "tPrev" } })).toBe(3);
      expect((await prisma.contrato.findUnique({ where: { id: "ct1" } })).tipoOsRecorrenciaId).toBe("tPrev");
      expect(await prisma.formularioTemplate.count({ where: { tipoOsId: "tPrev" } })).toBe(2);
      expect(await prisma.pmocCronograma.count({ where: { tipoOsId: "tPrev" } })).toBe(1);
    });
  });

  it("tipo de problema inativo sai do que o portal oferece ao cliente (a página lê só os ativos)", async () => {
    const oferecidos = () => prisma.tipoProblema.findMany({ where: { empresaId: "e1", ativo: true }, select: { nome: true }, orderBy: { nome: "asc" } });
    expect(nomes(await oferecidos())).toEqual(["Ar não gela", "Vazamento"]);
    expect((await generica.item("tipos-problema", "pVaza", "DELETE")).status).toBe(200);
    expect(nomes(await oferecidos())).toEqual(["Ar não gela"]);
    expect((await generica.item("tipos-problema", "pVaza", "PATCH", { ativo: true })).status).toBe(200);
    expect(nomes(await oferecidos())).toEqual(["Ar não gela", "Vazamento"]);
  });
});
