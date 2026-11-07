/**
 * Estoque E3.1 — categoria de produto com comportamento de faturamento. Regra pura + rotas reais do
 * cadastro padronizado com banco em memória (DUAS empresas). Prova:
 *  - o comportamento vem da CATEGORIA; produto sem categoria = "incluso no serviço" (nunca cobra sozinho);
 *  - seed das duas categorias do Zé por empresa, na primeira listagem: rodar 2× não duplica; quem já tem
 *    (renomeou, inativou) não ganha de novo; cada empresa só vê as suas;
 *  - cadastro: criar/editar/inativar/reativar, comportamento obrigatório e válido, nome único, campo a mais = 400,
 *    impacto (quantos produtos usam), permissões (qualquer logado lê; gravar = Configurações › gerenciar);
 *  - produto: categoria opcional, só da empresa e ativa quando é escolha nova (manter a inativa é aceito),
 *    vazio limpa; a lista traz a categoria (nome + comportamento) e filtra por ela (?categoria=id | sem),
 *    inclusive no "selecionar todos do filtro" das ações em massa; a exportação sai com o NOME.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import { cobraSeparado, comportamentoDoProduto, COMPORTAMENTO_PADRAO, CATEGORIAS_PADRAO, ehComportamento, OPCOES_COMPORTAMENTO, semCategoria } from "@/lib/estoque/categoria";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const por = (T: (m: string) => any[], m: string, id: string | null | undefined) => T(m).find((x) => x.id === id) ?? null;
  return {
    prisma: criarPrisma(db, {
      produto: (p, T) => ({ categoriaProduto: por(T, "categoriaProduto", p.categoriaProdutoId) }),
      categoriaProduto: (c, T) => ({ _count: { produtos: T("produto").filter((p) => p.categoriaProdutoId === c.id).length } }),
    }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId, role: "OPERADOR", permissoes } };
};
const so = (p: Record<string, Record<string, boolean>>): Permissoes => ({ ...permissoesVazias(), ...p });
const T = (m: string) => (db.t as any)[m] as any[];

beforeEach(() => {
  db.escritas = [];
  db.t = {
    empresa: [{ id: "e1" }, { id: "e2" }],
    categoriaProduto: [],
    produto: [
      { id: "p1", empresaId: "e1", codigo: 1, nome: "Gás R410A", unidade: "kg", ativo: true, categoriaProdutoId: null, controlaEstoque: true },
      { id: "p2", empresaId: "e1", codigo: 2, nome: "Capacitor 35uF", unidade: "un", ativo: true, categoriaProdutoId: null, controlaEstoque: true },
      { id: "pB", empresaId: "e2", codigo: 1, nome: "Gás da outra", unidade: "kg", ativo: true, categoriaProdutoId: null, controlaEstoque: true },
    ],
  };
  logar();
});

async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await carregar();
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const api = (entidade: string) => (metodo: string, corpo?: unknown, id?: string, qs = "") => id
  ? chamar(() => import("@/app/api/cadastros/[entidade]/[id]/route"), metodo, { entidade, id }, corpo)
  : chamar(() => import("@/app/api/cadastros/[entidade]/route"), metodo, { entidade }, corpo, `http://localhost/api/cadastros/${entidade}${qs}`);
const categorias = api("categorias-produto");
const produtos = api("produtos");
const impacto = (id: string) => chamar(() => import("@/app/api/cadastros/[entidade]/[id]/impacto/route"), "GET", { entidade: "categorias-produto", id });
const massa = (corpo: unknown) => chamar(() => import("@/app/api/acoes-massa/route"), "POST", {}, corpo);
const cats = (empresaId = "e1") => T("categoriaProduto").filter((c) => c.empresaId === empresaId);

// ═════════════════════════ Regra pura ═════════════════════════
describe("comportamento de faturamento (regra pura)", () => {
  it("vem da categoria; sem categoria (ou com valor estranho) é INCLUSO no serviço — nunca cobra sozinho", () => {
    expect(COMPORTAMENTO_PADRAO).toBe("INCLUSO_NO_SERVICO");
    expect(comportamentoDoProduto({ categoriaProduto: { comportamento: "VENDA_A_PARTE" } })).toBe("VENDA_A_PARTE");
    expect(comportamentoDoProduto({ categoriaProduto: { comportamento: "INCLUSO_NO_SERVICO" } })).toBe("INCLUSO_NO_SERVICO");
    expect(comportamentoDoProduto({ categoriaProduto: null })).toBe("INCLUSO_NO_SERVICO");
    expect(comportamentoDoProduto({})).toBe("INCLUSO_NO_SERVICO");
    expect(comportamentoDoProduto(null)).toBe("INCLUSO_NO_SERVICO");
    expect(comportamentoDoProduto({ categoriaProduto: { comportamento: "GRATIS" } })).toBe("INCLUSO_NO_SERVICO");
    expect([cobraSeparado({ categoriaProduto: { comportamento: "VENDA_A_PARTE" } }), cobraSeparado({}), cobraSeparado(null)]).toEqual([true, false, false]);
    expect([semCategoria({}), semCategoria({ categoriaProduto: { comportamento: "VENDA_A_PARTE" } })]).toEqual([true, false]);
    expect([ehComportamento("VENDA_A_PARTE"), ehComportamento("venda"), ehComportamento(null)]).toEqual([true, false, false]);
    expect(OPCOES_COMPORTAMENTO.map((o) => o.value)).toEqual(["VENDA_A_PARTE", "INCLUSO_NO_SERVICO"]);
    expect(OPCOES_COMPORTAMENTO[0].label).toMatch(/^Venda à parte — Peça de reposição/);
    expect(CATEGORIAS_PADRAO).toEqual([{ nome: "Peças de reposição", comportamento: "VENDA_A_PARTE" }, { nome: "Materiais de instalação/consumo", comportamento: "INCLUSO_NO_SERVICO" }]);
  });
});

// ═════════════════════════ Seed ═════════════════════════
describe("seed das categorias do Zé", () => {
  it("na primeira listagem a empresa ganha as duas; listar de novo não duplica; a outra empresa tem as suas; quem já tinha (renomeou/inativou) não ganha de novo", async () => {
    expect(cats()).toHaveLength(0);
    const r = await categorias("GET");
    expect(r.status).toBe(200);
    expect(r.json.map((c: any) => [c.nome, c.comportamento, c.ativo])).toEqual([
      ["Materiais de instalação/consumo", "INCLUSO_NO_SERVICO", true], ["Peças de reposição", "VENDA_A_PARTE", true],
    ]);
    expect(cats().every((c) => c.empresaId === "e1")).toBe(true);
    await categorias("GET"); await categorias("GET", undefined, undefined, "?pagina=1&por=25");
    expect(cats()).toHaveLength(2);
    expect(cats("e2")).toHaveLength(0);
    logar(permissoesTotais(), "e2");
    expect((await categorias("GET")).json.map((c: any) => c.nome)).toEqual(["Materiais de instalação/consumo", "Peças de reposição"]);
    expect(cats("e2")).toHaveLength(2);
    expect(T("categoriaProduto")).toHaveLength(4);
    // O Zé da e1 renomeia e inativa: a próxima listagem respeita (nada volta)
    logar();
    const pecas = cats().find((c) => c.comportamento === "VENDA_A_PARTE")!;
    await categorias("PATCH", { nome: "Peças" }, pecas.id);
    await categorias("DELETE", undefined, pecas.id);
    expect((await categorias("GET", undefined, undefined, "?ativo=todos")).json.map((c: any) => [c.nome, c.ativo])).toEqual([["Materiais de instalação/consumo", true], ["Peças", false]]);
    expect(cats()).toHaveLength(2);
    // O seletor do produto (lista sem paginação, ativos) também dispara o seed numa empresa nova
    db.t.empresa.push({ id: "e3" });
    logar(permissoesTotais(), "e3");
    expect((await categorias("GET")).json).toHaveLength(2);
    expect(cats("e3")).toHaveLength(2);
  });
});

// ═════════════════════════ Cadastro da categoria ═════════════════════════
describe("categorias de produto: cadastro no padrão", () => {
  it("criar (empresa da sessão, ativa) → editar → inativar → reativar; comportamento obrigatório e válido; nome único; campo a mais = 400", async () => {
    await categorias("GET"); // seed
    const c = await categorias("POST", { nome: "  Consumíveis de obra ", comportamento: "INCLUSO_NO_SERVICO" });
    expect(c.status).toBe(201);
    expect(c.json).toMatchObject({ nome: "Consumíveis de obra", comportamento: "INCLUSO_NO_SERVICO", empresaId: "e1", ativo: true });
    expect((await categorias("POST", { nome: "Sem comportamento" })).json.erro).toBe("Comportamento de faturamento: Escolha o comportamento: venda à parte ou incluso no serviço.");
    expect((await categorias("POST", { nome: "Errado", comportamento: "GRATIS" })).json.erro).toBe("Comportamento de faturamento: Escolha o comportamento: venda à parte ou incluso no serviço.");
    expect((await categorias("POST", { nome: "x", comportamento: "VENDA_A_PARTE", empresaId: "e2" })).json.erro).toBe("Campo não permitido: empresaId.");
    expect(await categorias("POST", { nome: "PEÇAS DE REPOSIÇÃO", comportamento: "VENDA_A_PARTE" })).toMatchObject({ status: 409, json: { erro: "Já existe a categoria “Peças de reposição”." } });
    expect((await categorias("POST", { nome: "", comportamento: "VENDA_A_PARTE" })).status).toBe(400);
    expect((await categorias("PATCH", { comportamento: "VENDA_A_PARTE" }, c.json.id)).json).toMatchObject({ nome: "Consumíveis de obra", comportamento: "VENDA_A_PARTE" });
    expect((await categorias("PATCH", { nome: "peças de reposição" }, c.json.id)).status).toBe(409);
    expect((await categorias("DELETE", undefined, c.json.id)).status).toBe(200);
    expect(T("categoriaProduto").find((x) => x.id === c.json.id).ativo).toBe(false); // excluir = inativar
    expect((await categorias("POST", { nome: "consumíveis de obra", comportamento: "VENDA_A_PARTE" })).json.erro).toBe("Já existe a categoria “Consumíveis de obra” (inativa — reative-a em vez de cadastrar de novo).");
    expect((await categorias("PATCH", { ativo: true }, c.json.id)).json.ativo).toBe(true);
    expect(cats()).toHaveLength(3);
  });

  it("lista (ativos por padrão, busca, paginada com contagens, sugestões) só da empresa; outra empresa = 404; impacto conta os produtos", async () => {
    await categorias("GET");
    const pecas = cats().find((c) => c.comportamento === "VENDA_A_PARTE")!;
    T("produto")[0].categoriaProdutoId = pecas.id; T("produto")[1].categoriaProdutoId = pecas.id;
    expect((await categorias("GET", undefined, undefined, "?q=peças")).json.map((c: any) => [c.nome, c._count.produtos])).toEqual([["Peças de reposição", 2]]);
    const pag = (await categorias("GET", undefined, undefined, "?ativo=todos&por=25")).json;
    expect([pag.total, pag.contagens]).toEqual([2, { ativos: 2, inativos: 0, todos: 2 }]);
    expect((await categorias("GET", undefined, undefined, "?sugestoes=1&q=mat")).json.sugestoes.map((s: any) => s.rotulo)).toEqual(["Materiais de instalação/consumo"]);
    logar(permissoesTotais(), "e2"); await categorias("GET"); logar();
    const daOutra = cats("e2")[0];
    expect((await categorias("GET", undefined, daOutra.id)).status).toBe(404);
    expect((await categorias("PATCH", { nome: "y" }, daOutra.id)).status).toBe(404);
    T("produto").find((p) => p.id === "pB").categoriaProdutoId = pecas.id; // da outra empresa: não conta
    const imp = await impacto(pecas.id);
    expect(imp.json.usos).toEqual([{ rotulo: "2 produtos", total: 2 }]);
    expect(imp.json.avisos[0]).toBe("Usada em 2 produtos. Eles continuam com esta categoria e com o comportamento dela (aparece como “inativa”); ela só deixa de ser oferecida nos produtos novos.");
  });

  it("permissões: qualquer usuário logado lê (seletor do produto); gravar = Configurações › gerenciar; sem sessão 401", async () => {
    logar(so({ estoque: { visualizar: true } }));
    expect((await categorias("GET")).status).toBe(200);
    expect((await categorias("POST", { nome: "Nova", comportamento: "VENDA_A_PARTE" })).status).toBe(403);
    expect((await categorias("DELETE", undefined, cats()[0].id)).status).toBe(403);
    logar(so({ configuracoes: { visualizar: true, gerenciar: true } }));
    expect((await categorias("POST", { nome: "Nova", comportamento: "VENDA_A_PARTE" })).status).toBe(201);
    sessao.atual = null;
    expect((await categorias("GET")).status).toBe(401);
  });

  it("ações em massa: inativar/reativar categorias (as da outra empresa viram 'não encontrado')", async () => {
    await categorias("GET"); logar(permissoesTotais(), "e2"); await categorias("GET"); logar();
    const minhas = cats().map((c) => c.id); const deles = cats("e2")[0].id;
    const r = await massa({ entidade: "categorias-produto", acao: "inativar", ids: [...minhas, deles] });
    expect(r.json.resumo).toEqual({ total: 3, feitas: 2, naoPuderam: 1 });
    expect(cats().every((c) => !c.ativo)).toBe(true);
    expect(cats("e2")[0].ativo).toBe(true);
    expect((await massa({ entidade: "categorias-produto", acao: "reativar", ids: minhas })).json.resumo.feitas).toBe(2);
  });
});

// ═════════════════════════ Produto × categoria ═════════════════════════
describe("produto: vínculo com a categoria", () => {
  it("criar/editar com categoria da empresa; de outra empresa ou inexistente = 400; nova escolha inativa = 400, manter a inativa é aceito; vazio limpa; a resposta e a lista trazem a categoria", async () => {
    await categorias("GET"); logar(permissoesTotais(), "e2"); await categorias("GET"); logar();
    const pecas = cats().find((c) => c.comportamento === "VENDA_A_PARTE")!;
    const materiais = cats().find((c) => c.comportamento === "INCLUSO_NO_SERVICO")!;
    const daOutra = cats("e2")[0];
    const r = await produtos("POST", { nome: "Compressor 1/4", unidade: "un", categoriaProdutoId: pecas.id });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ categoriaProdutoId: pecas.id, categoriaProduto: { id: pecas.id, nome: "Peças de reposição", comportamento: "VENDA_A_PARTE" } });
    expect(comportamentoDoProduto(r.json)).toBe("VENDA_A_PARTE");
    expect((await produtos("POST", { nome: "Fita", unidade: "un", categoriaProdutoId: daOutra.id })).json.erro).toBe("Categoria de produto inválido(a).");
    expect((await produtos("POST", { nome: "Fita", unidade: "un", categoriaProdutoId: "nao-existe" })).status).toBe(400);
    expect(T("produto").filter((p) => p.nome === "Fita")).toHaveLength(0);
    const sem = await produtos("POST", { nome: "Fita", unidade: "un" });
    expect(sem.json).toMatchObject({ categoriaProdutoId: null, categoriaProduto: null });
    expect(comportamentoDoProduto(sem.json)).toBe("INCLUSO_NO_SERVICO");
    // Editar: troca, limpa, e a inativa só vale para quem já a tinha
    expect((await produtos("PATCH", { categoriaProdutoId: materiais.id }, r.json.id)).json.categoriaProduto.nome).toBe("Materiais de instalação/consumo");
    expect((await produtos("PATCH", { categoriaProdutoId: "" }, r.json.id)).json).toMatchObject({ categoriaProdutoId: null, categoriaProduto: null });
    await categorias("DELETE", undefined, pecas.id); // inativa
    expect((await produtos("PATCH", { categoriaProdutoId: pecas.id }, r.json.id)).json.erro).toBe("Categoria de produto inativo(a): escolha um(a) ativo(a).");
    T("produto").find((p) => p.id === "p1").categoriaProdutoId = pecas.id;
    expect((await produtos("PATCH", { categoriaProdutoId: pecas.id, nome: "Gás R410A 11 kg" }, "p1")).status).toBe(200); // manteve a inativa que já tinha
    expect((await produtos("PATCH", { categoriaProdutoId: daOutra.id }, "p1")).status).toBe(400);
    expect(T("produto").find((p) => p.id === "p1").categoriaProdutoId).toBe(pecas.id);
    const lista = (await produtos("GET", undefined, undefined, "?pagina=1&por=25&ativo=todos")).json;
    expect(lista.itens.find((p: any) => p.id === "p1").categoriaProduto).toMatchObject({ nome: "Peças de reposição", comportamento: "VENDA_A_PARTE", ativo: false });
  });

  it("filtro por categoria na lista (?categoria=id | sem), nas sugestões e no 'selecionar todos do filtro'; exportação sai com o nome", async () => {
    await categorias("GET");
    const pecas = cats().find((c) => c.comportamento === "VENDA_A_PARTE")!;
    const materiais = cats().find((c) => c.comportamento === "INCLUSO_NO_SERVICO")!;
    T("produto").find((p) => p.id === "p1").categoriaProdutoId = pecas.id;
    T("produto").push({ id: "p3", empresaId: "e1", codigo: 3, nome: "Fita aluminizada", unidade: "un", ativo: true, categoriaProdutoId: materiais.id, controlaEstoque: true });
    const ids = async (qs: string) => (await produtos("GET", undefined, undefined, qs)).json.itens.map((p: any) => p.id);
    expect(await ids("?pagina=1&por=25")).toEqual(["p2", "p3", "p1"]);
    expect(await ids(`?pagina=1&por=25&categoria=${pecas.id}`)).toEqual(["p1"]);
    expect(await ids(`?pagina=1&por=25&categoria=${materiais.id}`)).toEqual(["p3"]);
    expect(await ids("?pagina=1&por=25&categoria=sem")).toEqual(["p2"]);
    expect(await ids(`?pagina=1&por=25&categoria=${pecas.id}&q=gás`)).toEqual(["p1"]);
    expect(await ids(`?pagina=1&por=25&categoria=${pecas.id}&q=capacitor`)).toEqual([]);
    expect((await produtos("GET", undefined, undefined, `?categoria=${pecas.id}`)).json.map((p: any) => p.id)).toEqual(["p1"]); // lista inteira (seletores)
    // Um parâmetro qualquer da URL não vira filtro (só os declarados)
    expect(await ids("?pagina=1&por=25&unidade=kg")).toEqual(["p2", "p3", "p1"]);
    // "Selecionar todos do filtro" (ações em massa) usa o mesmo filtro
    const todos = await massa({ entidade: "produtos", acao: "ids-do-filtro", filtro: `categoria=${materiais.id}` });
    expect(todos.json).toEqual({ ids: ["p3"], total: 1 });
    expect((await massa({ entidade: "produtos", acao: "ids-do-filtro", filtro: "categoria=sem" })).json.ids).toEqual(["p2"]);
    // Exportação (CSV das ações em massa): a coluna Categoria traz o nome, não o id
    const mod = await import("@/app/api/acoes-massa/route");
    const res = await mod.POST(new NextRequest("http://localhost/api/acoes-massa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entidade: "produtos", acao: "exportar", ids: ["p1", "p2"] }) }));
    const csv = await res.text();
    expect(csv).toContain("Categoria;Controla estoque");
    expect(csv).toMatch(/Gás R410A;.*Peças de reposição;true/);
    expect(csv).toMatch(/Capacitor 35uF;.*;;true/);
  });
});
