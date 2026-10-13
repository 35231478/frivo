/**
 * Padrão de listas — servidor. Rotas e páginas reais, banco em memória (com orderBy/skip/take),
 * DUAS empresas. Prova:
 *  - paginação no servidor: tamanho 25/50/100 (outro = 50), avançar/voltar, total certo, página
 *    além do fim volta para a última, páginas não repetem nem pulam registro (desempate por id);
 *  - busca no servidor (ILIKE) nos campos da entidade, com as contagens das abas;
 *  - ordenação só por colunas da lista branca (asc/desc; coluna inventada = ordem padrão);
 *  - sugestões: no máximo 5, as que mais combinam primeiro, só da empresa, com permissão;
 *  - Clientes, Orçamentos, OS, Contratos e Equipes paginam no servidor (nada de "só os 100 primeiros");
 *  - empresa sempre da sessão; permissão respeitada; listar não grava nada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import {
  faixa, lerOrdem, lerPaginacao, ordemPrisma, paginasVisiveis, paginaValida, pediuPaginacao, pontuar, proximaOrdem,
  ranquearSugestoes, variantesDocumento,
} from "@/lib/listagem";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  return {
    prisma: criarPrisma(db, {
      cliente: (r, T) => ({
        _count: {
          unidades: T("unidade").filter((u) => u.clienteId === r.id).length,
          ordensServico: T("ordemServico").filter((o) => o.clienteId === r.id).length,
          contratos: 0,
        },
        responsavelTecnico: null,
      }),
      orcamento: (r, T) => ({ cliente: T("cliente").find((c) => c.id === r.clienteId) ?? null, _count: { ordensServico: 0 } }),
      ordemServico: (r, T) => ({ cliente: T("cliente").find((c) => c.id === r.clienteId) ?? null, unidade: null, responsavel: null, atividades: [] }),
      contrato: (r, T) => ({ cliente: T("cliente").find((c) => c.id === r.clienteId) ?? null, ordensServico: [] }),
      tabelaPreco: (r, T) => ({ _count: { itens: 0, clientes: T("cliente").filter((c) => c.tabelaPrecoId === r.id).length } }),
      equipe: (r, T) => ({ lider: null, membros: T("tecnico").filter((t) => t.equipeId === r.id), veiculos: [] }),
      tecnico: (r, T) => ({ cargo: T("cargo").find((c) => c.id === r.cargoId) ?? null, perfilAcesso: null }),
      perfilAcesso: (r, T) => ({ colaboradores: T("tecnico").filter((t) => t.perfilAcessoId === r.id) }),
    }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.mock("@/lib/status-financeiro", async (orig) => ({ ...(await orig<object>()), calcularStatusFinanceiroEmLote: async () => ({}) }));
const url = vi.hoisted(() => ({ atual: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(url.atual),
}));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Zé", email: "ze@x.com", empresaId, role: "OPERADOR", permissoes } };
};
const N = 60;
const doisDig = (i: number) => String(i).padStart(2, "0");

function semear() {
  db.escritas = [];
  db.seq = 0;
  db.t = {
    // 60 produtos na e1 (valor decrescente ao contrário do nome; dois empates de nome para o desempate por id)
    produto: [
      ...Array.from({ length: N }, (_, i) => ({ id: `p${doisDig(i + 1)}`, empresaId: "e1", nome: `Produto ${doisDig(i + 1)}`, descricao: i % 10 === 0 ? "Gás refrigerante" : null, unidade: "un", valorPadrao: (N - i) * 10, estoqueMinimo: i % 3 === 0 ? null : i, ativo: i % 7 !== 0 })),
      { id: "pX1", empresaId: "e1", nome: "Igual", unidade: "un", valorPadrao: 1, ativo: true },
      { id: "pX2", empresaId: "e1", nome: "Igual", unidade: "un", valorPadrao: 1, ativo: true },
      ...Array.from({ length: 5 }, (_, i) => ({ id: `pB${i}`, empresaId: "e2", nome: `Produto da outra ${i}`, descricao: "Gás refrigerante", unidade: "un", valorPadrao: 1, ativo: true })),
    ],
    fornecedor: [
      { id: "f1", empresaId: "e1", nome: "Frigelar Distribuidora", documento: "11222333000181", ativo: true },
      { id: "f2", empresaId: "e1", nome: "Gás Frio Comércio", documento: "11444777000161", ativo: true },
      { id: "fB", empresaId: "e2", nome: "Frigelar Outra", documento: "11222333000181", ativo: true },
    ],
    tabelaPreco: [
      { id: "tp1", empresaId: "e1", nome: "A Pouco Usada", tipo: "PADRAO", ativo: true },
      { id: "tp2", empresaId: "e1", nome: "B Muito Usada", tipo: "PADRAO", ativo: true },
    ],
    cliente: [
      ...Array.from({ length: N }, (_, i) => ({
        id: `c${doisDig(i + 1)}`, empresaId: "e1", nome: `Cliente ${doisDig(i + 1)}`, nomeFantasia: null,
        cpfCnpj: `11.222.${String(300 + i).padStart(3, "0")}/0001-${doisDig(i)}`, segmento: null, satisfacao: null, ativo: true,
        tabelaPrecoId: i < 3 ? "tp2" : i < 4 ? "tp1" : null,
      })),
      { id: "cB", empresaId: "e2", nome: "Cliente 01 da outra", cpfCnpj: "11.222.300/0001-00", ativo: true },
    ],
    unidade: [], ordemServico: [], orcamento: [], contrato: [], usuario: [], tipoOs: [],
    equipe: [], tecnico: [], cargo: [], perfilAcesso: [],
  };
  // OS, orçamentos e contratos: 130 de cada na e1 (antes a lista cortava em 100/200), 3 na e2
  const agora = Date.now();
  for (let i = 1; i <= 130; i++) {
    const criadoEm = new Date(agora - i * 3600e3);
    db.t.ordemServico.push({ id: `os${i}`, empresaId: "e1", numero: `OS-${String(i).padStart(4, "0")}`, clienteId: "c01", status: "ABERTA", prioridade: "MEDIA", origem: "INTERNA", descricao: "x", criadoEm, previsaoConclusao: null, chamadoNumero: null });
    db.t.orcamento.push({ id: `or${i}`, empresaId: "e1", codigo: `ORC-${String(i).padStart(4, "0")}`, nome: `Orçamento ${i}`, clienteId: "c01", tipo: "COMUM", status: "RASCUNHO", totalGeral: i, criadoEm });
    db.t.contrato.push({ id: `ct${i}`, empresaId: "e1", numero: `CT-${String(i).padStart(4, "0")}`, clienteId: "c01", tipo: "MANUTENCAO", status: "ATIVO", periodicidade: "MENSAL", valorMensal: i, dataInicio: criadoEm, dataFim: null, criadoEm });
  }
  for (let i = 1; i <= 3; i++) {
    db.t.ordemServico.push({ id: `osB${i}`, empresaId: "e2", numero: `OS-B${i}`, clienteId: "cB", status: "ABERTA", prioridade: "MEDIA", descricao: "x", criadoEm: new Date() });
  }
  for (let i = 1; i <= 30; i++) db.t.equipe.push({ id: `eq${i}`, empresaId: "e1", nome: `Equipe ${doisDig(i)}`, cor: "#000", status: i === 30 ? "INATIVA" : "ATIVA" });
  db.t.equipe.push({ id: "eqB", empresaId: "e2", nome: "Equipe da outra", cor: "#000", status: "ATIVA" });
}
let foto = "";
beforeEach(() => { semear(); foto = JSON.stringify(db.t); logar(); url.atual = ""; });
const naoGravou = () => db.escritas.length === 0 && JSON.stringify(db.t) === foto;

async function listar(entidade: string, qs: string) {
  const mod = await import("@/app/api/cadastros/[entidade]/route");
  const res: Response = await mod.GET(new NextRequest(`http://localhost/api/cadastros/${entidade}?${qs}`), { params: Promise.resolve({ entidade }) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
async function sugestoes(qs: string) {
  const mod = await import("@/app/api/listas/sugestoes/route");
  const res: Response = await mod.GET(new NextRequest(`http://localhost/api/listas/sugestoes?${qs}`));
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const ids = (r: { json: any }) => r.json.itens.map((i: any) => i.id);

// ═════════════════════════ Peças puras ═════════════════════════
describe("lib/listagem (peças puras)", () => {
  it("lerPaginacao: 25/50/100, outro tamanho = 50; página inválida = 1; aceita page/pageSize", () => {
    expect(lerPaginacao({})).toEqual({ pagina: 1, porPagina: 50 });
    expect(lerPaginacao({ pagina: "3", por: "25" })).toEqual({ pagina: 3, porPagina: 25 });
    expect(lerPaginacao({ pagina: "2", por: "100" })).toEqual({ pagina: 2, porPagina: 100 });
    expect(lerPaginacao({ pagina: "-4", por: "7" })).toEqual({ pagina: 1, porPagina: 50 });
    expect(lerPaginacao({ pagina: "abc", por: "1000000" })).toEqual({ pagina: 1, porPagina: 50 });
    expect(lerPaginacao({ page: "4", pageSize: "25" })).toEqual({ pagina: 4, porPagina: 25 });
    expect(pediuPaginacao({ ativo: "sim" })).toBe(false);
    expect(pediuPaginacao({ por: "25" })).toBe(true);
    expect(pediuPaginacao({ page: "1" })).toBe(true);
  });

  it("paginaValida / faixa: total, última página e lista vazia", () => {
    expect(paginaValida(9, 25, 60)).toBe(3);
    expect(paginaValida(0, 25, 60)).toBe(1);
    expect(paginaValida(5, 25, 0)).toBe(1);
    expect(faixa(1, 25, 60)).toEqual({ de: 1, ate: 25 });
    expect(faixa(3, 25, 60)).toEqual({ de: 51, ate: 60 });
    expect(faixa(1, 25, 0)).toEqual({ de: 0, ate: 0 });
  });

  it("paginasVisiveis: primeira, última, vizinhas e reticências", () => {
    expect(paginasVisiveis(1, 1)).toEqual([1]);
    expect(paginasVisiveis(1, 3)).toEqual([1, 2, 3]);
    expect(paginasVisiveis(6, 20)).toEqual([1, null, 5, 6, 7, null, 20]);
    expect(paginasVisiveis(3, 20)).toEqual([1, 2, 3, 4, null, 20]);
    expect(paginasVisiveis(20, 20)).toEqual([1, null, 19, 20]);
  });

  it("ordenação: só lista branca; id no fim; clicar inverte", () => {
    const mapa = { nome: (d: "asc" | "desc") => ({ nome: d }) };
    expect(lerOrdem({ ordem: "nome", dir: "desc" }, mapa)).toEqual({ campo: "nome", dir: "desc" });
    expect(lerOrdem({ ordem: "senha" }, mapa)).toEqual({ campo: null, dir: "asc" });
    expect(lerOrdem({ ordem: "constructor" }, mapa).campo).toBeNull();
    expect(ordemPrisma({ campo: "nome", dir: "desc" }, mapa, { x: "asc" })).toEqual([{ nome: "desc" }, { id: "asc" }]);
    expect(ordemPrisma({ campo: null, dir: "asc" }, mapa, [{ a: "asc" }, { b: "desc" }])).toEqual([{ a: "asc" }, { b: "desc" }, { id: "asc" }]);
    expect(proximaOrdem({ campo: "nome", dir: "asc" }, "nome")).toEqual({ campo: "nome", dir: "desc" });
    expect(proximaOrdem({ campo: "nome", dir: "desc" }, "nome")).toEqual({ campo: "nome", dir: "asc" });
    expect(proximaOrdem({ campo: "nome", dir: "desc" }, "valor")).toEqual({ campo: "valor", dir: "asc" });
  });

  it("sugestões: no máximo 5; igual > começa com > palavra > contém; sem acento", () => {
    const s = ["Manutenção corretiva", "Gás R22", "Recarga de gás", "GAS", "Gasoduto", "Tubo", "Gás R410A", "Regás", "Água com gás"].map((r, i) => ({ id: String(i), rotulo: r }));
    const r = ranquearSugestoes(s, "gas");
    expect(r).toHaveLength(5);
    // "Começa com" vem antes de "uma palavra começa com", mesmo que a ordem alfabética diga o contrário
    expect(r.map((x) => x.rotulo)).toEqual(["GAS", "Gás R22", "Gás R410A", "Gasoduto", "Água com gás"]);
    // Depois: palavra começa > só contém > achada por outro campo (sem o termo no nome)
    expect(ranquearSugestoes(s, "gas", 9).map((x) => x.rotulo).slice(4)).toEqual(["Água com gás", "Recarga de gás", "Regás", "Manutenção corretiva", "Tubo"]);
    expect(pontuar("Regás", "gas")).toBe(1);
    expect(pontuar("Tubo", "gas")).toBe(0);
  });

  it("variantesDocumento: dígitos viram o CNPJ/CPF mascarado parcial", () => {
    expect(variantesDocumento("11222333")).toEqual(expect.arrayContaining(["11.222.333", "112.223.33"]));
    expect(variantesDocumento("11.222.333/0001-81")).toContain("11222333000181");
    expect(variantesDocumento("ab")).toEqual([]);
    expect(variantesDocumento("Rua 123")).toEqual([]);
  });
});

// ═════════════════════════ Cadastros (rota genérica) ═════════════════════════
describe("rota genérica /api/cadastros/[entidade] paginada", () => {
  it("sem ?pagina/?por mantém a lista inteira (seletores das outras telas)", async () => {
    const r = await listar("produtos", "ativo=todos");
    expect(Array.isArray(r.json)).toBe(true);
    expect(r.json).toHaveLength(N + 2);
  });

  it("tamanho 25: total certo, avançar/voltar, última página parcial, página além do fim", async () => {
    const p1 = await listar("produtos", "ativo=todos&pagina=1&por=25");
    expect(p1.json).toMatchObject({ total: N + 2, pagina: 1, porPagina: 25 });
    expect(p1.json.itens).toHaveLength(25);
    const p2 = await listar("produtos", "ativo=todos&pagina=2&por=25");
    const p3 = await listar("produtos", "ativo=todos&pagina=3&por=25");
    expect(p3.json.itens).toHaveLength(12);
    // Voltar dá a mesma página 2; as três juntas = todos, sem repetir nem pular
    expect(ids(await listar("produtos", "ativo=todos&pagina=2&por=25"))).toEqual(ids(p2));
    const todos = [...ids(p1), ...ids(p2), ...ids(p3)];
    expect(new Set(todos).size).toBe(N + 2);
    // Além do fim: volta para a última
    const p9 = await listar("produtos", "ativo=todos&pagina=9&por=25");
    expect(p9.json.pagina).toBe(3);
    expect(ids(p9)).toEqual(ids(p3));
    expect(naoGravou()).toBe(true);
  });

  it("50 e 100 por página; tamanho fora da lista = 50; aliases page/pageSize", async () => {
    expect((await listar("produtos", "ativo=todos&por=50")).json.itens).toHaveLength(50);
    expect((await listar("produtos", "ativo=todos&por=100")).json.itens).toHaveLength(N + 2);
    expect((await listar("produtos", "ativo=todos&por=5000")).json.porPagina).toBe(50);
    const a = await listar("produtos", "ativo=todos&page=2&pageSize=25");
    expect(a.json).toMatchObject({ pagina: 2, porPagina: 25 });
  });

  it("abas: total da aba + contagens das três (com a busca)", async () => {
    const ativos = await listar("produtos", "ativo=sim&por=25");
    const inativos = Array.from({ length: N }, (_, i) => i).filter((i) => i % 7 === 0).length;
    expect(ativos.json.contagens).toEqual({ ativos: N + 2 - inativos, inativos, todos: N + 2 });
    expect(ativos.json.total).toBe(N + 2 - inativos);
    expect(ativos.json.itens.every((i: any) => i.ativo)).toBe(true);
    const so = await listar("produtos", "ativo=nao&por=25");
    expect(so.json.total).toBe(inativos);
    expect(so.json.itens.every((i: any) => !i.ativo)).toBe(true);
  });

  it("busca no servidor (sem acento? não: ILIKE do banco) nos campos da entidade + contagens com a busca", async () => {
    const r = await listar("produtos", "ativo=todos&por=25&q=produto 0");
    expect(r.json.total).toBe(9);
    expect(r.json.itens.every((i: any) => i.nome.startsWith("Produto 0"))).toBe(true);
    // Campo além do nome (descrição) e só da empresa da sessão
    const g = await listar("produtos", "ativo=todos&por=25&q=REFRIGERANTE");
    expect(g.json.total).toBe(6);
    expect(g.json.itens.every((i: any) => i.empresaId === "e1")).toBe(true);
    expect(g.json.contagens.todos).toBe(6);
    // Fornecedor: busca pelo documento
    const f = await listar("fornecedores", "ativo=todos&por=25&q=11444777");
    expect(ids(f)).toEqual(["f2"]);
  });

  it("ordenação: asc/desc por coluna da lista branca; coluna inventada = padrão (nome)", async () => {
    const asc = await listar("produtos", "ativo=todos&por=100&ordem=valorPadrao");
    const valores = asc.json.itens.map((i: any) => i.valorPadrao);
    expect(valores).toEqual([...valores].sort((a, b) => a - b));
    const desc = await listar("produtos", "ativo=todos&por=25&ordem=valorPadrao&dir=desc");
    expect(desc.json.itens[0].valorPadrao).toBe(N * 10);
    // Nulos por último no asc (como o PostgreSQL)
    const est = await listar("produtos", "ativo=todos&por=100&ordem=estoqueMinimo");
    const e = est.json.itens.map((i: any) => i.estoqueMinimo);
    expect(e.slice(e.findIndex((x: unknown) => x == null)).every((x: unknown) => x == null)).toBe(true);
    // Coluna fora da lista branca (ex.: empresaId) é ignorada
    const hack = await listar("produtos", "ativo=todos&por=25&ordem=empresaId&dir=desc");
    expect(ids(hack)).toEqual(ids(await listar("produtos", "ativo=todos&por=25")));
    expect(hack.json.itens[0].nome).toBe("Igual");
    // Empate de nome: desempate estável pelo id
    expect(ids(hack).slice(0, 2)).toEqual(["pX1", "pX2"]);
  });

  it("ordenação por contagem de relação (tabelas de preço › clientes)", async () => {
    const r = await listar("tabelas-preco", "ativo=todos&por=25&ordem=uso&dir=desc");
    expect(ids(r)).toEqual(["tp2", "tp1"]);
  });

  it("sugestões do cadastro: ≤5, as que mais combinam, só da empresa", async () => {
    const r = await listar("produtos", "ativo=todos&sugestoes=1&q=produto 1");
    expect(r.json.sugestoes.length).toBeLessThanOrEqual(5);
    expect(r.json.sugestoes[0].rotulo).toBe("Produto 10");
    const f = await listar("fornecedores", "ativo=todos&sugestoes=1&q=frigelar");
    expect(f.json.sugestoes).toEqual([{ id: "f1", rotulo: "Frigelar Distribuidora", detalhe: "11222333000181" }]);
    expect((await listar("produtos", "sugestoes=1&q=")).json.sugestoes).toEqual([]);
  });

  it("empresa da sessão: a outra empresa nunca aparece (lista, total, sugestões)", async () => {
    logar(permissoesTotais(), "e2");
    const r = await listar("produtos", "ativo=todos&por=100");
    expect(r.json.total).toBe(5);
    expect(r.json.itens.every((i: any) => i.empresaId === "e2")).toBe(true);
    expect((await listar("fornecedores", "sugestoes=1&q=frigelar")).json.sugestoes.map((s: any) => s.id)).toEqual(["fB"]);
  });

  it("permissão: sem poder listar → 403 (também nas sugestões); sem sessão → 401", async () => {
    logar({ ...permissoesVazias() });
    expect((await listar("fornecedores", "por=25")).status).toBe(403);
    expect((await listar("fornecedores", "sugestoes=1&q=fri")).status).toBe(403);
    sessao.atual = null;
    expect((await listar("produtos", "por=25")).status).toBe(401);
  });
});

// ═════════════════════════ Sugestões das listas do servidor ═════════════════════════
describe("/api/listas/sugestoes", () => {
  it("clientes: ≤5, link do registro; CNPJ digitado só com números acha o mascarado", async () => {
    const r = await sugestoes("lista=clientes&q=cliente 0");
    expect(r.status).toBe(200);
    expect(r.json.sugestoes).toHaveLength(5);
    expect(r.json.sugestoes[0]).toMatchObject({ id: "c01", rotulo: "Cliente 01", href: "/clientes/c01/editar" });
    const doc = await sugestoes("lista=clientes&q=11222305");
    expect(doc.json.sugestoes.map((s: any) => s.id)).toEqual(["c06"]);
  });

  it("OS: busca pelo número, só da empresa da sessão", async () => {
    const r = await sugestoes("lista=ordens&q=OS-000");
    expect(r.json.sugestoes).toHaveLength(5);
    expect(r.json.sugestoes.every((s: any) => s.href.startsWith("/ordens/os"))).toBe(true);
    logar(permissoesTotais(), "e2");
    expect((await sugestoes("lista=ordens&q=OS-")).json.sugestoes.map((s: any) => s.id).sort()).toEqual(["osB1", "osB2", "osB3"]);
  });

  it("menos de 2 letras = nada; lista inexistente = 404; sem o módulo = 403; sem sessão = 401", async () => {
    expect((await sugestoes("lista=clientes&q=c")).json.sugestoes).toEqual([]);
    expect((await sugestoes("lista=usuarios&q=ana")).status).toBe(404);
    logar({ ...permissoesVazias(), ordens: { visualizar: true } });
    expect((await sugestoes("lista=clientes&q=cli")).status).toBe(403);
    expect((await sugestoes("lista=ordens&q=OS")).status).toBe(200);
    sessao.atual = null;
    expect((await sugestoes("lista=clientes&q=cli")).status).toBe(401);
  });
});

// ═════════════════════════ Páginas do servidor ═════════════════════════
const html = async (pagina: () => Promise<any>, qs: string) => {
  url.atual = qs;
  const { default: P } = await pagina();
  return renderToStaticMarkup(await P({ searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(qs))) }));
};
const linhasDe = (h: string, attr: string) => [...h.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].map((m) => m[1]);

describe("listas renderizadas no servidor", () => {
  it("Clientes: página 2 de 25, total certo, ordenação, cartões no celular e busca ao vivo (sem formulário)", async () => {
    const h = await html(() => import("@/app/(dashboard)/clientes/page"), "pagina=2&por=25");
    expect(h).toContain("Mostrando <span class=\"font-medium text-ink\">26–50</span> de <span class=\"font-medium text-ink\">60</span> clientes");
    expect(linhasDe(h, "data-cartao")).toEqual(Array.from({ length: 25 }, (_, i) => `c${doisDig(i + 26)}`));
    expect(h).not.toContain("<form");
    expect(h).toContain("data-busca");
    const d = await html(() => import("@/app/(dashboard)/clientes/page"), "por=25&ordem=nome&dir=desc");
    expect(linhasDe(d, "data-cartao")[0]).toBe("c60");
    expect(d).toContain('aria-sort="descending"');
  });

  it("Clientes: busca pelo CNPJ só com números; estado vazio claro; empresa da sessão", async () => {
    const h = await html(() => import("@/app/(dashboard)/clientes/page"), "busca=11222330");
    expect(linhasDe(h, "data-cartao")).toEqual(["c31"]);
    const v = await html(() => import("@/app/(dashboard)/clientes/page"), "busca=zzz");
    expect(v).toContain("Nenhum cliente encontrado");
    expect(v).toContain("Nada combina com “zzz”");
    logar(permissoesTotais(), "e2");
    expect(linhasDe(await html(() => import("@/app/(dashboard)/clientes/page"), ""), "data-cartao")).toEqual(["cB"]);
  });

  it("Orçamentos: 130 orçamentos = 3 páginas de 50 (antes cortava em 100)", async () => {
    const h = await html(() => import("@/app/(dashboard)/orcamentos/page"), "pagina=3");
    expect(h).toContain("101–130");
    expect(linhasDe(h, "data-cartao")).toHaveLength(30);
    const v = await html(() => import("@/app/(dashboard)/orcamentos/page"), "ordem=valor&dir=desc&por=25");
    expect(linhasDe(v, "data-cartao")[0]).toBe("or130");
  });

  it("OS: paginada (página 3 mostra 101–130); empresa da sessão", async () => {
    const h = await html(() => import("@/app/(dashboard)/ordens/page"), "pagina=3");
    expect(h).toContain("101–130");
    // As OS da página 3 (as mais antigas), não as 100 primeiras
    expect(h).toContain("OS-0130");
    expect(h).toContain("OS-0101");
    expect(h).not.toContain("OS-0100");
    expect(h).not.toContain("OS-0001");
    expect(h).toContain("data-pagina=\"3\"");
    logar(permissoesTotais(), "e2");
    const b = await html(() => import("@/app/(dashboard)/ordens/page"), "");
    expect(b).toContain("1–3");
  });

  it("Contratos: paginado (antes cortava em 200; agora 25/50/100)", async () => {
    const h = await html(() => import("@/app/(dashboard)/contratos/page"), "pagina=2&por=100");
    expect(h).toContain("101–130");
    expect(linhasDe(h, "data-cartao")).toHaveLength(30);
  });

  it("Equipes: busca e paginação no servidor; inativa fora por padrão", async () => {
    const h = await html(() => import("@/app/(dashboard)/equipes/page"), "por=25&pagina=2");
    expect(h).toContain("26–29");
    const b = await html(() => import("@/app/(dashboard)/equipes/page"), "q=equipe 1");
    expect([...b.matchAll(/data-card-id="([^"]+)"/g)].map((m) => m[1])).toEqual(Array.from({ length: 10 }, (_, i) => `eq${10 + i}`));
    const v = await html(() => import("@/app/(dashboard)/equipes/page"), "q=nada");
    expect(v).toContain("Nenhuma equipe encontrada");
    expect(naoGravou()).toBe(true);
  });
});
