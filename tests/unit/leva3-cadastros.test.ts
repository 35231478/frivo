/**
 * Leva 3 — tipos de equipamento, tabelas de preço, termos de referência e modelos de prazo no
 * cadastro padronizado. Rotas reais, banco em memória (duas empresas). Prova:
 *  - criar/editar/inativar/reativar cada um, com empresa da sessão e permissão antes de gravar;
 *  - edição parcial e reativar nunca zeram nada (itens da tabela, etapas do prazo, descrição);
 *  - nada de exclusão física; rotas antigas delegam para a mesma implementação;
 *  - seletores: mantêm o valor inativo já gravado, não o oferecem em escolha nova (tela e servidor);
 *  - tipo de equipamento “Remover” agora inativa de verdade; equipamento com tipo inativo edita;
 *  - cliente com tabela inativa volta para a Padrão (preço) e o seletor mostra a tabela real;
 *  - modelo de prazo inativo é recusado em prazo novo na OS; o prazo já aberto continua;
 *  - impacto correto antes de inativar.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PRESETS, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  return {
    prisma: criarPrisma(db, {
      tipoEquipamentoCustom: (r, T) => ({ _count: {
        equipamentos: T("equipamento").filter((e) => e.tipoEquipamentoId === r.id).length,
        formTypeMappings: T("formTypeMapping").filter((f) => f.tipoEquipamentoId === r.id).length,
      } }),
      tabelaPreco: (r, T) => ({
        _count: { itens: T("tabelaPrecoItem").filter((i) => i.tabelaId === r.id).length, clientes: T("cliente").filter((c) => c.tabelaPrecoId === r.id).length },
        itens: T("tabelaPrecoItem").filter((i) => i.tabelaId === r.id).map((i) => ({
          ...i, servico: T("servico").find((s) => s.id === i.servicoId) ?? null, produto: T("produto").find((p) => p.id === i.produtoId) ?? null,
        })),
      }),
      prazoTemplate: (r, T) => ({
        etapas: T("prazoEtapaTemplate").filter((e) => e.templateId === r.id).sort((a, b) => a.ordem - b.ordem),
        _count: { osPrazos: T("osPrazo").filter((p) => p.templateId === r.id).length },
      }),
      osPrazo: (r, T) => ({
        etapas: T("osPrazoEtapa").filter((e) => e.osPrazoId === r.id),
        template: T("prazoTemplate").find((t) => t.id === r.templateId) ?? null,
        ordemServico: T("ordemServico").find((o) => o.id === r.ordemServicoId) ?? null,
      }),
    }, {
      tabelaPreco: { itens: ["tabelaPrecoItem", "tabelaId"] },
      prazoTemplate: { etapas: ["prazoEtapaTemplate", "templateId"] },
      osPrazo: { etapas: ["osPrazoEtapa", "osPrazoId"] },
    }),
  };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));

const logar = (id: string, role = "OPERADOR", permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id, name: id, email: `${id}@x.com`, empresaId, role, permissoes } };
};

function semear() {
  db.escritas = [];
  db.t = {
    tipoEquipamentoCustom: [
      { id: "te-split", empresaId: "e1", nome: "Split", descricao: null, chaveEnum: "AR_CONDICIONADO_SPLIT", ativo: true },
      { id: "te-chiller", empresaId: "e1", nome: "Chiller", descricao: null, chaveEnum: "CHILLER", ativo: false },
      { id: "te-cortina", empresaId: "e1", nome: "Cortina de ar", descricao: "Porta da loja", chaveEnum: null, ativo: true },
      { id: "te-velho", empresaId: "e1", nome: "Bebedouro", descricao: "Modelo antigo", chaveEnum: null, ativo: false },
      { id: "teB", empresaId: "e2", nome: "Da outra", descricao: null, chaveEnum: null, ativo: true },
    ],
    unidade: [{ id: "u1", empresaId: "e1", nome: "Matriz" }],
    equipamento: [
      { id: "eq1", empresaId: "e1", unidadeId: "u1", tipo: "OUTRO", tipoEquipamentoId: "te-velho", marca: "Libell", modelo: "B1", ativo: true },
      { id: "eq2", empresaId: "e1", unidadeId: "u1", tipo: "CHILLER", tipoEquipamentoId: "te-chiller", marca: "Carrier", modelo: "30XA", ativo: true },
    ],
    formTypeMapping: [{ id: "fm1", tipoEquipamentoId: "te-cortina", formularioTemplateId: "f1", tipoOsId: "o1" }],
    servico: [
      { id: "s1", empresaId: "e1", nome: "Limpeza", valorPadrao: 100, ativo: true },
      { id: "s-velho", empresaId: "e1", nome: "Carga de gás R22", valorPadrao: 50, ativo: false },
      { id: "sB", empresaId: "e2", nome: "Da outra", valorPadrao: 1, ativo: true },
    ],
    produto: [{ id: "pr1", empresaId: "e1", nome: "Filtro", valorPadrao: 20, ativo: true }],
    tabelaPreco: [
      { id: "tp-padrao", empresaId: "e1", nome: "Padrão", descricao: null, tipo: "PADRAO", precosBloqueados: false, ativo: true, criadoEm: new Date(2020, 0, 1) },
      { id: "tp-contrato", empresaId: "e1", nome: "Contrato Belma", descricao: "Preços do contrato", tipo: "CONTRATO", precosBloqueados: true, ativo: true },
      { id: "tp-velha", empresaId: "e1", nome: "Tabela 2023", descricao: "Antiga", tipo: "PERSONALIZADA", precosBloqueados: false, ativo: false },
      { id: "tpB", empresaId: "e2", nome: "Da outra", descricao: null, tipo: "PADRAO", precosBloqueados: false, ativo: true },
    ],
    tabelaPrecoItem: [
      { id: "it1", tabelaId: "tp-contrato", servicoId: "s-velho", produtoId: null, tipoPreco: "VALOR_FIXO", valorFixo: 40, descontoPercent: null, valorFinal: 40, bloqueado: true },
      { id: "it2", tabelaId: "tp-padrao", servicoId: "s1", produtoId: null, tipoPreco: "VALOR_FIXO", valorFixo: 90, descontoPercent: null, valorFinal: 90, bloqueado: false },
      { id: "it3", tabelaId: "tp-velha", servicoId: "s1", produtoId: null, tipoPreco: "VALOR_FIXO", valorFixo: 70, descontoPercent: null, valorFinal: 70, bloqueado: false },
    ],
    cliente: [
      { id: "c1", empresaId: "e1", nome: "Cliente Velho", tipoPessoa: "JURIDICA", cpfCnpj: "12345678000199", tabelaPrecoId: "tp-velha", ativo: true },
      { id: "c2", empresaId: "e1", nome: "Belma", tipoPessoa: "JURIDICA", cpfCnpj: "98765432000188", tabelaPrecoId: "tp-contrato", ativo: true },
      { id: "c3", empresaId: "e1", nome: "Sem tabela", tipoPessoa: "JURIDICA", cpfCnpj: "11222333000144", tabelaPrecoId: null, ativo: true },
    ],
    termoReferenciaTemplate: [
      { id: "tr1", empresaId: "e1", nome: "Contrato anual", descricao: "PMOC", conteudo: "A CONTRATADA atende {{cliente_nome}}.", ativo: true },
      { id: "tr-velho", empresaId: "e1", nome: "Termo 2019", descricao: null, conteudo: "Texto antigo", ativo: false },
    ],
    prazoTemplate: [
      { id: "pz1", empresaId: "e1", nome: "Compra de material", descricao: null, cor: "#0EA5E9", ativo: true },
      { id: "pz-velho", empresaId: "e1", nome: "SLA antigo", descricao: "Contrato 2019", cor: "#F59E0B", ativo: false },
      { id: "pzB", empresaId: "e2", nome: "Da outra", descricao: null, cor: "#000000", ativo: true },
    ],
    prazoEtapaTemplate: [
      { id: "et1", templateId: "pz1", nome: "Cotar", prazoHoras: 24, responsavel: "COMPRADOR", canal: "WHATSAPP", mensagem: null, ordem: 0 },
      { id: "et2", templateId: "pz1", nome: "Comprar", prazoHoras: 48, responsavel: "COMPRADOR", canal: "WHATSAPP", mensagem: null, ordem: 1 },
      { id: "et3", templateId: "pz-velho", nome: "Atender", prazoHoras: 4, responsavel: "TECNICO", canal: "SISTEMA", mensagem: null, ordem: 0 },
      { id: "etB", templateId: "pzB", nome: "X", prazoHoras: 1, responsavel: "GESTOR", canal: "EMAIL", mensagem: null, ordem: 0 },
    ],
    ordemServico: [{ id: "os1", empresaId: "e1" }, { id: "osB", empresaId: "e2" }],
    osPrazo: [{ id: "op1", ordemServicoId: "os1", templateId: "pz-velho", nome: "SLA antigo", status: "ATIVO", etapaAtual: 0, criadoEm: new Date() }],
    osPrazoEtapa: [],
  };
}
beforeEach(() => { semear(); logar("admin", "ADMIN"); });

async function chamar(carregar: () => Promise<any>, metodo: string, params: Record<string, string>, corpo?: unknown, url = "http://localhost/api/x") {
  const mod = await carregar();
  const req = new NextRequest(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const res: Response = await mod[metodo](req, { params: Promise.resolve(params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const col = () => import("@/app/api/cadastros/[entidade]/route");
const item = () => import("@/app/api/cadastros/[entidade]/[id]/route");
const impacto = () => import("@/app/api/cadastros/[entidade]/[id]/impacto/route");
const linha = (m: string, id: string) => db.t[m].find((r) => r.id === id)!;
/** Exclusão física de um cadastro (os itens/etapas trocados pela edição não contam). */
const apagou = (modelos: string[]) => db.escritas.some((e) => modelos.some((m) => e.startsWith(`${m}.delete`)));
const MODELOS = ["tipoEquipamentoCustom", "tabelaPreco", "termoReferenciaTemplate", "prazoTemplate"];
const listar = async (entidade: string, ativo = "sim") =>
  (await chamar(col, "GET", { entidade }, undefined, `http://localhost/api/cadastros/${entidade}?ativo=${ativo}`)).json as any[];
