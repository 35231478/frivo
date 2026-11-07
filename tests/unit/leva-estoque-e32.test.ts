/**
 * Estoque E3.2 — kits de material + composição do serviço ("Materiais padrão"). Regra pura + rotas reais do
 * cadastro padronizado com banco em memória (DUAS empresas). Prova:
 *  - o comportamento de cada material vem da CATEGORIA do produto (E3.1); override pontual só em produto solto;
 *    item de kit segue a categoria; sem categoria = incluso;
 *  - o kit é VIVO: a composição guarda a referência e, mudando o kit, o serviço reflete (expansão pelos itens atuais);
 *  - custo somado dos materiais inclusos (último custo de compra × quantidade) e do kit, com "sem custo" honesto;
 *  - cadastro do kit: itens da empresa (novo ativo; manter inativo ok), sem repetir, quantidade > 0, nome único,
 *    campo a mais = 400, permissões, impacto (serviços que usam), ações em massa, lista com o custo de referência;
 *  - serviço: composição opcional (sem ela = como sempre), parcial (renomear não apaga), vínculos só da empresa,
 *    linhas conferidas (produto OU kit, override só em produto, sem repetir), JSON do formulário aceito;
 *  - a planilha de exportação do serviço NÃO ganha a composição; a rota de custos só devolve produtos da empresa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import {
  comportamentoEfetivo, custoDoKit, custoDosMateriais, erroDasLinhas, erroDosItensDoKit, expandirComposicao, rotuloOrigem,
} from "@/lib/estoque/composicao";
import { gerarXlsx } from "@/lib/folha/planilha";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const por = (T: (m: string) => any[], m: string, id: string | null | undefined) => T(m).find((x) => x.id === id) ?? null;
  const produtoDe = (T: (m: string) => any[], id: string | null | undefined) => { const p = por(T, "produto", id); return p && { ...p, categoriaProduto: por(T, "categoriaProduto", p.categoriaProdutoId) }; };
  const itensDoKit = (T: (m: string) => any[], kitId: string) => T("kitMaterialItem").filter((i) => i.kitId === kitId).sort((a, b) => a.ordem - b.ordem).map((i) => ({ ...i, produto: produtoDe(T, i.produtoId) }));
  const kitDe = (T: (m: string) => any[], id: string | null | undefined) => { const k = por(T, "kitMaterial", id); return k && { ...k, itens: itensDoKit(T, k.id) }; };
  return {
    prisma: criarPrisma(db, {
      produto: (p, T) => ({ categoriaProduto: por(T, "categoriaProduto", p.categoriaProdutoId) }),
      kitMaterial: (k, T) => ({ itens: itensDoKit(T, k.id), _count: { servicoMateriais: T("servicoMaterial").filter((m) => m.kitId === k.id).length } }),
      servico: (s, T) => ({
        materiais: T("servicoMaterial").filter((m) => m.servicoId === s.id).sort((a, b) => a.ordem - b.ordem).map((m) => ({ ...m, produto: produtoDe(T, m.produtoId), kit: kitDe(T, m.kitId) })),
        _count: { materiais: T("servicoMaterial").filter((m) => m.servicoId === s.id).length },
      }),
    }, {
      kitMaterial: { itens: ["kitMaterialItem", "kitId"] },
      servico: { materiais: ["servicoMaterial", "servicoId"] },
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
const mov = (id: string, produtoId: string, custo: number, data: string) => ({ id, empresaId: "e1", produtoId, tipo: "ENTRADA", origem: "COMPRA", quantidade: 10, custoUnitario: custo, data: new Date(data), criadoEm: new Date(data) });

beforeEach(() => {
  db.escritas = []; db.seq = 0;
  db.t = {
    empresa: [{ id: "e1" }, { id: "e2" }],
    categoriaProduto: [
      { id: "cPeca", empresaId: "e1", nome: "Peças de reposição", comportamento: "VENDA_A_PARTE", ativo: true },
      { id: "cMat", empresaId: "e1", nome: "Materiais de instalação/consumo", comportamento: "INCLUSO_NO_SERVICO", ativo: true },
    ],
    produto: [
      { id: "p1", empresaId: "e1", codigo: 1, nome: "Gás R410A", unidade: "kg", ativo: true, categoriaProdutoId: "cMat", controlaEstoque: true },
      { id: "p2", empresaId: "e1", codigo: 2, nome: "Capacitor 35uF", unidade: "un", ativo: true, categoriaProdutoId: "cPeca", controlaEstoque: true },
      { id: "p3", empresaId: "e1", codigo: 3, nome: "Suporte", unidade: "un", ativo: true, categoriaProdutoId: null, controlaEstoque: true },
      { id: "pOff", empresaId: "e1", codigo: 4, nome: "Antigo", unidade: "un", ativo: false, categoriaProdutoId: "cMat", controlaEstoque: true },
      { id: "pB", empresaId: "e2", codigo: 1, nome: "Gás da outra", unidade: "kg", ativo: true, categoriaProdutoId: null, controlaEstoque: true },
    ],
    servico: [
      { id: "s1", empresaId: "e1", codigo: "INST01", nome: "Instalação", unidade: "un", ativo: true },
      { id: "sB", empresaId: "e2", codigo: "OUT01", nome: "Outra", unidade: "un", ativo: true },
    ],
    kitMaterial: [{ id: "kOff", empresaId: "e1", nome: "Kit antigo", ativo: false }, { id: "kB", empresaId: "e2", nome: "Kit da outra", ativo: true }],
    kitMaterialItem: [{ id: "kiB", kitId: "kB", produtoId: "pB", quantidade: 1, ordem: 0 }],
    servicoMaterial: [],
    // Custos de compra: p1 = 50/kg (a última entrada manda), p2 = 30; p3 nunca teve compra com custo
    movimentacaoEstoque: [mov("m1", "p1", 40, "2026-01-10"), mov("m2", "p1", 50, "2026-02-10"), mov("m3", "p2", 30, "2026-02-01"), { ...mov("m4", "p3", 99, "2026-02-01"), custoUnitario: null }],
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
const kits = api("kits-material");
const servicos = api("servicos");
const impacto = (entidade: string, id: string) => chamar(() => import("@/app/api/cadastros/[entidade]/[id]/impacto/route"), "GET", { entidade, id });
const massa = (corpo: unknown) => chamar(() => import("@/app/api/acoes-massa/route"), "POST", {}, corpo);
const custos = (ids: string) => chamar(() => import("@/app/api/estoque/custos/route"), "GET", {}, undefined, `http://localhost/api/estoque/custos?ids=${ids}`);

const P1 = { id: "p1", nome: "Gás R410A", unidade: "kg", categoriaProduto: { comportamento: "INCLUSO_NO_SERVICO" } };
const P2 = { id: "p2", nome: "Capacitor 35uF", unidade: "un", categoriaProduto: { comportamento: "VENDA_A_PARTE" } };
const P3 = { id: "p3", nome: "Suporte", unidade: "un", categoriaProduto: null };
const KIT = { id: "k1", nome: "Kit instalação", itens: [{ produtoId: "p1", quantidade: "0.5", produto: P1 }, { produtoId: "p3", quantidade: 2, produto: P3 }] };

// ═════════════════════════ Regra pura ═════════════════════════
describe("composição (regra pura)", () => {
  it("comportamento efetivo: override válido vence; inválido/vazio = o da categoria; sem categoria = incluso", () => {
    expect(comportamentoEfetivo("VENDA_A_PARTE", P1)).toBe("VENDA_A_PARTE");
    expect(comportamentoEfetivo(null, P2)).toBe("VENDA_A_PARTE");
    expect(comportamentoEfetivo("", P2)).toBe("VENDA_A_PARTE");
    expect(comportamentoEfetivo("GRATIS", P1)).toBe("INCLUSO_NO_SERVICO");
    expect(comportamentoEfetivo(undefined, P3)).toBe("INCLUSO_NO_SERVICO");
    expect(comportamentoEfetivo(undefined, null)).toBe("INCLUSO_NO_SERVICO");
  });

  it("expande: produto solto = 1 material; kit = itens × quantidade de kits (kit vivo); origem e inativo marcados; linha sem vínculo carregado é ignorada", () => {
    const m = expandirComposicao([
      { produtoId: "p2", quantidade: "1", produto: P2 },
      { kitId: "k1", quantidade: 2, kit: KIT },
      { produtoId: "p1", quantidade: 0.1, comportamento: "VENDA_A_PARTE", produto: { ...P1, ativo: false } },
      { kitId: "k-removido", quantidade: 1, kit: null },
      { produtoId: "p-removido", quantidade: 1 },
    ]);
    expect(m.map((x) => [x.produtoId, x.quantidade, x.comportamento, rotuloOrigem(x), x.inativo])).toEqual([
      ["p2", 1, "VENDA_A_PARTE", "Avulso", false],
      ["p1", 1, "INCLUSO_NO_SERVICO", "Kit Kit instalação", false],
      ["p3", 4, "INCLUSO_NO_SERVICO", "Kit Kit instalação", false],
      ["p1", 0.1, "VENDA_A_PARTE", "Avulso", true],
    ]);
    expect(m[1].origem).toEqual({ tipo: "kit", kitId: "k1", kitNome: "Kit instalação" });
    expect(m.map((x) => x.unidade)).toEqual(["un", "kg", "un", "kg"]);
    expect(expandirComposicao(null)).toEqual([]);
    // Arredonda a 3 casas (0,1 × 3 não vira 0,30000000000000004)
    expect(expandirComposicao([{ kitId: "k", quantidade: 3, kit: { id: "k", nome: "K", itens: [{ produtoId: "p1", quantidade: 0.1, produto: P1 }] } }])[0].quantidade).toBe(0.3);
  });

  it("custo: soma custo × quantidade dos INCLUSOS (à parte separado); produto sem custo entra em semCusto; custo do kit idem", () => {
    const custos = new Map([["p1", 50], ["p2", 30]]);
    const m = expandirComposicao([{ produtoId: "p2", quantidade: 2, produto: P2 }, { kitId: "k1", quantidade: 2, kit: KIT }]);
    // inclusos: p1 1kg × 50 = 50 (p3 sem custo); à parte: p2 2 × 30 = 60
    expect(custoDosMateriais(m, custos)).toEqual({ inclusos: 50, aParte: 60, semCusto: ["p3"] });
    expect(custoDoKit(KIT, custos)).toEqual({ total: 25, semCusto: ["p3"] });
    expect(custoDoKit({ itens: [] }, custos)).toEqual({ total: 0, semCusto: [] });
    expect(custoDosMateriais([], custos)).toEqual({ inclusos: 0, aParte: 0, semCusto: [] });
    // Centavos: 3 × 0,1 kg × 33,33 = 9,999 → 10,00
    expect(custoDosMateriais(expandirComposicao([{ produtoId: "p1", quantidade: 0.3, produto: P1 }]), new Map([["p1", 33.33]])).inclusos).toBe(10);
  });

  it("conferência das linhas e dos itens do kit: a mesma mensagem na tela e no servidor", () => {
    expect(erroDasLinhas([{ produtoId: "p1", quantidade: 1 }, { kitId: "k1", quantidade: "2,5" }])).toBeNull();
    expect(erroDasLinhas([{ quantidade: 1 }])).toMatch(/produto OU um kit/);
    expect(erroDasLinhas([{ produtoId: "p1", kitId: "k1", quantidade: 1 }])).toMatch(/produto OU um kit/);
    expect(erroDasLinhas([{ produtoId: "p1", quantidade: 0 }])).toMatch(/maior que zero/);
    expect(erroDasLinhas([{ produtoId: "p1", quantidade: "abc" }])).toMatch(/maior que zero/);
    expect(erroDasLinhas([{ kitId: "k1", quantidade: 1, comportamento: "VENDA_A_PARTE" }])).toMatch(/adicione o produto solto/);
    expect(erroDasLinhas([{ produtoId: "p1", quantidade: 1, comportamento: "GRATIS" }])).toMatch(/inválido/);
    expect(erroDasLinhas([{ produtoId: "p1", quantidade: 1, comportamento: "" }])).toBeNull();
    expect(erroDasLinhas([{ produtoId: "p1", quantidade: 1 }, { produtoId: "p1", quantidade: 2 }])).toMatch(/mesmo produto/);
    expect(erroDasLinhas([{ kitId: "k1", quantidade: 1 }, { kitId: "k1", quantidade: 2 }])).toMatch(/mesmo kit/);
    expect(erroDosItensDoKit([{ produtoId: "p1", quantidade: "0,5" }])).toBeNull();
    expect(erroDosItensDoKit([{ produtoId: "", quantidade: 1 }])).toMatch(/precisa de um produto/);
    expect(erroDosItensDoKit([{ produtoId: "p1", quantidade: -1 }])).toMatch(/maior que zero/);
    expect(erroDosItensDoKit([{ produtoId: "p1", quantidade: 1 }, { produtoId: "p1", quantidade: 1 }])).toMatch(/duas vezes no kit/);
  });
});

// ═════════════════════════ Cadastro: kits de material ═════════════════════════
describe("cadastro de kits de material (rotas reais, banco em memória)", () => {
  const novoKit = async (extra: Record<string, unknown> = {}) => kits("POST", { nome: "Kit instalação", itens: [{ produtoId: "p1", quantidade: "0,5" }, { produtoId: "p3", quantidade: 2 }], ...extra });

  it("cria com os itens (ordem, quantidade numérica), devolve os itens com o produto; lista paginada traz o custo de referência e o uso", async () => {
    const r = await novoKit();
    expect(r.status).toBe(201);
    expect(r.json.nome).toBe("Kit instalação");
    expect(T("kitMaterialItem").filter((i) => i.kitId === r.json.id).map((i) => [i.produtoId, i.quantidade, i.ordem])).toEqual([["p1", 0.5, 0], ["p3", 2, 1]]);
    expect(r.json.itens.map((i: any) => [i.produtoId, i.produto.nome, i.produto.categoriaProduto?.comportamento ?? null])).toEqual([["p1", "Gás R410A", "INCLUSO_NO_SERVICO"], ["p3", "Suporte", null]]);
    const lista = await kits("GET", undefined, undefined, "?pagina=1&por=20");
    expect(lista.status).toBe(200);
    const k = lista.json.itens.find((x: any) => x.id === r.json.id);
    // p1: 0,5 kg × 50 = 25; p3 sem custo de compra (a soma avisa)
    expect(k.custoReferencia).toEqual({ total: 25, semCusto: ["p3"] });
    expect(k._count.servicoMateriais).toBe(0);
    // A lista simples (seletores) traz os itens com o produto (a seção do serviço mostra o kit "aberto")
    const simples = await kits("GET", undefined, undefined, "?ativo=todos");
    expect(simples.json.find((x: any) => x.id === r.json.id).itens).toHaveLength(2);
    // Só os kits da e1 (o da outra empresa não aparece)
    expect(simples.json.map((x: any) => x.id).sort()).toEqual([r.json.id, "kOff"].sort());
  });

  it("itens conferidos: quantidade > 0, sem repetir, produto da empresa e ativo quando novo; manter o inativo ao editar é aceito; campo a mais = 400", async () => {
    expect((await novoKit({ itens: [{ produtoId: "p1", quantidade: 0 }] })).json.erro).toMatch(/maior que zero/);
    expect((await novoKit({ itens: [{ produtoId: "p1", quantidade: "x" }] })).status).toBe(400);
    expect((await novoKit({ itens: [{ produtoId: "p1", quantidade: 1 }, { produtoId: "p1", quantidade: 1 }] })).json.erro).toMatch(/duas vezes/);
    expect((await novoKit({ itens: [{ produtoId: "pB", quantidade: 1 }] })).json).toEqual({ erro: "Produto inválido(a)." });
    expect((await novoKit({ itens: [{ produtoId: "nao-existe", quantidade: 1 }] })).status).toBe(400);
    expect((await novoKit({ itens: [{ produtoId: "pOff", quantidade: 1 }] })).json.erro).toMatch(/inativo/);
    expect((await novoKit({ itens: [{ produtoId: "p1", quantidade: 1, extra: 1 }] })).status).toBe(400);
    expect((await novoKit({ empresaId: "e2" })).json.erro).toMatch(/Campo não permitido: empresaId/);
    expect(T("kitMaterial").filter((k) => k.empresaId === "e1" && k.id !== "kOff")).toHaveLength(0);
    // Itens podem chegar como JSON (texto) — o formulário genérico manda assim
    const r = await novoKit({ itens: JSON.stringify([{ produtoId: "p2", quantidade: "1" }]) });
    expect(r.status).toBe(201);
    expect(T("kitMaterialItem").filter((i) => i.kitId === r.json.id).map((i) => i.produtoId)).toEqual(["p2"]);
    // Kit com um produto que foi inativado depois: editar só o nome mantém; mandar os itens de novo com ele também
    T("kitMaterialItem").push({ id: "kiX", kitId: r.json.id, produtoId: "pOff", quantidade: 1, ordem: 1 });
    expect((await kits("PATCH", { nome: "Kit renomeado" }, r.json.id)).status).toBe(200);
    expect(T("kitMaterialItem").filter((i) => i.kitId === r.json.id)).toHaveLength(2);
    expect((await kits("PATCH", { itens: [{ produtoId: "pOff", quantidade: 3 }] }, r.json.id)).status).toBe(200);
    expect(T("kitMaterialItem").filter((i) => i.kitId === r.json.id).map((i) => [i.produtoId, i.quantidade])).toEqual([["pOff", 3]]);
    // Kit inativo da própria empresa não entra como novo item de serviço (ver abaixo) — mas um kit NOVO com item inativo também não
    expect((await kits("POST", { nome: "Outro", itens: [{ produtoId: "pOff", quantidade: 1 }] })).status).toBe(400);
  });

  it("nome único na empresa (sem diferença de maiúsculas, inativo avisa); outra empresa pode repetir; itens vazios limpam", async () => {
    const r = await novoKit();
    expect((await kits("POST", { nome: "  kit INSTALAÇÃO ", itens: [] })).json).toEqual({ erro: "Já existe o kit “Kit instalação”." });
    expect((await kits("POST", { nome: "kit antigo", itens: [] })).json.erro).toMatch(/inativo — reative-o/);
    expect((await kits("PATCH", { nome: "Kit antigo" }, r.json.id)).status).toBe(409);
    expect((await kits("PATCH", { nome: "Kit instalação" }, r.json.id)).status).toBe(200); // o próprio nome
    logar(permissoesTotais(), "e2");
    expect((await kits("POST", { nome: "Kit instalação", itens: [{ produtoId: "pB", quantidade: 1 }] })).status).toBe(201);
    logar();
    expect((await kits("PATCH", { itens: [] }, r.json.id)).status).toBe(200);
    expect(T("kitMaterialItem").filter((i) => i.kitId === r.json.id)).toHaveLength(0);
  });

  it("permissões: qualquer logado lê; gravar/inativar = Configurações › gerenciar; sem sessão 401; outra empresa não vê nem edita", async () => {
    const r = await novoKit();
    logar(so({ configuracoes: { visualizar: true } }));
    expect((await kits("GET")).status).toBe(200);
    expect((await kits("POST", { nome: "X", itens: [] })).status).toBe(403);
    expect((await kits("PATCH", { nome: "X" }, r.json.id)).status).toBe(403);
    expect((await kits("PATCH", { ativo: false }, r.json.id)).status).toBe(403);
    logar(permissoesTotais(), "e2");
    expect((await kits("GET", undefined, r.json.id)).status).toBe(404);
    expect((await kits("PATCH", { nome: "roubo" }, r.json.id)).status).toBe(404);
    sessao.atual = null;
    expect((await kits("GET")).status).toBe(401);
    logar();
    expect(T("kitMaterial").find((k) => k.id === r.json.id).nome).toBe("Kit instalação");
  });

  it("impacto antes de inativar: quantos serviços usam (só da empresa); ações em massa inativam/reativam e 'todos do filtro'", async () => {
    const r = await novoKit();
    // (uso zerado não aparece: o modal diz "Não está em uso em nenhum registro.")
    expect((await impacto("kits-material", r.json.id)).json).toMatchObject({ usos: [], avisos: ["Não está em uso em nenhum registro."] });
    expect((await servicos("POST", { nome: "Instalação completa", materiais: [{ kitId: r.json.id, quantidade: 1 }] })).status).toBe(201);
    T("servicoMaterial").push({ id: "smB", servicoId: "sB", kitId: r.json.id, produtoId: null, quantidade: 1, ordem: 0 }); // (impossível pela API; só para provar o escopo)
    const imp = await impacto("kits-material", r.json.id);
    expect(imp.json.usos).toEqual([{ rotulo: "1 serviço", total: 1 }]);
    expect(imp.json.avisos.join(" ")).toMatch(/Usado nos materiais padrão de 1 serviço/);
    const m = await massa({ entidade: "kits-material", acao: "inativar", ids: [r.json.id, "kB"] });
    expect(m.status).toBe(200);
    expect(T("kitMaterial").find((k) => k.id === r.json.id).ativo).toBe(false);
    expect(T("kitMaterial").find((k) => k.id === "kB").ativo).toBe(true); // o da outra empresa não é tocado
    expect((await massa({ entidade: "kits-material", acao: "reativar", ids: [r.json.id] })).json.resumo.feitas).toBe(1);
    expect((await massa({ entidade: "kits-material", acao: "ids-do-filtro", filtro: "aba=inativos" })).json).toEqual({ ids: ["kOff"], total: 1 });
    const mod = await import("@/app/api/acoes-massa/route");
    const res = await mod.POST(new NextRequest("http://localhost/api/acoes-massa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entidade: "kits-material", acao: "exportar", ids: [r.json.id] }) }));
    expect(await res.text()).toMatch(/Nome;Descrição;Situação[\s\S]*Kit instalação;;Ativo/);
  });
});

// ═════════════════════════ Serviço: composição ═════════════════════════
describe("composição do serviço (materiais padrão)", () => {
  let k1 = "";
  beforeEach(async () => { k1 = (await kits("POST", { nome: "Kit instalação", itens: [{ produtoId: "p1", quantidade: 0.5 }, { produtoId: "p3", quantidade: 2 }] })).json.id; });
  const criar = (materiais: unknown, extra: Record<string, unknown> = {}) => servicos("POST", { nome: "Instalação split", materiais, ...extra });
  const efetivos = async (id: string) => expandirComposicao((await servicos("GET", undefined, id)).json.materiais).map((m) => [m.produtoId, m.quantidade, m.comportamento, m.origem.tipo]);

  it("serviço SEM composição funciona como sempre: cria sem o campo, lista conta 0, registro traz materiais: []; a planilha não ganha a coluna", async () => {
    const r = await servicos("POST", { nome: "Limpeza" });
    expect(r.status).toBe(201);
    expect(T("servicoMaterial")).toHaveLength(0);
    expect((await servicos("GET", undefined, r.json.id)).json.materiais).toEqual([]);
    const lista = await servicos("GET", undefined, undefined, "?pagina=1&por=20");
    expect(lista.json.itens.find((s: any) => s.id === r.json.id)._count).toEqual({ materiais: 0 });
    expect((await servicos("PATCH", { nome: "Limpeza geral" }, r.json.id)).json.nome).toBe("Limpeza geral");
    const mod = await import("@/app/api/acoes-massa/route");
    const res = await mod.POST(new NextRequest("http://localhost/api/acoes-massa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entidade: "servicos", acao: "exportar", ids: [r.json.id] }) }));
    const csv = await res.text();
    expect(csv).not.toContain("Materiais padrão");
    expect(csv).toContain("Valor padrão (R$);Código do serviço (LC 116)");
  });

  it("cria com produto solto, kit e override; grava só a referência (comportamento efetivo não é gravado); o registro vem com o kit aberto", async () => {
    const r = await criar([
      { produtoId: "p2", quantidade: "1" },
      { kitId: k1, quantidade: 2 },
      { produtoId: "p1", quantidade: 1, comportamento: "VENDA_A_PARTE" },
    ]);
    expect(r.status).toBe(201);
    expect(T("servicoMaterial").filter((m) => m.servicoId === r.json.id).map((m) => [m.produtoId, m.kitId, m.quantidade, m.comportamento, m.ordem]))
      .toEqual([["p2", null, 1, null, 0], [null, k1, 2, null, 1], ["p1", null, 1, "VENDA_A_PARTE", 2]]);
    const g = await servicos("GET", undefined, r.json.id);
    expect(g.json.materiais[1].kit.itens.map((i: any) => i.produto.nome)).toEqual(["Gás R410A", "Suporte"]);
    expect(g.json.materiais[0].produto.categoriaProduto.comportamento).toBe("VENDA_A_PARTE");
    // Expansão (o que a E3.3 vai copiar): peça à parte pela categoria; itens do kit × 2 pela categoria (sem categoria = incluso); override
    expect(await efetivos(r.json.id)).toEqual([
      ["p2", 1, "VENDA_A_PARTE", "solto"], ["p1", 1, "INCLUSO_NO_SERVICO", "kit"], ["p3", 4, "INCLUSO_NO_SERVICO", "kit"], ["p1", 1, "VENDA_A_PARTE", "solto"],
    ]);
    expect((await servicos("GET", undefined, undefined, "?pagina=1&por=20")).json.itens.find((s: any) => s.id === r.json.id)._count.materiais).toBe(3);
  });

  it("kit VIVO: mudar os itens do kit (ou a categoria do produto) muda o que o serviço expande, sem tocar na composição gravada", async () => {
    const r = await criar([{ kitId: k1, quantidade: 2 }]);
    expect(await efetivos(r.json.id)).toEqual([["p1", 1, "INCLUSO_NO_SERVICO", "kit"], ["p3", 4, "INCLUSO_NO_SERVICO", "kit"]]);
    expect((await kits("PATCH", { itens: [{ produtoId: "p1", quantidade: 1 }, { produtoId: "p2", quantidade: 1 }] }, k1)).status).toBe(200);
    expect(await efetivos(r.json.id)).toEqual([["p1", 2, "INCLUSO_NO_SERVICO", "kit"], ["p2", 2, "VENDA_A_PARTE", "kit"]]);
    // A categoria do produto mudou de comportamento: o serviço reflete (nada gravado na composição)
    T("categoriaProduto").find((c) => c.id === "cMat").comportamento = "VENDA_A_PARTE";
    expect((await efetivos(r.json.id))[0][2]).toBe("VENDA_A_PARTE");
    expect(T("servicoMaterial").filter((m) => m.servicoId === r.json.id)).toEqual([expect.objectContaining({ kitId: k1, quantidade: 2, comportamento: null })]);
  });

  it("edição PARCIAL: sem `materiais` nada muda (renomear não apaga); com `materiais` substitui; JSON do formulário é aceito; [] limpa", async () => {
    const r = await criar([{ produtoId: "p2", quantidade: 1 }, { kitId: k1, quantidade: 1 }]);
    expect((await servicos("PATCH", { nome: "Instalação split 12k", valorPadrao: "350" }, r.json.id)).status).toBe(200);
    expect(T("servicoMaterial").filter((m) => m.servicoId === r.json.id)).toHaveLength(2);
    expect((await servicos("PATCH", { materiais: JSON.stringify([{ produtoId: "p1", quantidade: "2,5", comportamento: "" }]) }, r.json.id)).status).toBe(200);
    expect(T("servicoMaterial").filter((m) => m.servicoId === r.json.id).map((m) => [m.produtoId, m.quantidade, m.comportamento])).toEqual([["p1", 2.5, null]]);
    // A resposta da edição já traz a composição nova (a rota relê o registro)
    const e = await servicos("PATCH", { materiais: [] }, r.json.id);
    expect(e.json.materiais).toEqual([]);
    expect(T("servicoMaterial").filter((m) => m.servicoId === r.json.id)).toHaveLength(0);
    // Edição inválida não apaga a composição que estava
    await servicos("PATCH", { materiais: [{ produtoId: "p2", quantidade: 1 }] }, r.json.id);
    expect((await servicos("PATCH", { materiais: [{ produtoId: "pB", quantidade: 1 }] }, r.json.id)).status).toBe(400);
    expect(T("servicoMaterial").filter((m) => m.servicoId === r.json.id).map((m) => m.produtoId)).toEqual(["p2"]);
  });

  it("linhas conferidas (400 com a mensagem da regra): produto OU kit, quantidade > 0, override só em produto, sem repetir, vínculos só da empresa e ativos quando novos", async () => {
    const erro = async (materiais: unknown) => { const r = await criar(materiais); expect(r.status).toBe(400); return r.json.erro as string; };
    expect(await erro([{ quantidade: 1 }])).toMatch(/Materiais padrão: Cada material é um produto OU um kit/);
    expect(await erro([{ produtoId: "p1", kitId: k1, quantidade: 1 }])).toMatch(/produto OU um kit/);
    expect(await erro([{ produtoId: "p1", quantidade: 0 }])).toMatch(/maior que zero/);
    expect(await erro([{ produtoId: "p1", quantidade: "abc" }])).toMatch(/Materiais padrão/);
    expect(await erro([{ kitId: k1, quantidade: 1, comportamento: "VENDA_A_PARTE" }])).toMatch(/adicione o produto solto/);
    expect(await erro([{ produtoId: "p1", quantidade: 1, comportamento: "GRATIS" }])).toMatch(/inválido/);
    expect(await erro([{ produtoId: "p1", quantidade: 1 }, { produtoId: "p1", quantidade: 1 }])).toMatch(/mesmo produto/);
    expect(await erro([{ kitId: k1, quantidade: 1 }, { kitId: k1, quantidade: 1 }])).toMatch(/mesmo kit/);
    expect(await erro([{ produtoId: "pB", quantidade: 1 }])).toBe("Produto inválido(a).");
    expect(await erro([{ kitId: "kB", quantidade: 1 }])).toBe("Kit de material inválido(a).");
    expect(await erro([{ kitId: "nao-existe", quantidade: 1 }])).toBe("Kit de material inválido(a).");
    expect(await erro([{ kitId: "kOff", quantidade: 1 }])).toMatch(/Kit de material inativo/);
    expect(await erro([{ produtoId: "pOff", quantidade: 1 }])).toMatch(/Produto inativo/);
    expect(await erro([{ produtoId: "p1", quantidade: 1, extra: true }])).toBeTruthy();
    expect(await erro("isso não é lista")).toMatch(/Materiais padrão/);
    expect(T("servico").filter((s) => s.empresaId === "e1")).toHaveLength(1); // nada foi criado
    // Manter o kit/produto que a composição JÁ tinha, mesmo inativo, é aceito
    const r = await criar([{ kitId: k1, quantidade: 1 }, { produtoId: "p1", quantidade: 1 }]);
    T("kitMaterial").find((k) => k.id === k1).ativo = false;
    T("produto").find((p) => p.id === "p1").ativo = false;
    expect((await servicos("PATCH", { materiais: [{ kitId: k1, quantidade: 3 }, { produtoId: "p1", quantidade: 2 }] }, r.json.id)).status).toBe(200);
    expect((await servicos("POST", { nome: "Novo", materiais: [{ kitId: k1, quantidade: 1 }] })).status).toBe(400);
    // Permissão: gravar a composição exige o mesmo que editar o serviço
    logar(so({ configuracoes: { visualizar: true } }));
    expect((await servicos("PATCH", { materiais: [] }, r.json.id)).status).toBe(403);
  });

  it("a planilha de importação de serviços continua criando normalmente (o padrão `materiais: []` do schema não vai para a gravação)", async () => {
    const mod = await import("@/app/api/importacao/[entidade]/route");
    const fd = new FormData();
    fd.append("arquivo", new File([new Uint8Array(gerarXlsx([{ nome: "Dados", linhas: [["codigo", "nome", "unidade"], ["", "Higienização de duto", "un"]] }]))], "dados.xlsx"));
    fd.append("etapa", "confirmar");
    const res: Response = await mod.POST(new NextRequest("http://localhost/x", { method: "POST", body: fd }), { params: Promise.resolve({ entidade: "servicos" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ criados: 1, comErro: 0 });
    const novo = T("servico").find((x) => x.nome === "Higienização de duto");
    expect(novo).toMatchObject({ empresaId: "e1", ativo: true });
    expect("materiais" in novo).toBe(false); // (no Prisma real, `materiais: []` na gravação seria recusado)
    expect(T("servicoMaterial")).toHaveLength(0);
  });

  it("impacto do produto conta kits e serviços (materiais padrão) que o usam; rota de custos só devolve produtos da empresa com custo", async () => {
    await criar([{ produtoId: "p1", quantidade: 1 }]);
    const imp = await impacto("produtos", "p1");
    expect(imp.json.usos).toEqual(expect.arrayContaining([{ rotulo: "1 kit de material", total: 1 }, { rotulo: "1 serviço (materiais padrão)", total: 1 }]));
    expect((await impacto("produtos", "p2")).json.usos.map((u: any) => u.rotulo)).not.toEqual(expect.arrayContaining([expect.stringMatching(/kit|materiais padrão/)]));
    const c = await custos("p1,p2,p3,pB,nao-existe");
    expect(c.status).toBe(200);
    expect(c.json).toEqual({ custos: { p1: 50, p2: 30 } });
    expect((await custos("")).json).toEqual({ custos: {} });
    sessao.atual = null;
    expect((await custos("p1")).status).toBe(401);
  });
});
