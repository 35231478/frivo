// @vitest-environment happy-dom
/**
 * App de campo, leva 3 (PR A) — FAIXA ESPERADA na TELA, num DOM de verdade (banco do aparelho e motor reais):
 *  - app: "Esperado" embaixo da medição; fora da faixa, o alerta âmbar enquanto digita e depois de gravar, com a
 *    observação em 1 toque (que vai para a fila); dentro, nada; o ΔT só mostra (calculado das leituras, sem sinal);
 *  - escritório: "Aplicar faixas sugeridas" escolhe o gás, mostra o que muda e manda grandeza e faixa ao salvar;
 *    faixa inválida não salva; o painel e o relatório destacam a medição fora.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import type { CartaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));

const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z");
const HOJE = "2026-11-12";
let online = true;
const med = (id: string, texto: string, unidade: string, ordem: number, extra: Record<string, unknown> = {}) =>
  ({ id, texto, tipoResposta: "MEDICAO", unidade, ordem, pedirFoto: false, pedirObservacao: false, ativo: true, grandeza: null, valorMin: null, valorMax: null, ...extra });
const ITENS = [
  med("iSuc", "Pressão de sucção", "psi", 1, { grandeza: "SUCCAO", valorMin: 115, valorMax: 140 }),
  med("iDes", "Pressão de descarga", "psi", 2, { valorMin: 300, valorMax: 420, pedirObservacao: true }),
  med("iIns", "Temperatura de insuflamento", "°C", 3, { valorMin: 10, valorMax: 16 }),
  med("iRet", "Temperatura de retorno", "°C", 4),
  med("iDt", "Diferença de temperatura do ar (ΔT)", "°C", 5, { grandeza: "DELTA_T", valorMin: 8, valorMax: 14 }),
  med("iCor", "Corrente do compressor", "A", 6),
];
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const cartao = (): CartaoTela => ({
  atividadeId: "aA", osId: "osA", osNumero: "OS-1", titulo: "Preventiva", tipoOs: null, status: "EM_ANDAMENTO", prioridade: "NORMAL", dataAgendada: null, dia: HOJE, hora: "09:00",
  duracaoMin: 60, cliente: "Hospital", telefone: null, unidade: "Matriz", endereco: "Av. Paulista", rota: null, descricao: "Preventiva", equipamentos: 1, atendidos: 0, adicionais: 0, avisos: {},
} as CartaoTela);
const equip = { id: "eqA", titulo: "Split Sala 1", descricao: "Split", fabricante: "Daikin", tag: null, numeroSerie: null, local: "Sala", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" }, garantiaAte: null };
const retrato = (): RetratoAtividade => ({
  cartao: cartao(),
  execucao: {
    atividade: { id: "aA", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "osA", numero: "OS-1", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
    bloqueada: false, adicionais: [], avisos: {}, materiais: [], comentarios: [],
    equipamentos: [{ vinculoId: "v1", feito: false, observacao: null, equipamento: equip, itens: ITENS, respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false }],
    conclusao: { ok: false, semEquipamento: false, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null, dispensa: null },
  },
  equipamentosUnidade: [{ ...equip, tipoEquipamentoId: "te1", qr: null }], checklistsPorTipo: { te1: ITENS }, cadastro: null, avisoCliente: null, geradoEm: new Date().toISOString(),
} as unknown as RetratoAtividade);
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
const fetchApp = vi.fn(async (url: string) => {
  if (!online) throw new TypeError("Failed to fetch");
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: { id: "t1", nome: "João" }, dia: HOJE, atividades: [cartao()], anteriores: [] });
  if (url === "/api/tecnico/catalogo") return json({ produtos: [] });
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato());
  return json({}, 404);
});

let root: Root | null = null; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync;
beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/execucao"), import("@/components/cadastros/editores/checklist-tipo"),
    import("@/components/dashboard/blocos"), import("@/components/relatorio/relatorio-os-documento")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = true;
  vi.stubGlobal("fetch", fetchApp);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  banco = await BancoTecnico.abrir("uT");
  motor = new MotorSync(banco, { fetch: fetchApp as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
  vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation(() => {});
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  caixa?.remove(); document.body.innerHTML = ""; root = null;
  banco.fechar(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});

const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg = "condição") { for (let i = 0; i < 150; i++) { if (cond()) return; await esperar(1); } throw new Error(`não aconteceu: ${msg}`); }
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const valor = async (el: HTMLInputElement | HTMLTextAreaElement | null, v: string) => {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar(2);
};
const focar = async (el: HTMLElement | null) => { await act(async () => { el!.dispatchEvent(new FocusEvent("focus")); el!.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); }); await esperar(2); };
const sair = async (el: HTMLElement | null) => { await act(async () => { el!.dispatchEvent(new FocusEvent("blur")); el!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); await esperar(); };
async function montar(el: ReturnType<typeof createElement>) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(el); }); await esperar();
}
const item = (id: string) => $(`[data-item="${id}"]`);
const campo = (id: string) => item(id)!.querySelector("input[inputmode=decimal]") as HTMLInputElement;

async function abrirEquipamento() {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  function Vistas() { const v = useVista(); return v?.ver === "os" ? createElement(VistaOs, { key: v.a, atividadeId: v.a, equipamentoId: v.e }) : null; }
  window.history.replaceState(null, "", "/tecnico?ver=os&a=aA&e=eqA");
  await montar(createElement(ProvedorTecnico, { usuario: { id: "uT", nome: "João", email: "j@x.com", empresaNome: "Clima", podeGravar: true }, motorPronto: motor, children: createElement(Vistas) }));
  await esperarAte(() => !!item("iSuc"), "equipamento");
}
const filaRespostas = async () => (await banco.fila()).filter((o) => o.tipo === "resposta").map((o: any) => [o.itemId, o.dados]);

describe("app: medição com faixa", () => {
  it("mostra o esperado; fora da faixa alerta já enquanto digita e continua depois de gravar; dentro, nada", async () => {
    await abrirEquipamento();
    expect(texto(item("iSuc")!.querySelector("[data-faixa]"))).toBe("Esperado: 115–140 psi");
    expect(item("iCor")!.querySelector("[data-faixa]")).toBeNull(); // corrente sem faixa
    online = false;
    await focar(campo("iSuc")); await valor(campo("iSuc"), "95");
    expect(texto(item("iSuc")!.querySelector("[data-aviso-faixa]"))).toBe("Abaixo do esperado (115–140 psi)");
    await sair(campo("iSuc"));
    expect(await filaRespostas()).toEqual([["iSuc", { valor: 95 }]]);
    expect(texto(item("iSuc")!.querySelector("[data-aviso-faixa]"))).toBe("Abaixo do esperado (115–140 psi)");
    expect(item("iSuc")!.querySelector("[data-faixa]")).toBeNull(); // o alerta já diz a faixa
    await focar(campo("iSuc")); await valor(campo("iSuc"), "500");
    expect(texto(item("iSuc")!.querySelector("[data-aviso-faixa]"))).toBe("Acima do esperado (115–140 psi)");
    await valor(campo("iSuc"), "120"); await sair(campo("iSuc"));
    expect(item("iSuc")!.querySelector("[data-fora-da-faixa]")).toBeNull();
  });

  it("observação em 1 toque ao lado do alerta (vai para a fila); o item que já pede observação usa o campo dele", async () => {
    await abrirEquipamento();
    online = false;
    await focar(campo("iSuc")); await valor(campo("iSuc"), "95"); await sair(campo("iSuc"));
    await clicar(item("iSuc")!.querySelector("[data-observar-faixa]"));
    const obs = item("iSuc")!.querySelector("textarea") as HTMLTextAreaElement;
    await valor(obs, "Possível falta de gás."); await sair(obs);
    expect((await filaRespostas()).at(-1)).toEqual(["iSuc", { observacao: "Possível falta de gás." }]);
    expect(item("iSuc")!.querySelector("[data-observar-faixa]")).toBeNull();
    // Descarga já pede observação: fora da faixa, sem o botão a mais
    await focar(campo("iDes")); await valor(campo("iDes"), "500"); await sair(campo("iDes"));
    expect(item("iDes")!.querySelector("[data-fora-da-faixa]")).not.toBeNull();
    expect(item("iDes")!.querySelector("[data-observar-faixa]")).toBeNull();
    const obsDes = item("iDes")!.querySelector("textarea") as HTMLTextAreaElement;
    await valor(obsDes, "Condensadora suja."); await sair(obsDes);
    expect(item("iDes")!.querySelectorAll("textarea")).toHaveLength(1); // nunca dois campos de observação
  });

  it("ΔT: só mostra, calculado das leituras (sem sinal), com a faixa e o alerta", async () => {
    await abrirEquipamento();
    online = false;
    expect(item("iDt")!.querySelector("input")).toBeNull();
    expect(item("iDt")!.querySelector("[data-chip]")).toBeNull();
    expect(texto(item("iDt")!.querySelector("[data-valor-calculado]"))).toBe("—");
    await focar(campo("iRet")); await valor(campo("iRet"), "24"); await sair(campo("iRet"));
    await focar(campo("iIns")); await valor(campo("iIns"), "12,5"); await sair(campo("iIns"));
    await esperarAte(() => texto(item("iDt")!.querySelector("[data-valor-calculado]")) === "11,5 °C", "ΔT");
    expect(texto(item("iDt")!.querySelector("[data-faixa]"))).toBe("Esperado: 8–14 °C");
    await focar(campo("iIns")); await valor(campo("iIns"), "20"); await sair(campo("iIns"));
    await esperarAte(() => texto(item("iDt")!.querySelector("[data-valor-calculado]")) === "4 °C", "ΔT novo");
    expect(texto(item("iDt")!.querySelector("[data-aviso-faixa]"))).toBe("Abaixo do esperado (8–14 °C)");
    expect((await filaRespostas()).map(([id]) => id)).not.toContain("iDt"); // o ΔT não vai para a fila: o servidor recalcula
  });
});

/* ───────── escritório ───────── */
let escritas: { url: string; metodo: string; corpo: any }[] = [];
const ATUAIS = [
  { id: "i1", texto: "Limpeza dos filtros de ar", tipoResposta: "OK_ATENCAO_NA", pedirFoto: true, pedirObservacao: false, unidade: null, grandeza: null, valorMin: null, valorMax: null },
  { id: "i2", texto: "Pressão de sucção", tipoResposta: "MEDICAO", pedirFoto: false, pedirObservacao: false, unidade: "psi", grandeza: "SUCCAO", valorMin: null, valorMax: null, respostas: 3 },
  { id: "i3", texto: "Pressão de descarga", tipoResposta: "MEDICAO", pedirFoto: false, pedirObservacao: false, unidade: "psi", grandeza: "DESCARGA", valorMin: null, valorMax: null },
  { id: "i4", texto: "Temperatura de insuflamento", tipoResposta: "MEDICAO", pedirFoto: false, pedirObservacao: false, unidade: "°C", grandeza: "INSUFLAMENTO", valorMin: null, valorMax: null },
  { id: "i5", texto: "Temperatura de retorno", tipoResposta: "MEDICAO", pedirFoto: false, pedirObservacao: false, unidade: "°C", grandeza: "RETORNO", valorMin: null, valorMax: null },
];
async function montarEditor(itens = ATUAIS) {
  escritas = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    if (init?.method === "PUT") { const c = JSON.parse(String(init.body)); escritas.push({ url: u, metodo: "PUT", corpo: c }); return json({ itens: c.itens.map((i: any, n: number) => ({ id: i.id ?? `novo${n}`, ...i })) }); }
    return json({ tipo: { id: "te1", nome: "Split" }, itens, sugestao: [] });
  }));
  const { ChecklistTipo } = await import("@/components/cadastros/editores/checklist-tipo");
  await montar(createElement(ChecklistTipo, { tipoId: "te1", podeEditar: true }));
  await esperarAte(() => !!$("[data-checklist-tipo]"), "editor");
}