async function massa(entidade: string, acao: string, ids: string[]) {
  const { POST } = await import("@/app/api/acoes-massa/route");
  return (await POST(new NextRequest("http://localhost/api/acoes-massa", { method: "POST", body: JSON.stringify({ entidade, acao, ids }) }))).json();
}

/* Um caso por cadastro: corpo de criação, edição parcial e o campo que NÃO pode ser zerado. */
const CASOS = [
  { entidade: "tipos-equipamento", modelo: "tipoEquipamentoCustom", existente: "te-cortina", criar: { nome: "Bebedouro industrial", descricao: "Água gelada" }, preservado: (r: any) => r.descricao === "Porta da loja" },
  {
    entidade: "tabelas-preco", modelo: "tabelaPreco", existente: "tp-contrato",
    criar: { nome: "Tabela Shopping", tipo: "PERSONALIZADA", itens: [{ servicoId: "s1", tipoPreco: "DESCONTO_PERCENTUAL", descontoPercent: 10 }] },
    preservado: (r: any) => r.descricao === "Preços do contrato" && r.precosBloqueados === true && db.t.tabelaPrecoItem.some((i) => i.tabelaId === "tp-contrato" && i.valorFinal === 40),
  },
  { entidade: "termos-referencia", modelo: "termoReferenciaTemplate", existente: "tr1", criar: { nome: "Termo PMOC", conteudo: "Plano de manutenção de {{cliente_nome}}" }, preservado: (r: any) => r.conteudo === "A CONTRATADA atende {{cliente_nome}}." && r.descricao === "PMOC" },
  {
    entidade: "modelos-prazo", modelo: "prazoTemplate", existente: "pz1",
    criar: { nome: "Reparo urgente", etapas: [{ nome: "Atender", prazoHoras: 4, responsavel: "TECNICO", canal: "SISTEMA" }] },
    preservado: (r: any) => r.cor === "#0EA5E9" && db.t.prazoEtapaTemplate.filter((e) => e.templateId === "pz1").map((e) => e.nome).join() === "Cotar,Comprar",
  },
] as const;

