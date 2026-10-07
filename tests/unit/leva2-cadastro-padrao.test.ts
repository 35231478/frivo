/**
 * Leva 2 — padrão único de cadastro (lib/cadastros). Rotas reais, banco em memória com DUAS empresas.
 * Prova, para produtos, serviços, cargos e categorias financeiras:
 *  - criar / editar / inativar / reativar respeitando empresa e permissão (por ação);
 *  - reativar e editar são PARCIAIS (nada que não veio é zerado);
 *  - o schema RECUSA campo desconhecido (empresaId pelo corpo = 400);
 *  - lista com ?ativo=sim|nao|todos e busca; as rotas antigas usam a mesma implementação;
 *  - impacto ("em uso: 2 orçamentos, 1 medição…") e ações em massa com a mesma regra;
 *  - SeletorCadastro: inativo não é oferecido para nova escolha, mas o valor atual inativo aparece;
 *  - servidor: escolha NOVA de cadastro inativo é recusada; manter o valor antigo é aceito.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais, permissoesVazias, PRESETS, type Permissoes } from "@/lib/permissoes";
import type { Banco, Linha } from "./helpers/banco-memoria";
import { opcoesCadastro } from "@/lib/cadastros/opcoes";
import { CADASTROS, type EntidadeCadastro as EntidadeQualquer } from "@/lib/cadastros/registro";

/** Os 4 cadastros simples da Leva 2 (perfis, modelos e usuários têm testes próprios — Leva 4) */
const ENTIDADES_CADASTRO = ["produtos", "servicos", "cargos", "categorias-financeiras"] as const;
type EntidadeCadastro = Extract<EntidadeQualquer, (typeof ENTIDADES_CADASTRO)[number]>;

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  const filhos = (m: string, chave: string) => (r: Linha, T: (m: string) => Linha[]) => T(m).filter((x) => x[chave] === r.id);
  return {
    prisma: criarPrisma(db, {
      orcamento: (r, T) => ({ produtos: filhos("orcamentoProduto", "orcamentoId")(r, T), servicos: filhos("orcamentoServico", "orcamentoId")(r, T) }),
      medicao: (r, T) => ({ itens: filhos("medicaoItem", "medicaoId")(r, T) }),
      pedidoCompraInterno: (r, T) => ({ itens: filhos("pedidoCompraItem", "pedidoId")(r, T) }),
      tabelaPreco: (r, T) => ({ itens: filhos("tabelaPrecoItem", "tabelaId")(r, T) }),
    }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Ana", email: "ana@x.com", empresaId, role: "OPERADOR", permissoes } };
};
const deslogar = () => { sessao.atual = null; };

/** Um registro de cada cadastro por empresa, com TODOS os campos preenchidos (para provar que nada é zerado). */
const CHEIO: Record<EntidadeCadastro, Linha> = {
  produtos: { nome: "Gás R410A", descricao: "Cilindro 11kg", unidade: "kg", valorPadrao: 150, estoqueMinimo: 5 },
  servicos: { nome: "Manutenção preventiva", descricao: "Mensal", unidade: "un", valorPadrao: 300, codigoMunicipal: "1401", codigoLc116: "14.01", aliquotaISS: 5, aliquotaPIS: 0.65, aliquotaCOFINS: 3, aliquotaCSLL: 1, aliquotaIR: 1.5, observacaoFiscal: "Retém ISS" },
  cargos: { nome: "Técnico de refrigeração", descricao: "Executa preventivas" },
  "categorias-financeiras": { nome: "Contrato mensal", cor: "#16A34A" },
};
const MODELO = Object.fromEntries(ENTIDADES_CADASTRO.map((e) => [e, CADASTROS[e].modelo])) as Record<EntidadeCadastro, string>;

function semear() {
  db.escritas = [];
  db.t = {};
  for (const e of ENTIDADES_CADASTRO) {
    db.t[MODELO[e]] = [
      { id: `${e}-A`, empresaId: "e1", ativo: true, ...CHEIO[e] },
      { id: `${e}-I`, empresaId: "e1", ativo: false, ...CHEIO[e], nome: `${CHEIO[e].nome} antigo` },
      { id: `${e}-B`, empresaId: "e2", ativo: true, ...CHEIO[e], nome: `${CHEIO[e].nome} da outra` },
    ];
  }
  // Usos (impacto)
  db.t.orcamento = [{ id: "o1", empresaId: "e1" }, { id: "o2", empresaId: "e1" }, { id: "oB", empresaId: "e2" }];
  db.t.orcamentoProduto = [{ id: "op1", orcamentoId: "o1", produtoId: "produtos-A" }, { id: "op2", orcamentoId: "o2", produtoId: "produtos-A" }, { id: "op3", orcamentoId: "o2", produtoId: "produtos-A" }];
  db.t.orcamentoServico = [{ id: "os1", orcamentoId: "o1", servicoId: "servicos-A" }];
  db.t.medicao = [{ id: "m1", empresaId: "e1" }];
  db.t.medicaoItem = [{ id: "mi1", medicaoId: "m1", produtoId: "produtos-A", servicoId: null }];
  db.t.pedidoCompraInterno = [{ id: "pc1", empresaId: "e1" }];
  db.t.pedidoCompraItem = [{ id: "pci1", pedidoId: "pc1", produtoId: "produtos-A" }];
  db.t.tabelaPreco = [];
  db.t.tabelaPrecoItem = [];
  db.t.contrato = [{ id: "c1", empresaId: "e1", servicosNFSeIds: ["servicos-A"] }, { id: "c2", empresaId: "e1", servicosNFSeIds: ["servicos-A", "x"] }];
  db.t.tecnico = [
    { id: "t1", empresaId: "e1", nome: "Ana", ativo: true, cargoId: "cargos-A" },
    { id: "t2", empresaId: "e1", nome: "Bia", ativo: true, cargoId: "cargos-A" },
    { id: "t3", empresaId: "e1", nome: "Caio", ativo: false, cargoId: "cargos-A" }, // inativo não conta
    { id: "tI", empresaId: "e1", nome: "Duda", ativo: true, cargoId: "cargos-I", cpf: "11111111111" }, // usa cargo INATIVO
  ];
  db.t.contaReceber = [
    { id: "cr1", empresaId: "e1", categoria: "Contrato mensal" }, { id: "cr2", empresaId: "e1", categoria: "Contrato mensal" },
    { id: "crI", empresaId: "e1", categoria: "Contrato mensal antigo", descricao: "Antiga", valor: 10, status: "A_RECEBER" },
    { id: "crB", empresaId: "e2", categoria: "Contrato mensal" },
  ];
}

beforeEach(() => { semear(); logar(); });

async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await carregar();
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const colecao = () => import("@/app/api/cadastros/[entidade]/route");
const item = () => import("@/app/api/cadastros/[entidade]/[id]/route");
const impacto = () => import("@/app/api/cadastros/[entidade]/[id]/impacto/route");
const linha = (e: EntidadeCadastro, id: string) => db.t[MODELO[e]].find((r) => r.id === id)!;
const criou = (e: EntidadeCadastro) => db.escritas.some((x) => x.startsWith(`${MODELO[e]}.create`));
const NOVO: Record<EntidadeCadastro, Linha> = {
  produtos: { nome: "Fita aluminizada", unidade: "un", valorPadrao: "12,5", estoqueMinimo: "" },
  servicos: { nome: "Limpeza de dutos", valorPadrao: "800", aliquotaISS: "" },
  cargos: { nome: "Ajudante" },
  "categorias-financeiras": { nome: "Serviço avulso", cor: "#2563EB" },
};

// ─────────────────────────────────────────────
describe.each(ENTIDADES_CADASTRO)("cadastro padronizado: %s", (e) => {
  it("criar: grava na empresa da sessão, ativo, com os padrões; numérico vazio vira null", async () => {
    const r = await chamar(colecao, "POST", { entidade: e }, NOVO[e]);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ empresaId: "e1", ativo: true, nome: NOVO[e].nome });
    if (e === "produtos") expect(r.json).toMatchObject({ valorPadrao: 12.5, estoqueMinimo: null, descricao: null });
    if (e === "servicos") expect(r.json).toMatchObject({ valorPadrao: 800, aliquotaISS: null, unidade: "un" });
    if (e === "categorias-financeiras") expect(r.json.cor).toBe("#2563EB");
  });

  it("editar é parcial: só o nome muda, o resto fica igual", async () => {
    const antes = { ...linha(e, `${e}-A`) };
    const r = await chamar(item, "PATCH", { entidade: e, id: `${e}-A` }, { nome: "Renomeado" });
    expect(r.status).toBe(200);
    expect(linha(e, `${e}-A`)).toEqual({ ...antes, nome: "Renomeado" });
  });

  it("inativar (DELETE) nunca apaga; reativar (PATCH {ativo:true}) não zera nenhum campo", async () => {
    const antes = { ...linha(e, `${e}-A`) };
    expect((await chamar(item, "DELETE", { entidade: e, id: `${e}-A` })).status).toBe(200);
    expect(linha(e, `${e}-A`)).toEqual({ ...antes, ativo: false });
    expect(db.escritas.some((x) => x.includes("delete"))).toBe(false);
    const r = await chamar(item, "PATCH", { entidade: e, id: `${e}-A` }, { ativo: true });
    expect(r.status).toBe(200);
    expect(linha(e, `${e}-A`)).toEqual(antes);
  });

  it("schema recusa campo desconhecido: empresaId pelo corpo = 400 e nada muda", async () => {
    const c = await chamar(colecao, "POST", { entidade: e }, { ...NOVO[e], empresaId: "e2" });
    expect(c.status).toBe(400);
    expect(c.json.erro).toBe("Campo não permitido: empresaId.");
    expect(criou(e)).toBe(false);
    const antes = { ...linha(e, `${e}-A`) };
    const p = await chamar(item, "PATCH", { entidade: e, id: `${e}-A` }, { nome: "X", empresaId: "e2" });
    expect(p.status).toBe(400);
    expect(linha(e, `${e}-A`)).toEqual(antes);
    expect((await chamar(item, "PATCH", { entidade: e, id: `${e}-A` }, { qualquerCoisa: 1 })).status).toBe(400);
  });

  it("empresa: não lê, não edita, não inativa nem vê impacto de registro de outra empresa (404)", async () => {
    const lista = await chamar(colecao, "GET", { entidade: e }, undefined, "http://localhost/api/x?ativo=todos");
    expect(lista.json.map((r: Linha) => r.id).sort()).toEqual([`${e}-A`, `${e}-I`]);
    expect((await chamar(item, "GET", { entidade: e, id: `${e}-B` })).status).toBe(404);
    expect((await chamar(item, "PATCH", { entidade: e, id: `${e}-B` }, { nome: "x" })).status).toBe(404);
    expect((await chamar(item, "DELETE", { entidade: e, id: `${e}-B` })).status).toBe(404);
    expect((await chamar(impacto, "GET", { entidade: e, id: `${e}-B` })).status).toBe(404);
    expect(linha(e, `${e}-B`)).toMatchObject({ ativo: true, nome: `${CHEIO[e].nome} da outra` });
  });

  it("permissão por ação: sem Configurações › gerenciar só lê; sem login nada", async () => {
    logar(PRESETS.AUXILIAR);
    expect((await chamar(colecao, "GET", { entidade: e })).status).toBe(200); // catálogo: qualquer logado
    expect((await chamar(colecao, "POST", { entidade: e }, NOVO[e])).status).toBe(403);
    expect((await chamar(item, "PATCH", { entidade: e, id: `${e}-A` }, { nome: "x" })).status).toBe(403);
    expect((await chamar(item, "PATCH", { entidade: e, id: `${e}-I` }, { ativo: true })).status).toBe(403);
    expect((await chamar(item, "DELETE", { entidade: e, id: `${e}-A` })).status).toBe(403);
    expect((await chamar(impacto, "GET", { entidade: e, id: `${e}-A` })).status).toBe(403);
    expect(db.escritas).toEqual([]);
    deslogar();
    expect((await chamar(colecao, "GET", { entidade: e })).status).toBe(401);
  });

  it("lista: ?ativo=sim (padrão) | nao | todos, e busca", async () => {
    const ids = async (qs: string) => (await chamar(colecao, "GET", { entidade: e }, undefined, `http://localhost/api/x?${qs}`)).json.map((r: Linha) => r.id);
    expect(await ids("")).toEqual([`${e}-A`]);
    expect(await ids("ativo=nao")).toEqual([`${e}-I`]);
    expect((await ids("ativo=todos")).sort()).toEqual([`${e}-A`, `${e}-I`]);
    expect(await ids(`ativo=todos&q=${encodeURIComponent("antigo")}`)).toEqual([`${e}-I`]);
  });
});