describe("escritório: faixa no tipo de equipamento", () => {
  it("'Aplicar faixas sugeridas': escolhe o gás, mostra o que muda e só aplica ao confirmar; salvar manda grandeza e faixa", async () => {
    await montarEditor();
    await clicar($("[data-aplicar-faixas]"));
    const linhas = () => $$("[data-mudanca]").map((l) => [...l.querySelectorAll("td")].map((c) => texto(c)).join(" | "));
    expect(linhas()).toEqual([
      "Pressão de sucção | — | 115–140 psi", "Pressão de descarga | — | 300–420 psi", "Temperatura de insuflamento | — | 10–16 °C",
      "Superaquecimentonovo item | — | 5–12 K", "Diferença de temperatura do ar (ΔT)novo item | — | 8–14 °C",
    ]);
    await clicar($('[data-gas="R22"]'));
    expect(linhas()[0]).toBe("Pressão de sucção | — | 58–75 psi");
    await clicar($("[data-confirmar-faixas]"));
    expect($("[data-modal-faixas]")).toBeNull();
    expect($$("[data-item-checklist] input[name^='item-']").map((i) => (i as HTMLInputElement).value)).toEqual([
      "Limpeza dos filtros de ar", "Pressão de sucção", "Pressão de descarga", "Superaquecimento", "Temperatura de insuflamento", "Temperatura de retorno", "Diferença de temperatura do ar (ΔT)",
    ]);
    expect(texto($('[data-calculada-item="7"]'))).toBe("Calculado no app: temperatura de retorno − temperatura de insuflamento");
    await clicar($("[data-salvar-checklist]"));
    const itens = escritas[0].corpo.itens;
    expect(itens[0]).toEqual({ id: "i1", texto: "Limpeza dos filtros de ar", tipoResposta: "OK_ATENCAO_NA", pedirFoto: true, pedirObservacao: false });
    expect(itens.slice(1).map((i: any) => [i.texto, i.grandeza, i.valorMin, i.valorMax, i.unidade])).toEqual([
      ["Pressão de sucção", "SUCCAO", 58, 75, "psi"], ["Pressão de descarga", "DESCARGA", 200, 280, "psi"], ["Superaquecimento", "SUPERAQUECIMENTO", 5, 12, "K"],
      ["Temperatura de insuflamento", "INSUFLAMENTO", 10, 16, "°C"], ["Temperatura de retorno", "RETORNO", null, null, "°C"], ["Diferença de temperatura do ar (ΔT)", "DELTA_T", 8, 14, "°C"],
    ]);
  });

  it("cancelar não muda nada; faixa digitada com vírgula vai como número; inválida ou invertida não salva (diz qual)", async () => {
    await montarEditor();
    await clicar($("[data-aplicar-faixas]")); await clicar([...document.querySelectorAll("[data-modal-faixas] button")].find((b) => texto(b) === "Cancelar"));
    expect($$("[data-item-checklist]")).toHaveLength(5);
    const min = $('[aria-label="Mínimo esperado do item 2"]') as HTMLInputElement, max = $('[aria-label="Máximo esperado do item 2"]') as HTMLInputElement;
    await valor(min, "abc"); await clicar($("[data-salvar-checklist]"));
    expect(texto($('[role="alert"]'))).toBe("Item 2: faixa com número inválido (use vírgula para decimais).");
    await valor(min, "150"); await valor(max, "140"); await clicar($("[data-salvar-checklist]"));
    expect(texto($('[role="alert"]'))).toBe("Item 2: o mínimo da faixa não pode passar do máximo.");
    expect(escritas).toEqual([]);
    await valor(min, "117,5"); await clicar($("[data-salvar-checklist]"));
    expect(escritas[0].corpo.itens[1]).toMatchObject({ valorMin: 117.5, valorMax: 140 });
  });
});