// ═════════════════════════ CRUD comum aos quatro ═════════════════════════
describe.each(CASOS)("$entidade: criar / editar / inativar / reativar", ({ entidade, modelo, existente, criar, preservado }) => {
  const P = { entidade };

  it("cria na empresa da sessão, sempre ativo; campo desconhecido (empresaId) = 400", async () => {
    const r = await chamar(col, "POST", P, criar);
    expect(r.status).toBe(201);
    expect(linha(modelo, r.json.id)).toMatchObject({ empresaId: "e1", ativo: true, nome: criar.nome });
    const fura = await chamar(col, "POST", P, { ...criar, nome: "Outro nome", empresaId: "e2" });
    expect(fura.status).toBe(400);
    expect(db.t[modelo].some((x) => x.empresaId === "e2" && x.nome === "Outro nome")).toBe(false);
  });

  it("sem permissão (técnico) não grava nada: criar, editar, inativar e reativar = 403", async () => {
    logar("tec", "OPERADOR", PRESETS.TECNICO);
    const antes = db.escritas.length;
    expect((await chamar(col, "POST", P, criar)).status).toBe(403);
    expect((await chamar(item, "PATCH", { ...P, id: existente }, { nome: "Hackeado" })).status).toBe(403);
    expect((await chamar(item, "DELETE", { ...P, id: existente })).status).toBe(403);
    expect((await chamar(item, "PATCH", { ...P, id: existente }, { ativo: true })).status).toBe(403);
    expect(db.escritas.length).toBe(antes);
    expect(linha(modelo, existente).nome).not.toBe("Hackeado");
  });

  it("registro de outra empresa = 404 (e não muda)", async () => {
    logar("adminB", "ADMIN", permissoesTotais(), "e2");
    expect((await chamar(item, "PATCH", { ...P, id: existente }, { nome: "Invadido" })).status).toBe(404);
    expect((await chamar(item, "DELETE", { ...P, id: existente })).status).toBe(404);
    expect(linha(modelo, existente)).toMatchObject({ ativo: true });
    expect(linha(modelo, existente).nome).not.toBe("Invadido");
  });

  it("edição parcial: só o nome muda (o resto fica)", async () => {
    const r = await chamar(item, "PATCH", { ...P, id: existente }, { nome: "Nome novo" });
    expect(r.status).toBe(200);
    expect(linha(modelo, existente).nome).toBe("Nome novo");
    expect(preservado(linha(modelo, existente))).toBe(true);
  });

  it("inativar (nunca apaga) → some dos ativos, aparece nos inativos → reativar não zera nada", async () => {
    expect((await chamar(item, "DELETE", { ...P, id: existente })).status).toBe(200);
    expect(linha(modelo, existente).ativo).toBe(false);
    expect((await listar(entidade)).map((x) => x.id)).not.toContain(existente);
    expect((await listar(entidade, "nao")).map((x) => x.id)).toContain(existente);
    const r = await chamar(item, "PATCH", { ...P, id: existente }, { ativo: true });
    expect(r.status).toBe(200);
    expect(linha(modelo, existente).ativo).toBe(true);
    expect(preservado(linha(modelo, existente))).toBe(true);
    expect(apagou(MODELOS)).toBe(false);
  });

  it("ações em massa: inativa e reativa pela mesma regra", async () => {
    const m = await massa(entidade, "inativar", [existente]);
    expect(m.resultados[0]).toMatchObject({ ok: true });
    expect(linha(modelo, existente).ativo).toBe(false);
    expect((await massa(entidade, "reativar", [existente])).resultados[0]).toMatchObject({ ok: true });
    expect(linha(modelo, existente).ativo).toBe(true);
    expect(preservado(linha(modelo, existente))).toBe(true);
  });
});

