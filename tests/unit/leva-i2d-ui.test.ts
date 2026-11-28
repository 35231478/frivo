// @vitest-environment happy-dom
/**
 * Leva I.2 — grupo D, as telas num DOM de verdade:
 *  12. "Notas descartadas": Restaurar só no descarte com XML e para quem descarta; sem XML, a dica "Importe o XML de
 *      novo"; restaurar chama a rota e abre a nota; a chave já importada de novo mostra o motivo e o link; a
 *      restaurada mostra quem restaurou e quando (a trilha);
 *  13. as tabelas novas são a TabelaPro (menu Colunas com as colunas da tela) — Diário do checklist, Empresas;
 *  14. os filtros vão para a URL: QR Codes (vínculo/status), Checklists preenchidos ("Só com alertas", situação, com a
 *      `aba` da tela), Despesas de campo (situação), Diário (período) — e a URL que chega (sino, lembrado) filtra.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), sp: new URLSearchParams(), pathname: "/x" }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => nav.pathname, useSearchParams: () => nav.sp }));
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async () => true) }));
vi.mock("@/components/ui/avisos", async (orig) => ({ ...(await orig<object>()), toast: avisos.toast, confirmar: avisos.confirmar }));

let raiz: Root | null = null;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string }[] = [];
beforeAll(async () => {
  await import("@/components/ui/avisos");
  for (const m of [() => import("@/components/providers/permissoes-provider"), () => import("@/components/compras/notas-descartadas"),
    () => import("@/app/(dashboard)/qrcodes/qrcodes-client"), () => import("@/components/veiculos/checklists-preenchidos"),
    () => import("@/components/veiculos/checklist-diario"), () => import("@/components/financeiro/despesas-campo-view"), () => import("@/components/admin/empresas-admin")]) await m();
}, 120_000);
beforeEach(() => {
  nav.push.mockClear(); nav.refresh.mockClear(); nav.replace.mockClear(); nav.sp = new URLSearchParams(); nav.pathname = "/x";
  avisos.toast.mockClear();
  respostas = {}; chamadas.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    if (!String(url).startsWith("/api/preferencias/")) chamadas.push({ url: String(url), metodo });
    const r = respostas[`${metodo} ${url}`] ?? Object.entries(respostas).find(([k]) => k.endsWith("*") && `${metodo} ${url}`.startsWith(k.slice(0, -1)))?.[1] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  caixa = document.createElement("div"); document.body.appendChild(caixa);
});
afterEach(() => { act(() => raiz?.unmount()); raiz = null; caixa.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: ReactElement, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  raiz = createRoot(caixa);
  await act(async () => { raiz!.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, usuarioId: "u1", empresaId: "e1", children: el } as any)); });
  await esperar();
}
const $ = <T extends Element = HTMLElement>(s: string, base: ParentNode = document) => base.querySelector(s) as T | null;
const $$ = (s: string, base: ParentNode = document) => [...base.querySelectorAll(s)];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function escolher(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
const ultimaUrl = () => String(nav.replace.mock.calls.at(-1)?.[0] ?? "");

/* ───────── 12 ───────── */
describe("12. Notas descartadas: Restaurar", () => {
  const d = (id: string, extra: Record<string, unknown> = {}) => ({
    id, numero: id.toUpperCase(), serie: "1", emitenteNome: "Distribuidora Fictícia", valorTotal: 1749.3, motivo: null,
    descartadoEm: "2026-11-20T13:00:00.000Z", usuario: { nome: "Ana Souza" }, temXml: true, restauradaEm: null, restauradaPor: null, notaRestauradaId: null, ...extra,
  });
  const LISTA = [d("d1"), d("d2", { temXml: false }), d("d3", { restauradaEm: "2026-11-21T14:00:00.000Z", restauradaPor: "Bruno Lima", notaRestauradaId: "nNova" })];
  async function abrir(podeRestaurar = true) {
    const { NotasDescartadas } = await import("@/components/compras/notas-descartadas");
    await montar(createElement(NotasDescartadas, { descartes: LISTA as any, podeRestaurar }));
  }
  it("com XML e permissão: o botão; sem XML: a dica 'Importe o XML de novo'; a restaurada: quem e quando, com o link", async () => {
    await abrir();
    expect($$("[data-restaurar-nota]").map((b) => b.getAttribute("data-restaurar-nota"))).toEqual(["d1"]);
    expect($('[data-descarte="d2"] [data-restaurar-nota]')).toBeNull();
    expect(txt($('[data-descarte="d2"] [data-descarte-sem-xml]'))).toContain("Sem o XML");
    const dica = $('[data-descarte="d2"] [data-descarte-sem-xml] button')!;
    await clicar(dica);
    expect(txt(document.body)).toContain("Importe o XML de novo");
    expect(txt($('[data-descarte="d3"] [data-descarte-restaurada]'))).toMatch(/^Restaurada em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2} por Bruno Lima · Abrir a nota$/);
    expect($('[data-descarte="d3"] a')!.getAttribute("href")).toBe("/estoque/notas/nNova");
    expect(txt(document.body)).not.toMatch(/você/i);
  });
  it("sem Estoque › gerenciar: nenhum botão (o servidor recusa de qualquer jeito)", async () => {
    await abrir(false);
    expect($$("[data-restaurar-nota]")).toHaveLength(0);
    expect(txt($("[data-descartes-recuperar]"))).toContain("é de quem gerencia o estoque");
  });
  it("restaurar: chama a rota, avisa e abre a nota; a chave já importada de novo: o motivo e o link da nota", async () => {
    respostas["POST /api/compras/notas/descartes/d1/restaurar"] = { status: 201, corpo: { nota: { id: "nVolta" } } };
    await abrir();
    await clicar($('[data-restaurar-nota="d1"]'));
    expect(chamadas).toEqual([{ url: "/api/compras/notas/descartes/d1/restaurar", metodo: "POST" }]);
    expect(avisos.toast).toHaveBeenCalledWith("NF D1/1 restaurada.");
    expect(nav.push).toHaveBeenCalledWith("/estoque/notas/nVolta");

    respostas["POST /api/compras/notas/descartes/d1/restaurar"] = { status: 409, corpo: { erro: "A NF D1/1 já foi importada de novo em 22/11/2026: não há o que restaurar. Abra a nota importada.", notaId: "nOutra" } };
    await clicar($('[data-restaurar-nota="d1"]'));
    expect(txt($("[data-erro-restaurar]"))).toContain("já foi importada de novo");
    expect($("[data-erro-restaurar] a")!.getAttribute("href")).toBe("/estoque/notas/nOutra");
  });
});

