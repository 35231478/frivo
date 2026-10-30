// @vitest-environment happy-dom
/**
 * Contas a Receber — gestão, num DOM de verdade:
 *  - menu ⋮ único com o que o status permite; o que não pode fica apagado com ⓘ do motivo (excluir conta
 *    de medição/nota fiscal, cancelar com boleto ativo, recibo antes do recebimento);
 *  - edição completa: conta bancária e centro de custo por cadastro (não texto livre), cliente/origem em
 *    leitura quando vem de orçamento/medição, valor travado com boleto emitido; manda só o que mudou;
 *  - informar recebimento (sem o campo "valor recebido" que era ignorado), cancelar exige motivo, excluir
 *    manda DELETE; toast e refresh;
 *  - gaveta de detalhes (origem com links, itens, documentos, histórico) e ?conta= abrindo direto;
 *  - celular: cartão por conta com o ⋮; vínculo "Conta a receber: CR-…" com Abrir.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: nav.replace, back: () => {} }),
  usePathname: () => "/financeiro/contas-receber", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast }));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => {
  await Promise.all([
    import("@/components/financeiro/conta-receber-acoes"), import("@/components/financeiro/contas-receber-view"),
    import("@/components/providers/permissoes-provider"),
  ]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0;
  nav.refresh.mockClear(); nav.push.mockClear(); avisos.toast.mockClear();
  respostas = {
    "GET /api/cadastros/contas-bancarias": { status: 200, corpo: [{ id: "cb1", nome: "Inter PJ", ativo: true }, { id: "cb2", nome: "Itaú movimento", ativo: true }] },
    "GET /api/cadastros/centros-custo": { status: 200, corpo: [{ id: "cc1", nome: "Obra Shopping Norte", ativo: true }] },
    "GET /api/cadastros/categorias-financeiras": { status: 200, corpo: [] },
    "PUT /api/contas-receber/": { status: 200, corpo: { ok: true } },
    "DELETE /api/contas-receber/": { status: 200, corpo: { ok: true } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: React.ReactElement, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
  await esperar();
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
const enviados = (metodo: string) => chamadas.filter((c) => c.metodo === metodo);

const base = {
  id: "cr1", numero: "CR-2026-0042", descricao: "Manutenção corretiva", valor: 1234.56, dataVencimento: "2026-11-20T00:00:00.000Z",
  status: "A_RECEBER", banco: null, clienteId: "c1", clienteNome: "Hospital Santa Luzia", whatsapp: "11999990000", email: "fin@hosp.com",
  interAtivo: true, boletoStatus: null, boletoEmitidoEm: null, boletoVencimento: null, boletoLinhaDigitavel: null, boletoCodigoBarras: null,
  categoriaId: null, categoria: null, formaPagamento: null, observacao: null, centroCustoId: null, contaBancariaId: null, notas: [],
};
const CLIENTES = [{ id: "c1", nome: "Hospital Santa Luzia" }, { id: "c2", nome: "Padaria Pão Dourado" }];
async function menu(conta: Record<string, unknown> = {}) {
  const { ContaReceberAcoes } = await import("@/components/financeiro/conta-receber-acoes");
  const onDetalhes = vi.fn();
  await montar(createElement(ContaReceberAcoes, { conta: { ...base, ...conta } as any, clientes: CLIENTES, onDetalhes }));
  await clicar($("[data-acao=menu]"));
  return onDetalhes;
}
const itemMenu = (id: string) => $(`[data-menu-acoes] [data-item="${id}"]`);
const desabilitado = (id: string) => itemMenu(id)?.hasAttribute("data-desabilitado") ?? false;
const motivo = (id: string) => itemMenu(id)?.getAttribute("title") ?? null;

describe("menu ⋮ por situação", () => {
  it("conta manual em aberto: tudo à mão; recibo apagado com o motivo; excluir liberado", async () => {
    await menu();
    expect($$("[data-menu-acoes] [data-item]").map((i) => i.getAttribute("data-item"))).toEqual([
      "detalhes", "editar", "receber", "boleto", "cobrar-whatsapp", "cobrar-email", "recibo", "cancelar", "excluir",
    ]);
    expect(desabilitado("excluir")).toBe(false);
    expect(desabilitado("recibo")).toBe(true);
    expect(motivo("recibo")).toBe("O recibo sai depois de informar o recebimento.");
    expect(itemMenu("recibo")!.querySelector("[data-dica]")).not.toBeNull();
  });

  it("conta de medição: excluir apagado com ⓘ 'use Cancelar'; com nota fiscal, o motivo é a nota", async () => {
    await menu({ medicaoId: "m1", medicaoNumero: "MED-1" });
    expect(desabilitado("excluir")).toBe(true);
    expect(motivo("excluir")).toBe("Conta de medição: use Cancelar.");
    expect(desabilitado("cancelar")).toBe(false);
    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
    await menu({ notas: [{ status: "CONCLUIDO" }] });
    expect(motivo("excluir")).toBe("Conta com nota fiscal: use Cancelar.");
  });

  it("boleto emitido: ver/baixar boleto; cancelar e excluir apagados com o motivo", async () => {
    await menu({ boletoStatus: "EMITIDO", boletoLinhaDigitavel: "0779" });
    expect(txt(itemMenu("boleto"))).toBe("Boleto (linha digitável)");
    expect(itemMenu("boleto-pdf")).not.toBeNull();
    expect(motivo("cancelar")).toBe("Cancele o boleto antes: o cliente ainda consegue pagá-lo.");
    expect(motivo("excluir")).toBe("Cancele o boleto antes de excluir.");
  });

  it("recebida: sem receber/cobrar/cancelar; recibo liberado (abre em nova aba)", async () => {
    await menu({ status: "RECEBIDO" });
    const ids = $$("[data-menu-acoes] [data-item]").map((i) => i.getAttribute("data-item"));
    expect(ids).toEqual(["detalhes", "editar", "recibo", "excluir"]);
    const r = itemMenu("recibo") as HTMLAnchorElement;
    expect(r.getAttribute("href")).toBe("/financeiro/contas-receber/cr1/recibo");
    expect(r.getAttribute("target")).toBe("_blank");
  });

  it("Ver detalhes chama a gaveta; item apagado não faz nada", async () => {
    const onDetalhes = await menu({ medicaoId: "m1" });
    await clicar(itemMenu("excluir"));
    expect($("[data-excluir-conta]")).toBeNull();
    expect(itemMenu("detalhes")).not.toBeNull(); // o menu segue aberto
    await clicar(itemMenu("detalhes"));
    expect(onDetalhes).toHaveBeenCalledTimes(1);
  });
});

describe("edição completa", () => {
  it("conta bancária e centro de custo vêm dos cadastros; manda só o que mudou; toast e refresh", async () => {
    await menu({ banco: "Itaú (texto antigo)", categoriaId: null });
    await clicar(itemMenu("editar"));
    const form = $("[data-editar-conta]")!;
    expect(form.querySelector('select[data-seletor-cadastro="contas-bancarias"]')).not.toBeNull();
    expect(form.querySelector('select[data-seletor-cadastro="centros-custo"]')).not.toBeNull();
    expect(txt($("[data-banco-antigo]"))).toBe("Banco informado antes: “Itaú (texto antigo)”.");
    expect(txt($("[data-origem-leitura]"))).toBe("Lançamento manual");
    await escolher(form.querySelector('select[data-seletor-cadastro="contas-bancarias"]'), "cb1");
    await escolher(form.querySelector('select[data-seletor-cadastro="centros-custo"]'), "cc1");
    await escolher(form.querySelector('select[aria-label="Forma de pagamento"]'), "PIX");
    await escolher($("[data-cliente-select]"), "c2");
    await clicar($("[data-salvar-conta]"));
    const [put] = enviados("PUT");
    expect(put.url).toBe("/api/contas-receber/cr1");
    expect(put.corpo).toEqual({
      descricao: "Manutenção corretiva", valor: 1234.56, dataVencimento: "2026-11-20", formaPagamento: "PIX", observacao: null,
      clienteId: "c2", centroCustoId: "cc1", contaBancariaId: "cb1",
    });
    expect(avisos.toast).toHaveBeenCalledWith("CR-2026-0042 atualizada.", "sucesso");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("de orçamento: cliente em leitura (com ⓘ) e a origem com link; boleto emitido trava valor e vencimento", async () => {
    await menu({ orcamentoId: "o1", orcamentoCodigo: "ORC-2026-0036", boletoStatus: "EMITIDO" });
    await clicar(itemMenu("editar"));
    expect(txt($("[data-cliente-leitura]"))).toBe("Hospital Santa Luzia");
    expect($("[data-cliente-select]")).toBeNull();
    expect($<HTMLAnchorElement>("[data-origem-leitura] a")!.getAttribute("href")).toBe("/orcamentos/o1");
    expect($<HTMLInputElement>('input[aria-label="Valor"]')!.disabled).toBe(true);
    expect(txt($("[data-trava-valor]"))).toBe("Boleto emitido: cancele o boleto para mudar.");
    expect(txt($("[data-trava-vencimento]"))).toBe("Boleto emitido: cancele o boleto para mudar.");
    await clicar($("[data-salvar-conta]"));
    const [put] = enviados("PUT");
    expect(put.corpo).not.toHaveProperty("valor");
    expect(put.corpo).not.toHaveProperty("dataVencimento");
    expect(put.corpo).not.toHaveProperty("clienteId");
    // Vínculo que não mudou não vai no corpo (não apaga o texto antigo de quem não tem cadastro ligado)
    expect(put.corpo).not.toHaveProperty("contaBancariaId");
    expect(put.corpo).not.toHaveProperty("centroCustoId");
    expect(put.corpo).not.toHaveProperty("categoriaId");
  });

  it("erro do servidor fica no modal (sem toast nem refresh)", async () => {
    respostas["PUT /api/contas-receber/"] = { status: 409, corpo: { erro: "Valor da nota fiscal emitida." } };
    await menu();
    await clicar(itemMenu("editar"));
    await clicar($("[data-salvar-conta]"));
    expect(txt($("[data-erro-conta]"))).toBe("Valor da nota fiscal emitida.");
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});

describe("receber, cancelar, excluir", () => {
  it("informar recebimento: valor da conta (sem campo 'valor recebido'), data, forma, conta bancária e comentário", async () => {
    await menu();
    await clicar(itemMenu("receber"));
    const m = $("[data-informar-recebimento]")!;
    expect(txt(m.querySelector("[data-valor-baixa]"))).toMatch(/R\$\s?1\.234,56/);
    expect(m.querySelector('input[type="number"]')).toBeNull();
    await escolher(m.querySelector('select[aria-label="Forma de pagamento"]'), "PIX");
    await escolher(m.querySelector('select[data-seletor-cadastro="contas-bancarias"]'), "cb1");
    await digitar(m.querySelector("textarea"), "Comprovante no e-mail");
    await clicar($("[data-confirmar-recebimento]"));
    const [put] = enviados("PUT");
    expect(put.corpo).toMatchObject({ status: "RECEBIDO", formaPagamento: "PIX", contaBancariaId: "cb1", comentario: "Comprovante no e-mail" });
    expect(put.corpo.dataRecebimento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(avisos.toast).toHaveBeenCalledWith("CR-2026-0042 recebida.", "sucesso");
  });

  it("cancelar exige motivo (sem chamar o servidor); com motivo, PUT CANCELADO", async () => {
    await menu();
    await clicar(itemMenu("cancelar"));
    await clicar($("[data-confirmar-cancelar]"));
    expect(enviados("PUT")).toEqual([]);
    expect(txt($("[data-erro-conta]"))).toBe("Informe o motivo do cancelamento.");
    await digitar($('textarea[aria-label="Motivo"]'), "Serviço não realizado");
    await clicar($("[data-confirmar-cancelar]"));
    expect(enviados("PUT")[0].corpo).toEqual({ status: "CANCELADO", motivoCancelamento: "Serviço não realizado" });
  });

  it("excluir: avisa que o registro fica e manda DELETE com o motivo", async () => {
    await menu();
    await clicar(itemMenu("excluir"));
    expect(txt($("[data-excluir-conta]"))).toContain("A conta sai da lista e dos totais. O registro e o histórico ficam guardados.");
    await digitar($('input[aria-label="Motivo"]'), "Duplicada");
    await clicar($("[data-confirmar-excluir]"));
    const [del] = enviados("DELETE");
    expect(del.url).toBe("/api/contas-receber/cr1");
    expect(del.corpo).toEqual({ motivo: "Duplicada" });
    expect(avisos.toast).toHaveBeenCalledWith("CR-2026-0042 excluída.", "sucesso");
  });
});

const DETALHE = {
  id: "cr1", numero: "CR-2026-0042", descricao: "Manutenção corretiva", valor: 1234.56, status: "A_RECEBER",
  dataVencimento: "2026-11-20T00:00:00.000Z", dataRecebimento: null, criadoEm: "2026-11-01T12:00:00.000Z",
  formaPagamento: "PIX", banco: "Inter PJ", observacao: "Ligar antes", canceladaEm: null, motivoCancelamento: null,
  categoria: null, categoriaFinanceira: null, centroCusto: { nome: "Obra", ativo: true }, contaBancaria: { nome: "Inter PJ", ativo: true },
  cliente: { id: "c1", nome: "Hospital Santa Luzia", cpfCnpj: "11222333000181" }, origem: "MEDICAO",
  medicao: { id: "m1", numero: "MED-2026-0003", relatorios: [{ id: "r1", numero: "REL-2026-0001" }] }, orcamento: null, contrato: null,
  ordens: [{ id: "os1", numero: "OS-2026-0101" }],
  itens: [{ descricao: "Troca de compressor", quantidade: 1, valorUnitario: 1234.56, valorTotal: 1234.56 }],
  boleto: { status: "EMITIDO", emitidoEm: "2026-11-02T12:00:00.000Z", vencimento: "2026-11-20T00:00:00.000Z", linhaDigitavel: "0779", temPdf: true },
  notas: [{ id: "n1", numero: "123", status: "CONCLUIDO" }],
  eventos: [{ id: "e1", tipo: "EDITADA", detalhe: "Observações alterada", criadoEm: "2026-11-03T12:00:00.000Z", usuario: "Ana" }],
};

describe("gaveta de detalhes e a lista", () => {
  const props = {
    contas: [{ ...base, medicaoId: "m1", medicaoNumero: "MED-2026-0003" }], clientes: CLIENTES, categorias: [], interAtivo: true,
    resumo: { aReceber: { v: 0, q: 0 }, vencido: { v: 0, q: 0 }, hoje: { v: 0, q: 0 }, recebido: { v: 0, q: 0 } },
    total: 1, totalFiltrado: 1234.56, pagina: 1, porPagina: 25,
    filtros: { q: "", card: "", clienteId: "", categoria: "", forma: "", banco: "", valorMin: "", valorMax: "", vencDe: "", vencAte: "", status: "", conta: "" },
  };

  it("?conta= abre a gaveta: origem com links (medição, OS), itens, documentos e histórico (com a criação)", async () => {
    respostas["GET /api/contas-receber/cr1"] = { status: 200, corpo: DETALHE };
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, { ...props, filtros: { ...props.filtros, conta: "cr1" } } as any));
    const g = $("[data-detalhes-conta=cr1]")!;
    expect(g).not.toBeNull();
    expect($$("[data-detalhe-origem] [data-vinculo]").map((a) => [a.getAttribute("href"), txt(a)])).toEqual([
      ["/financeiro/medicoes/m1", "Medição MED-2026-0003"], ["/ordens/os1", "OS OS-2026-0101"],
    ]);
    expect(txt($("[data-detalhe-origem]"))).toContain("Relatório REL-2026-0001");
    expect(txt($("[data-detalhe-itens]"))).toContain("Troca de compressor");
    expect($("[data-detalhe-boleto=EMITIDO]")).not.toBeNull();
    expect($("[data-detalhe-nota=CONCLUIDO]")!.getAttribute("href")).toBe("/financeiro/notas-fiscais?q=123");
    expect($$("[data-detalhe-historico] [data-evento]").map((e) => e.getAttribute("data-evento"))).toEqual(["EDITADA", "CRIADA"]);
    expect(txt($("[data-detalhe-historico]"))).toContain("Editada — Observações alterada");
  });

  it("descrição abre a gaveta; a origem aparece com link na linha; celular tem cartão com ⋮", async () => {
    respostas["GET /api/contas-receber/cr1"] = { status: 200, corpo: DETALHE };
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, props as any));
    expect($("[data-detalhes-conta]")).toBeNull();
    expect($<HTMLAnchorElement>("[data-origem-conta]")!.getAttribute("href")).toBe("/financeiro/medicoes/m1");
    const cartao = $("[data-cartao-conta=cr1]")!;
    expect(cartao.closest("[data-cartoes-receber]")!.className).toContain("md:hidden");
    expect(cartao.querySelector("[data-acao=menu]")).not.toBeNull();
    expect(txt(cartao)).toContain("Medição MED-2026-0003");
    await clicar($("[data-abrir-detalhes=cr1]"));
    expect($("[data-detalhes-conta=cr1]")).not.toBeNull();
    expect(chamadas.some((c) => c.url === "/api/contas-receber/cr1")).toBe(true);
  });

  it("conta excluída/inexistente: a gaveta avisa em vez de quebrar", async () => {
    respostas["GET /api/contas-receber/cr1"] = { status: 404, corpo: { erro: "Não encontrado" } };
    const { ContasReceberView } = await import("@/components/financeiro/contas-receber-view");
    await montar(createElement(ContasReceberView, { ...props, filtros: { ...props.filtros, conta: "cr1" } } as any));
    expect(txt($("[data-detalhes-conta] [role=alert]"))).toBe("Conta não encontrada (ou excluída).");
  });
});

describe("vínculo do outro lado (orçamento, medição, OS)", () => {
  it("'Conta a receber: CR-… (valor · situação)' com Abrir; sem permissão de Contas a receber, sem o link; vazio não aparece", async () => {
    const { ContasReceberVinculadas } = await import("@/components/financeiro/contas-receber-vinculadas");
    const contas = [{ id: "cr1", numero: "CR-2026-0042", valor: 1234.56, status: "PREVISTO", dataVencimento: null }];
    await montar(createElement(ContasReceberVinculadas, { contas, podeAbrir: true }));
    expect(txt($("[data-conta-vinculada=cr1]"))).toMatch(/^Conta a receber: CR-2026-0042 \(R\$\s?1\.234,56 · Previsto\)\s?Abrir$/);
    expect($("[data-abrir-conta=cr1]")!.getAttribute("href")).toBe("/financeiro/contas-receber?conta=cr1");
    act(() => root.unmount()); caixa.remove();
    await montar(createElement(ContasReceberVinculadas, { contas, podeAbrir: false }));
    expect($("[data-abrir-conta]")).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await montar(createElement(ContasReceberVinculadas, { contas: [], podeAbrir: true }));
    expect($("[data-contas-vinculadas]")).toBeNull();
  });
});