// ═════════════════════════ Rotas antigas delegam ═════════════════════════
describe("rotas antigas: mesma implementação (DELETE inativa, PUT parcial, empresa da sessão)", () => {
  const ANTIGAS = [
    { col: () => import("@/app/api/tipos-equipamento/route"), item: () => import("@/app/api/tipos-equipamento/[id]/route"), id: "te-cortina", modelo: "tipoEquipamentoCustom" },
    { col: () => import("@/app/api/tabelas-preco/route"), item: () => import("@/app/api/tabelas-preco/[id]/route"), id: "tp-contrato", modelo: "tabelaPreco" },
    { col: () => import("@/app/api/termo-templates/route"), item: () => import("@/app/api/termo-templates/[id]/route"), id: "tr1", modelo: "termoReferenciaTemplate" },
    { col: () => import("@/app/api/prazo-templates/route"), item: () => import("@/app/api/prazo-templates/[id]/route"), id: "pz1", modelo: "prazoTemplate" },
  ];
  it.each(ANTIGAS)("$modelo: GET devolve todos (com o ativo), DELETE inativa, PUT reativa", async (a) => {
    expect((await chamar(a.item, "DELETE", { id: a.id })).status).toBe(200);
    expect(linha(a.modelo, a.id).ativo).toBe(false);
    const todos = (await chamar(a.col, "GET", {})).json as any[];
    expect(todos.find((x) => x.id === a.id)).toMatchObject({ ativo: false });
    expect(todos.every((x) => x.empresaId === "e1")).toBe(true);
    expect((await chamar(a.item, "PUT", { id: a.id }, { ativo: true })).status).toBe(200);
    expect(linha(a.modelo, a.id).ativo).toBe(true);
    expect(apagou(MODELOS)).toBe(false);
  });
});