/* ───────── 13 ───────── */
describe("13. as tabelas novas são a TabelaPro", () => {
  it("Empresas: menu Colunas com as colunas da lista; linhas e cartões com os data-* de antes", async () => {
    const { EmpresasAdmin } = await import("@/components/admin/empresas-admin");
    await montar(createElement(EmpresasAdmin, { inicial: [{ id: "e2", nome: "Aurora Ltda (fictícia)", nomeFantasia: null, cnpj: "45.678.912/0001-55", ativo: false, criadoEm: "2026-11-27T12:00:00.000Z", usuarios: 1 }] }));
    expect($("[data-tabela-pro='admin-empresas'] [data-lista-empresas]")).toBeTruthy();
    expect($$("[data-empresa='e2']")).toHaveLength(2); // linha e cartão
    expect($$("[data-empresa='e2'] [data-situacao-empresa='reativar']")).toHaveLength(2);
    await clicar($("[data-colunas-menu]"));
    expect($$("[data-item-coluna]").map((i) => i.getAttribute("data-item-coluna"))).toEqual(["empresa", "cnpj", "usuarios", "criada"]);
  });
});

/* ───────── 14 ───────── */
describe("14. os filtros vão para a URL", () => {
  const QR = [
    { id: "q1", codigo: "QR-1", ativo: true, criadoEm: "2026-11-01T12:00:00.000Z", equipamento: { id: "eq1", nome: "Split Recepção", local: null } },
    { id: "q2", codigo: "QR-2", ativo: false, criadoEm: "2026-11-02T12:00:00.000Z", equipamento: null },
  ];
  it("QR Codes: escolher o vínculo vai para a URL; a URL com status filtra ao abrir", async () => {
    nav.pathname = "/qrcodes";
    const { QrcodesClient } = await import("@/app/(dashboard)/qrcodes/qrcodes-client");
    await montar(createElement(QrcodesClient, { lista: QR, equipamentosLivres: [], proximoCodigo: "QR-3" }));
    await escolher($("[data-filtro-vinculo]"), "nao");
    expect(ultimaUrl()).toBe("/qrcodes?vinculo=nao");
    expect($$("[data-tabela-qrcodes] [data-qr]").map((l) => l.getAttribute("data-qr"))).toEqual(["q2"]);
    act(() => raiz!.unmount()); raiz = null;
    nav.sp = new URLSearchParams("status=ativo");
    await montar(createElement(QrcodesClient, { lista: QR, equipamentosLivres: [], proximoCodigo: "QR-3" }));
    expect($<HTMLSelectElement>("[data-filtro-status]")!.value).toBe("ativo");
    expect($$("[data-tabela-qrcodes] [data-qr]").map((l) => l.getAttribute("data-qr"))).toEqual(["q1"]);
  });

  const CK = (id: string, status: string) => ({
    id, status, criadoEm: "2026-11-28T11:00:00.000Z", editadoEm: null, inativadoEm: null, veiculoId: "v1", veiculo: { placa: `FRV${id}`, modelo: "Fiorino" },
    colaborador: { nome: "João" }, template: { nome: "Diário" }, inativadoPor: null, totalItens: 3, alertas: status === "COM_ALERTAS" ? 1 : 0,
  });
  it("Checklists preenchidos: o link do sino (?alertas=1) já abre filtrado; 'Só com alertas' e 'Inativos' vão para a URL com a aba", async () => {
    nav.pathname = "/veiculos/checklist";
    nav.sp = new URLSearchParams("aba=preenchidos&alertas=1");
    respostas["GET /api/checklists?"] = { status: 200, corpo: [CK("1", "CONCLUIDO"), CK("2", "COM_ALERTAS")] };
    const { ChecklistsPreenchidos } = await import("@/components/veiculos/checklists-preenchidos");
    await montar(createElement(ChecklistsPreenchidos, { colaboradores: [] }), montarPermissoes({ veiculos: ["visualizar"] }));
    expect($<HTMLInputElement>("[data-filtro-alertas] input")!.checked).toBe(true);
    expect($$("tr[data-checklist]").map((l) => l.getAttribute("data-checklist"))).toEqual(["2"]);
    await clicar($("[data-filtro-alertas] input"));
    expect(ultimaUrl()).toBe("/veiculos/checklist?aba=preenchidos");
    expect($$("tr[data-checklist]").map((l) => l.getAttribute("data-checklist"))).toEqual(["1", "2"]);
    await clicar($('[data-checklists-preenchidos] [data-aba="inativos"]'));
    // (a URL simulada não muda: o alertas=1 de antes continua nela)
    expect(ultimaUrl()).toBe("/veiculos/checklist?aba=preenchidos&alertas=1&situacao=inativos");
  });
  it("na ficha do veículo, os filtros ficam só na tela (sem mexer na URL do cadastro)", async () => {
    nav.pathname = "/veiculos/v1/editar";
    respostas["GET /api/checklists?veiculoId=v1"] = { status: 200, corpo: [CK("1", "CONCLUIDO"), CK("2", "COM_ALERTAS")] };
    const { ChecklistsPreenchidos } = await import("@/components/veiculos/checklists-preenchidos");
    await montar(createElement(ChecklistsPreenchidos, { colaboradores: [], veiculoId: "v1" }), montarPermissoes({ veiculos: ["visualizar"] }));
    await clicar($("[data-filtro-alertas] input"));
    expect($$("tr[data-checklist]").map((l) => l.getAttribute("data-checklist"))).toEqual(["2"]);
    expect(nav.replace).not.toHaveBeenCalled();
  });
  it("Diário: TabelaPro; o período vem da URL (vai à API) e mudar a data vai para a URL com a aba", async () => {
    nav.pathname = "/veiculos/checklist";
    nav.sp = new URLSearchParams("aba=diario&de=2026-11-01&ate=2026-11-07");
    respostas["GET /api/checklist-diario?de=2026-11-01&ate=2026-11-07"] = { status: 200, corpo: { ativo: true, linhas: [
      { chave: "k1", dia: "2026-11-03", nome: "João", veiculo: "FRV1A01", situacao: "FEITO", registro: { feitoEm: "2026-11-03T10:00:00.000Z", enviadoOffline: false, motivo: null, situacao: "FEITO", situacaoAnterior: null, trocadoEm: null, checklistId: "c1" } },
    ] } };
    const { ChecklistDiario } = await import("@/components/veiculos/checklist-diario");
    await montar(createElement(ChecklistDiario, { colaboradores: [] }));
    expect(chamadas.map((c) => c.url)).toContain("/api/checklist-diario?de=2026-11-01&ate=2026-11-07");
    expect($("[data-tabela-pro='checklist-diario'] [data-tabela-diario]")).toBeTruthy();
    expect($$("[data-tabela-diario] [data-linha-diario]").map(txt)[0]).toContain("João");
    await digitar($('input[aria-label="De"]'), "02/11/2026");
    expect(ultimaUrl()).toBe("/veiculos/checklist?aba=diario&de=2026-11-02&ate=2026-11-07");
  });
  it("Despesas de campo: a situação vai para a URL (a padrão, A aprovar, sai dela) e a URL escolhe a lista", async () => {
    nav.pathname = "/financeiro/despesas-campo";
    respostas["GET /api/despesas-campo*"] = { status: 200, corpo: { despesas: [] } };
    const { DespesasCampoView } = await import("@/components/financeiro/despesas-campo-view");
    await montar(createElement(DespesasCampoView, { podeDecidir: true }));
    expect(chamadas.map((c) => c.url)).toContain("/api/despesas-campo?status=PENDENTE");
    await clicar($('[data-filtro="APROVADA"]'));
    expect(ultimaUrl()).toBe("/financeiro/despesas-campo?situacao=APROVADA");
    expect(chamadas.map((c) => c.url)).toContain("/api/despesas-campo?status=APROVADA");
    await clicar($('[data-filtro="PENDENTE"]'));
    expect(ultimaUrl()).toBe("/financeiro/despesas-campo");
    act(() => raiz!.unmount()); raiz = null; chamadas.length = 0;
    nav.sp = new URLSearchParams("situacao=RECUSADA");
    await montar(createElement(DespesasCampoView, { podeDecidir: true }));
    expect($('[data-filtro="RECUSADA"]')!.getAttribute("aria-selected")).toBe("true");
    expect(chamadas.map((c) => c.url)).toContain("/api/despesas-campo?status=RECUSADA");
  });
});