// ─────────────────────────────────────────────
describe("rotas antigas usam a mesma implementação", () => {
  it("PUT /api/produtos/[id] { ativo: true } reativa sem zerar; GET devolve ativos e inativos (como antes)", async () => {
    const antigo = () => import("@/app/api/produtos/[id]/route");
    const antes = { ...linha("produtos", "produtos-I") };
    expect((await chamar(antigo, "PUT", { id: "produtos-I" }, { ativo: true })).status).toBe(200);
    expect(linha("produtos", "produtos-I")).toEqual({ ...antes, ativo: true });
    const lista = await chamar(() => import("@/app/api/cargos/route"), "GET", {});
    expect(lista.json.map((r: Linha) => r.id).sort()).toEqual(["cargos-A", "cargos-I"]);
  });
  it("POST /api/servicos com empresaId é recusado", async () => {
    expect((await chamar(() => import("@/app/api/servicos/route"), "POST", {}, { nome: "x", empresaId: "e2" })).status).toBe(400);
  });
  it("entidade inexistente na rota genérica: 404", async () => {
    expect((await chamar(colecao, "GET", { entidade: "nao-existe" })).status).toBe(404);
  });
});

// ─────────────────────────────────────────────
describe("impacto antes de inativar", () => {
  const ver = async (e: EntidadeCadastro, id = `${e}-A`) => (await chamar(impacto, "GET", { entidade: e, id })).json;
  it("produto: conta orçamentos (não itens), medições e pedidos — só da empresa", async () => {
    const r = await ver("produtos");
    expect(r.usos).toEqual([
      { rotulo: "2 orçamentos", total: 2 }, { rotulo: "1 medição", total: 1 }, { rotulo: "1 pedido de compra", total: 1 },
    ]);
    expect(r.avisos[0]).toBe("Em uso: 2 orçamentos, 1 medição e 1 pedido de compra.");
    expect(r.bloqueio).toBeNull();
  });
  it("serviço: inclui contratos que o usam na NFS-e", async () => {
    expect((await ver("servicos")).avisos[0]).toBe("Em uso: 1 orçamento e 2 contratos (NFS-e).");
  });
  it("cargo: conta só colaboradores ativos", async () => {
    expect((await ver("cargos")).avisos[0]).toBe("Em uso: 2 colaboradores ativos.");
  });
  it("categoria: conta as contas a receber pelo NOME, só da empresa", async () => {
    expect((await ver("categorias-financeiras")).avisos[0]).toBe("Em uso: 2 contas a receber.");
  });
  it("sem uso: avisa que não está em uso", async () => {
    db.t.tecnico = [];
    expect((await ver("cargos")).avisos).toEqual(["Não está em uso em nenhum registro."]);
  });
});