// ═════════════════════════ Tipos de equipamento ═════════════════════════
describe("tipos de equipamento", () => {
  const P = { entidade: "tipos-equipamento" };

  it("“Remover” agora inativa de verdade: some da lista de ativos ao recarregar e tem Reativar", async () => {
    expect((await chamar(() => import("@/app/api/tipos-equipamento/[id]/route"), "DELETE", { id: "te-cortina" })).status).toBe(200);
    expect((await listar("tipos-equipamento")).map((t) => t.nome)).not.toContain("Cortina de ar");
    expect((await listar("tipos-equipamento", "nao")).map((t) => t.nome)).toContain("Cortina de ar");
    expect((await chamar(item, "PATCH", { ...P, id: "te-cortina" }, { ativo: true })).status).toBe(200);
    expect((await listar("tipos-equipamento")).map((t) => t.nome)).toContain("Cortina de ar");
  });

  it("nome repetido entre ativos = 409 (criar, renomear e reativar)", async () => {
    expect((await chamar(col, "POST", P, { nome: "cortina DE AR" })).status).toBe(409);
    expect((await chamar(item, "PATCH", { ...P, id: "te-split" }, { nome: "Cortina de ar" })).status).toBe(409);
    expect((await chamar(col, "POST", P, { nome: "Bebedouro" })).status).toBe(201); // o inativo não impede
    const r = await chamar(item, "PATCH", { ...P, id: "te-velho" }, { ativo: true });
    expect(r.status).toBe(409);
    expect(r.json.erro).toMatch(/Já existe outro tipo ativo/);
    expect(linha("tipoEquipamentoCustom", "te-velho").ativo).toBe(false);
  });

  it("chaveEnum (âncora do tipo padrão) não entra pelo corpo", async () => {
    expect((await chamar(item, "PATCH", { ...P, id: "te-cortina" }, { chaveEnum: "CHILLER" })).status).toBe(400);
    expect(linha("tipoEquipamentoCustom", "te-cortina").chaveEnum).toBeNull();
  });

  it("impacto: equipamentos ativos do tipo e formulários vinculados", async () => {
    const a = (await chamar(impacto, "GET", { ...P, id: "te-cortina" })).json;
    expect(a.bloqueio).toBeNull();
    expect(a.avisos.join(" ")).toMatch(/1 formulário está vinculado/);
    db.t.equipamento.push({ id: "eq3", empresaId: "e1", unidadeId: "u1", tipo: "OUTRO", tipoEquipamentoId: "te-cortina", ativo: true });
    const b = (await chamar(impacto, "GET", { ...P, id: "te-cortina" })).json;
    expect(b.usos).toEqual(expect.arrayContaining([{ rotulo: "1 equipamento ativo", total: 1 }]));
    expect(b.avisos.join(" ")).toMatch(/1 equipamento ativo é deste tipo/);
  });

  it("equipamento com tipo próprio inativo: edição mantém o tipo; equipamento NOVO com tipo inativo = 400", async () => {
    const equip = () => import("@/app/api/equipamentos/[id]/route");
    const base = { unidadeId: "u1", marca: "Libell", modelo: "B2" };
    const r = await chamar(equip, "PUT", { id: "eq1" }, { ...base, tipo: "OUTRO", tipoEquipamentoId: "te-velho" });
    expect(r.status).toBe(200);
    expect(linha("equipamento", "eq1")).toMatchObject({ tipoEquipamentoId: "te-velho", modelo: "B2" });
    // Trocar para OUTRO tipo inativo = escolha nova
    expect((await chamar(equip, "PUT", { id: "eq1" }, { ...base, tipo: "CHILLER" })).status).toBe(400);
    const novo = () => import("@/app/api/equipamentos/route");
    const n = await chamar(novo, "POST", {}, { ...base, tipo: "OUTRO", tipoEquipamentoId: "te-velho" });
    expect(n.status).toBe(400);
    expect(n.json.erro).toBe("Tipo de equipamento inativo: escolha um ativo.");
    expect((await chamar(novo, "POST", {}, { ...base, tipo: "CHILLER" })).status).toBe(400); // padrão inativado pela empresa
    expect((await chamar(novo, "POST", {}, { ...base, tipo: "OUTRO", tipoEquipamentoId: "teB" })).status).toBe(400); // de outra empresa
    expect((await chamar(novo, "POST", {}, { ...base, tipo: "OUTRO", tipoEquipamentoId: "te-cortina" })).status).toBe(201);
    // O chiller que já era CHILLER continua editável
    expect((await chamar(equip, "PUT", { id: "eq2" }, { ...base, tipo: "CHILLER" })).status).toBe(200);
  });

  it("seletor: tipo inativo do equipamento aparece “(inativo)”; para equipamento novo não aparece", async () => {
    const { opcoesTipoEquipamento } = await import("@/lib/cadastros/tipos-equipamento");
    const tipos = db.t.tipoEquipamentoCustom.filter((t) => t.empresaId === "e1") as any[];
    const edicao = opcoesTipoEquipamento(tipos, "custom:te-velho");
    expect(edicao.find((o) => o.value === "custom:te-velho")?.label).toBe("Bebedouro (inativo)");
    const novo = opcoesTipoEquipamento(tipos);
    expect(novo.map((o) => o.value)).not.toContain("custom:te-velho");
    expect(novo.map((o) => o.value)).not.toContain("CHILLER");
    expect(novo.find((o) => o.value === "custom:te-cortina")).toMatchObject({ label: "Cortina de ar", descricao: "personalizado" });
    expect(opcoesTipoEquipamento(tipos, "CHILLER").find((o) => o.value === "CHILLER")?.label).toBe("Chiller (inativo)");
  });
});