describe("escritório: os destaques", () => {
  it("painel: o card 'Fora do esperado' leva à OS e lista as últimas; sem o dado, o card não aparece", async () => {
    const { BlocoEquipamentos } = await import("@/components/dashboard/blocos");
    const d = { total: 12, garantiaVencendo: 0, garantiaVigente: 7, semQr: 0, foraDaFaixa: { equipamentos: 2, ultimas: [
      { id: "r1", equipamento: "Split sala 1", item: "Pressão de sucção", valor: 95, unidade: "psi", faixa: { min: 115, max: 140 }, os: { id: "os1", numero: "OS-1" } },
    ] } };
    await montar(createElement(BlocoEquipamentos as any, { d, temQr: true }));
    expect(texto(document.body)).toContain("Fora do esperado");
    expect(texto(document.body)).toContain("equipamentos · 30 dias");
    const link = $("[data-fora-da-faixa-painel] a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/ordens/os1?aba=relatorios");
    expect(texto(link)).toBe("Split sala 1 · Pressão de sucção 95 psiOS-1 · esperado 115–140 psi");
    act(() => root!.unmount()); caixa.remove(); root = null;
    await montar(createElement(BlocoEquipamentos as any, { d: { total: 12, garantiaVencendo: 0, garantiaVigente: 7, semQr: 0 }, temQr: true }));
    expect(texto(document.body)).not.toContain("Fora do esperado");
  });

  it("relatório: a medição fora sai destacada com a faixa; a dentro mostra o esperado; o equipamento conta as fora", async () => {
    const { BlocoEquip } = await import("@/components/relatorio/relatorio-os-documento");
    const bloco = {
      id: "eqA", local: { principal: "Sala 1", complemento: null, unidade: "Matriz" }, titulo: "Split Sala 1", descricao: "Split", fabricante: "Daikin", tag: null, numeroSerie: null,
      checklist: [], observacoes: [], fotos: [],
      checklistTipo: [{ atividade: "Preventiva", itens: [
        { texto: "Pressão de sucção", status: null, observacao: "Possível falta de gás.", medicao: { valor: 95, unidade: "psi", faixa: { min: 115, max: 140 }, fora: true }, audio: false },
        { texto: "Pressão de descarga", status: null, observacao: null, medicao: { valor: 355, unidade: "psi", faixa: { min: 300, max: 420 }, fora: false }, audio: false },
        { texto: "Corrente", status: null, observacao: null, medicao: { valor: 6.8, unidade: "A", faixa: null, fora: false }, audio: false },
      ] }],
      resumoChecklist: { ok: 0, atencao: 0, naoSeAplica: 0, medicoes: 3, foraDaFaixa: 1 },
    };
    await montar(createElement(BlocoEquip as any, { b: bloco, checklist: true, fotos: true }));
    expect(texto($("[data-resumo-fora]"))).toBe("1 fora do esperado");
    expect($$("[data-faixa-relatorio]").map((p) => texto(p))).toEqual(["Fora do esperado: 115–140 psi", "Esperado: 300–420 psi"]);
    expect($$("[data-medicao-relatorio][data-fora]").map((s) => texto(s))).toEqual(["95 psi"]);
  });
});