// ─────────────────────────────────────────────
describe("ações em massa com a mesma regra", () => {
  const massa = async (corpo: unknown) => {
    const { POST } = await import("@/app/api/acoes-massa/route");
    const res = await POST(new NextRequest("http://localhost/api/acoes-massa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
    return { status: res.status, json: await res.json() };
  };
  it("inativa os da empresa; o de outra empresa vira 'não encontrado'; reativar não zera nada", async () => {
    const antes = { ...linha("produtos", "produtos-A") };
    const r = await massa({ entidade: "produtos", acao: "inativar", ids: ["produtos-A", "produtos-B"] });
    expect(r.json.resumo).toMatchObject({ feitas: 1, naoPuderam: 1 });
    expect(linha("produtos", "produtos-A").ativo).toBe(false);
    expect(r.json.resultados.find((x: Linha) => x.id === "produtos-B").codigo).toBe("nao_encontrado");
    expect(linha("produtos", "produtos-B").ativo).toBe(true);
    await massa({ entidade: "produtos", acao: "reativar", ids: ["produtos-A"] });
    expect(linha("produtos", "produtos-A")).toEqual(antes);
  });
  it("sem permissão: 403 sem tocar no banco", async () => {
    logar(PRESETS.AUXILIAR);
    expect((await massa({ entidade: "cargos", acao: "inativar", ids: ["cargos-A"] })).status).toBe(403);
    expect(linha("cargos", "cargos-A").ativo).toBe(true);
  });
  it("'todos do filtro' usa a aba e a busca da URL da tela", async () => {
    const r = await massa({ entidade: "servicos", acao: "ids-do-filtro", filtro: "aba=inativos" });
    expect(r.json.ids).toEqual(["servicos-I"]);
  });
});

// ─────────────────────────────────────────────
describe("SeletorCadastro: inativo não é oferecido, mas o valor atual inativo continua visível", () => {
  const cargos = [
    { id: "a", nome: "Técnico", ativo: true }, { id: "b", nome: "Supervisor", ativo: true },
    { id: "z", nome: "Encarregado", ativo: false },
  ];
  it("nova escolha (sem valor atual): só ativos", () => {
    expect(opcoesCadastro(cargos, [""]).map((o) => o.rotulo)).toEqual(["Técnico", "Supervisor"]);
  });
  it("registro antigo com cargo inativo: o cargo atual aparece marcado e os outros inativos não", () => {
    const ops = opcoesCadastro([...cargos, { id: "y", nome: "Outro inativo", ativo: false }], ["z"]);
    expect(ops.map((o) => o.rotulo)).toEqual(["Técnico", "Supervisor", "Encarregado (inativo)"]);
    expect(ops.find((o) => o.valor === "z")).toMatchObject({ inativo: true });
  });
  it("categoria (por nome): nome antigo que nem existe mais aparece como '(não cadastrada)'", () => {
    const cats = [{ id: "1", nome: "Contrato", ativo: true }];
    expect(opcoesCadastro(cats, ["Avulso 2019"], "nome").map((o) => o.rotulo)).toEqual(["Contrato", "Avulso 2019 (não cadastrada)"]);
  });
  it("componente: renderiza o valor inativo selecionado e não oferece os outros inativos", async () => {
    const { SeletorCadastro } = await import("@/components/cadastros/seletor-cadastro");
    const html = (valor: string) => renderToStaticMarkup(createElement(SeletorCadastro, { entidade: "cargos", itens: cargos, valor, onChange: () => {} }));
    const antigo = html("z");
    expect(antigo).toContain("Encarregado (inativo)");
    expect(antigo).toMatch(/<option value="z"[^>]*selected/);
    const novo = html("");
    expect(novo).not.toContain("Encarregado");
    expect(novo).toContain("Técnico");
  });
});

// ─────────────────────────────────────────────
describe("servidor: escolha NOVA de cadastro inativo é recusada; manter o valor antigo é aceito", () => {
  const colab = (extra: Linha) => ({ nome: "Duda Lima", cpf: "11111111111", telefone: "11999999999", ...extra });
  it("colaborador: trocar para cargo inativo = 400; manter o cargo inativo que já tinha = 200", async () => {
    const tecnico = () => import("@/app/api/tecnicos/[id]/route");
    const novo = await chamar(tecnico, "PUT", { id: "t1" }, colab({ cpf: "22222222222", cargoId: "cargos-I" }));
    expect(novo.status).toBe(400);
    expect(novo.json.erro).toBe("Cargo inativo(a): escolha um(a) ativo(a).");
    expect((await chamar(tecnico, "PUT", { id: "tI" }, colab({ cargoId: "cargos-I" }))).status).toBe(200);
    expect((await chamar(() => import("@/app/api/tecnicos/route"), "POST", {}, colab({ cpf: "33333333333", cargoId: "cargos-I" }))).status).toBe(400);
  });
  it("conta a receber: categoria nova inativa = 400; manter a inativa que já tinha = 200; de outra empresa = 400", async () => {
    const conta = () => import("@/app/api/contas-receber/[id]/route");
    expect((await chamar(conta, "PUT", { id: "cr1" }, { categoria: "Contrato mensal antigo" })).json.erro).toBe("Categoria inválida ou inativa.");
    expect((await chamar(conta, "PUT", { id: "crI" }, { categoria: "Contrato mensal antigo", descricao: "Antiga 2" })).status).toBe(200);
    expect((await chamar(conta, "PUT", { id: "cr1" }, { categoria: "Contrato mensal da outra" })).status).toBe(400);
  });
  it("pedido de compra: produto inativo ou de outra empresa = 400", async () => {
    const pedidos = () => import("@/app/api/pedidos-compra/route");
    const item = (produtoId: string) => ({ itens: [{ produtoId, descricao: "x", quantidade: 1, unidade: "un" }] });
    expect((await chamar(pedidos, "POST", {}, item("produtos-I"))).json.erro).toBe("Produto inativo(a): escolha um(a) ativo(a).");
    expect((await chamar(pedidos, "POST", {}, item("produtos-B"))).json.erro).toBe("Produto inválido(a).");
  });
  it("medição: serviço/produto de outra empresa = 400", async () => {
    db.t.cliente = [{ id: "cl1", empresaId: "e1", nome: "Cliente" }];
    const medicoes = () => import("@/app/api/medicoes/route");
    const r = await chamar(medicoes, "POST", {}, { clienteId: "cl1", itens: [{ tipo: "SERVICO", servicoId: "servicos-B", descricao: "x", quantidade: 1, valorUnitario: 10 }] });
    expect(r.json.erro).toBe("Serviço inválido(a).");
  });
});

it("sem permissões nenhuma, o usuário logado ainda lê o catálogo (seletores de outras telas)", async () => {
  logar(permissoesVazias());
  expect((await chamar(colecao, "GET", { entidade: "produtos" })).status).toBe(200);
});