// ═════════════════════════ Tabelas de preço ═════════════════════════
describe("tabelas de preço", () => {
  const P = { entidade: "tabelas-preco" };

  it("itens: valor final calculado no servidor; item NOVO precisa ser ativo e da empresa; o que já tinha fica", async () => {
    const r = await chamar(col, "POST", P, { nome: "Shopping", itens: [{ servicoId: "s1", tipoPreco: "DESCONTO_PERCENTUAL", descontoPercent: 10 }, { produtoId: "pr1", valorFixo: "18,5", valorFinal: 1 }] });
    expect(r.status).toBe(400); // valorFinal não entra pelo corpo
    const ok = await chamar(col, "POST", P, { nome: "Shopping", itens: [{ servicoId: "s1", tipoPreco: "DESCONTO_PERCENTUAL", descontoPercent: 10 }, { produtoId: "pr1", valorFixo: "18,5" }] });
    expect(ok.status).toBe(201);
    expect(db.t.tabelaPrecoItem.filter((i) => i.tabelaId === ok.json.id).map((i) => i.valorFinal).sort()).toEqual([18.5, 90]);
    const inativo = await chamar(col, "POST", P, { nome: "Com inativo", itens: [{ servicoId: "s-velho", valorFixo: 10 }] });
    expect(inativo.status).toBe(400);
    expect(inativo.json.erro).toBe("Serviço inativo(a): escolha um(a) ativo(a).");
    expect((await chamar(col, "POST", P, { nome: "Outra empresa", itens: [{ servicoId: "sB", valorFixo: 10 }] })).status).toBe(400);
    expect((await chamar(col, "POST", P, { nome: "Duplicado", itens: [{ servicoId: "s1", valorFixo: 1 }, { servicoId: "s1", valorFixo: 2 }] })).status).toBe(400);
    // A tabela do contrato já tinha o serviço inativo: editar mantendo-o funciona
    const ed = await chamar(item, "PATCH", { ...P, id: "tp-contrato" }, { itens: [{ servicoId: "s-velho", valorFixo: 45, bloqueado: true }, { servicoId: "s1", valorFixo: 95 }] });
    expect(ed.status).toBe(200);
    expect(db.t.tabelaPrecoItem.filter((i) => i.tabelaId === "tp-contrato").map((i) => i.valorFinal).sort()).toEqual([45, 95]);
  });

  it("renomear (rota antiga, PUT parcial) não apaga os preços — antes o PUT sem itens zerava a tabela", async () => {
    const r = await chamar(() => import("@/app/api/tabelas-preco/[id]/route"), "PUT", { id: "tp-contrato" }, { nome: "Belma 2026" });
    expect(r.status).toBe(200);
    expect(db.t.tabelaPrecoItem.filter((i) => i.tabelaId === "tp-contrato")).toHaveLength(1);
  });

  it("cliente ligado a tabela inativa: o preço volta para a Padrão e a resposta diz qual estava ligada", async () => {
    const efetiva = () => import("@/app/api/clientes/[id]/tabela-preco/route");
    const r = (await chamar(efetiva, "GET", { id: "c1" })).json;
    expect(r).toMatchObject({ id: "tp-padrao", nome: "Padrão", vinculadaInativa: { id: "tp-velha", nome: "Tabela 2023" } });
    expect(r.itens.s1.valorFinal).toBe(90);
    expect((await chamar(efetiva, "GET", { id: "c2" })).json).toMatchObject({ id: "tp-contrato", vinculadaInativa: null });
    expect((await chamar(efetiva, "GET", { id: "c3" })).json).toMatchObject({ id: "tp-padrao", vinculadaInativa: null });
    // Reativar volta a valer a tabela do cliente
    await chamar(item, "PATCH", { ...P, id: "tp-velha" }, { ativo: true });
    expect((await chamar(efetiva, "GET", { id: "c1" })).json).toMatchObject({ id: "tp-velha", vinculadaInativa: null });
  });

  it("cadastro do cliente: escolher tabela inativa = 400; manter a inativa que já tinha = 200", async () => {
    const cli = () => import("@/app/api/clientes/[id]/route");
    const base = { tipoPessoa: "JURIDICA" };
    const troca = await chamar(cli, "PUT", { id: "c2" }, { ...base, nome: "Belma", cpfCnpj: "98765432000188", tabelaPrecoId: "tp-velha" });
    expect(troca.status).toBe(400);
    expect(troca.json.erro).toBe("Tabela de preço inativo(a): escolha um(a) ativo(a).");
    expect(linha("cliente", "c2").tabelaPrecoId).toBe("tp-contrato");
    expect((await chamar(cli, "PUT", { id: "c1" }, { ...base, nome: "Cliente Velho Ltda", cpfCnpj: "12345678000199", tabelaPrecoId: "tp-velha" })).status).toBe(200);
    expect(linha("cliente", "c1")).toMatchObject({ nome: "Cliente Velho Ltda", tabelaPrecoId: "tp-velha" });
    const novo = await chamar(() => import("@/app/api/clientes/route"), "POST", {}, { ...base, nome: "Novo", cpfCnpj: "55666777000155", tabelaPrecoId: "tp-velha" });
    expect(novo.status).toBe(400);
  });

  it("seletor do cliente mostra a tabela real “(inativa)”, não “Padrão (automático)”; escolha nova não a oferece", async () => {
    const { SeletorCadastro } = await import("@/components/cadastros/seletor-cadastro");
    const itens = db.t.tabelaPreco.filter((t) => t.empresaId === "e1").map((t) => ({ id: t.id, nome: t.nome, ativo: t.ativo }));
    const html = (valor: string) => renderToStaticMarkup(createElement(SeletorCadastro, { entidade: "tabelas-preco", itens, valor, vazio: "Padrão (automático)", onChange: () => {} }));
    expect(html("tp-velha")).toMatch(/<option value="tp-velha"[^>]*selected[^>]*>Tabela 2023 \(inativa\)/);
    expect(html("tp-velha")).not.toMatch(/<option value=""[^>]*selected/);
    expect(html("")).not.toContain("Tabela 2023");
    expect(html("")).toContain("Contrato Belma");
  });

  it("impacto: clientes ativos que passam a usar a Padrão; única Padrão avisa", async () => {
    const a = (await chamar(impacto, "GET", { ...P, id: "tp-contrato" })).json;
    expect(a.usos).toEqual([{ rotulo: "1 cliente ativo", total: 1 }]);
    expect(a.avisos[0]).toMatch(/1 cliente ativo usa esta tabela.*tabela Padrão \(“Padrão”\)/);
    const b = (await chamar(impacto, "GET", { ...P, id: "tp-padrao" })).json;
    expect(b.avisos.join(" ")).toMatch(/única tabela Padrão ativa/);
  });
});

// ═════════════════════════ Modelos de prazo ═════════════════════════
describe("modelos de prazo", () => {
  const P = { entidade: "modelos-prazo" };
  const prazos = () => import("@/app/api/ordens/[id]/prazos/route");

  it("OS: prazo NOVO com modelo inativo = 400 (antes aceitava); com modelo ativo = 201", async () => {
    const r = await chamar(prazos, "POST", { id: "os1" }, { templateId: "pz-velho" });
    expect(r.status).toBe(400);
    expect(r.json.erro).toBe("Modelo de prazo inativo(a): escolha um(a) ativo(a).");
    expect(db.t.osPrazo).toHaveLength(1);
    expect((await chamar(prazos, "POST", { id: "os1" }, { templateId: "pzB" })).status).toBe(400); // de outra empresa
    const ok = await chamar(prazos, "POST", { id: "os1" }, { templateId: "pz1" });
    expect(ok.status).toBe(201);
    expect(db.t.osPrazoEtapa.filter((e) => e.osPrazoId === ok.json.id).map((e) => e.nome)).toEqual(["Cotar", "Comprar"]);
  });

  it("o prazo já aberto com o modelo inativo continua na OS", async () => {
    const r = await chamar(prazos, "GET", { id: "os1" });
    expect(r.json.map((p: any) => p.id)).toContain("op1");
  });

  it("etapas: obrigatórias na criação; edição sem etapas não mexe nelas; com etapas, substitui na ordem", async () => {
    expect((await chamar(col, "POST", P, { nome: "Sem etapas" })).status).toBe(400);
    expect((await chamar(col, "POST", P, { nome: "Lista vazia", etapas: [] })).json.erro).toBe("Adicione ao menos uma etapa.");
    expect((await chamar(item, "PATCH", { ...P, id: "pz1" }, { etapas: [] })).status).toBe(400); // esvaziar o modelo também não
    expect(db.t.prazoEtapaTemplate.filter((e) => e.templateId === "pz1")).toHaveLength(2);
    expect((await chamar(col, "POST", P, { nome: "Etapa zero", etapas: [{ nome: "X", prazoHoras: 0 }] })).status).toBe(400);
    const r = await chamar(item, "PATCH", { ...P, id: "pz1" }, { etapas: [{ nome: "Aprovar", prazoHoras: "2", responsavel: "GESTOR", canal: "EMAIL" }, { nome: "Cotar", prazoHoras: 24 }] });
    expect(r.status).toBe(200);
    const etapas = db.t.prazoEtapaTemplate.filter((e) => e.templateId === "pz1").sort((a, b) => a.ordem - b.ordem);
    expect(etapas.map((e) => [e.nome, e.prazoHoras, e.ordem])).toEqual([["Aprovar", 2, 0], ["Cotar", 24, 1]]);
  });

  it("impacto: prazos em andamento nas OS continuam", async () => {
    const a = (await chamar(impacto, "GET", { ...P, id: "pz-velho" })).json;
    expect(a.usos).toEqual([{ rotulo: "1 prazo em andamento", total: 1 }]);
    expect(a.avisos[0]).toMatch(/continua correndo/);
  });

  it("seletor da OS: só modelos ativos", async () => {
    const { SeletorCadastro } = await import("@/components/cadastros/seletor-cadastro");
    const itens = db.t.prazoTemplate.filter((t) => t.empresaId === "e1").map((t) => ({ id: t.id, nome: t.nome, ativo: t.ativo }));
    const html = renderToStaticMarkup(createElement(SeletorCadastro, { entidade: "modelos-prazo", itens, valor: "", onChange: () => {} }));
    expect(html).toContain("Compra de material");
    expect(html).not.toContain("SLA antigo");
  });
});

// ═════════════════════════ Termos de referência ═════════════════════════
describe("termos de referência", () => {
  const P = { entidade: "termos-referencia" };

  it("listar exige ver Configurações; impacto avisa que as propostas guardam cópia do texto", async () => {
    logar("tec", "OPERADOR", PRESETS.TECNICO);
    expect((await chamar(col, "GET", P, undefined, "http://localhost/api/cadastros/termos-referencia")).status).toBe(403);
    logar("admin", "ADMIN");
    const a = (await chamar(impacto, "GET", { ...P, id: "tr1" })).json;
    expect(a.bloqueio).toBeNull();
    expect(a.avisos[0]).toMatch(/guardam uma cópia do texto/);
  });

  it("“Carregar de um template” na proposta: só termos ativos", async () => {
    const { SeletorCadastro } = await import("@/components/cadastros/seletor-cadastro");
    const itens = db.t.termoReferenciaTemplate.map((t) => ({ id: t.id, nome: t.nome, ativo: t.ativo }));
    const html = renderToStaticMarkup(createElement(SeletorCadastro, { entidade: "termos-referencia", itens, valor: "", onChange: () => {} }));
    expect(html).toContain("Contrato anual");
    expect(html).not.toContain("Termo 2019");
  });
});
