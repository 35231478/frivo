// @vitest-environment happy-dom
/**
 * Tela central "Notas fiscais de serviço" num DOM de verdade (API simulada, URL simulada):
 *  - cards do período (valores, quantidades, "Em aberto" leva às medições, clique filtra a situação);
 *  - período ‹ › e intervalo personalizado; busca, situação e ambiente na URL;
 *  - tabela (desktop) e cartões (celular) com situação, motivo da rejeição, origem e ambiente;
 *  - menu ⋮: só as ações que funcionam no status (PDF/XML, reconsultar, reemitir, cancelar "em breve");
 *  - reconsultar (POST + atualiza), gaveta de detalhes (dados fiscais, discriminação, histórico);
 *  - menu lateral: "Notas fiscais" só com Financeiro › Fiscal.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes } from "@/lib/permissoes";
import type { DadosCentral, NotaLinha } from "@/lib/nfse/central-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), sp: "", path: "/financeiro/notas-fiscais" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: nav.push, back: () => {} }),
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.sp),
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
const avisos = vi.hoisted(() => ({ toasts: [] as [string, string][] }));
vi.mock("@/components/ui/avisos", () => ({ toast: (m: string, t = "sucesso") => { avisos.toasts.push([m, t]); }, confirmar: async () => true }));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string }[] = [];

beforeAll(async () => { await import("@/components/fiscal/notas-central"); }, 120_000);
beforeEach(() => {
  chamadas.length = 0; avisos.toasts = []; respostas = {};
  nav.replace.mockClear(); nav.refresh.mockClear(); nav.sp = ""; nav.path = "/financeiro/notas-fiscais";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo });
    const r = respostas[`${metodo} ${url}`] ?? { status: 404, corpo: { erro: "Nota não encontrada." } };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string, el: ParentNode = caixa) => el.querySelector(sel) as T | null;
const $$ = (sel: string, el: ParentNode = caixa) => [...el.querySelectorAll(sel)];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const ultimaUrl = () => String(nav.replace.mock.calls.at(-1)?.[0] ?? "");

const linha = (o: Partial<NotaLinha> & { id: string; status: NotaLinha["status"] }): NotaLinha => ({
  statusLabel: { ENVIANDO: "Enviando", PROCESSANDO: "Processando na prefeitura", CONCLUIDO: "Autorizada", REJEITADO: "Rejeitada", CANCELADO: "Cancelada", INTERROMPIDO: "Interrompida" }[o.status],
  numero: null, autorizadaEm: null, criadoEm: "2026-10-15T15:00:00.000Z", tomadorNome: "Hospital Santa Clara", tomadorCpfCnpj: "60701190000104",
  origem: "MEDICAO", medicaoId: "m1", medicaoNumero: "MED-2026-0009", medicaoRotulo: null, ordemServicoId: null, osNumero: null, valorServicos: 180,
  ambiente: "HOMOLOGACAO", motivo: null, temPdf: false, temXml: false, ...o,
});
const NOTAS: NotaLinha[] = [
  linha({ id: "nA", status: "CONCLUIDO", numero: "2026000122", autorizadaEm: "2026-10-16T13:00:00.000Z", temPdf: true, temXml: true }),
  linha({ id: "nB", status: "CONCLUIDO", numero: "2026000150", origem: "OS", ordemServicoId: "os1", osNumero: "OS-2026-8802", valorServicos: 1450, temPdf: false, temXml: true, ambiente: "PRODUCAO" }),
  linha({ id: "nC", status: "PROCESSANDO", valorServicos: 70 }),
  linha({ id: "nD", status: "REJEITADO", valorServicos: 300, motivo: "E-SP 105: o código de serviço 140601 não é permitido.", medicaoId: "m8", medicaoNumero: "MED-2026-0015" }),
  linha({ id: "nF", status: "CANCELADO", numero: "2026000100", valorServicos: 40 }),
];
const DADOS = (o: Partial<DadosCentral> = {}): DadosCentral => ({
  notas: NOTAS, total: NOTAS.length, pagina: 1, porPagina: 50,
  resumo: { aberto: { q: 2, v: 1500 }, transmissao: { q: 1, v: 70 }, emitidas: { q: 2, v: 1630 }, falha: { q: 1, v: 300 }, canceladas: { q: 1, v: 40 }, total: { q: 5, v: 1630 } },
  filtros: { q: "", situacao: "", ambiente: "", periodo: { tipo: "mes", mes: "2026-03", de: null, ate: null, rotulo: "Março de 2026" } },
  ...o,
});
async function tela(d: DadosCentral = DADOS()) {
  const { NotasCentralView } = await import("@/components/fiscal/notas-central");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(NotasCentralView, { dados: d })); });
  await esperar();
}
const linhaTabela = (id: string) => $(`[data-tabela] [data-nota="${id}"]`)!;
async function abrirMenu(id: string) {
  await clicar($('[data-acao="menu"]', linhaTabela(id)));
  return $("[data-menu-acoes]", document)!;
}
const itens = (menu: Element) => $$("[data-item]", menu).map((i) => [i.getAttribute("data-item"), i.hasAttribute("data-desabilitado")]);

describe("cards e cabeçalho", () => {
  it("título, os seis cards com valor e quantidade; 'Em aberto' leva às medições aprovadas", async () => {
    await tela();
    expect(txt($("h1"))).toBe("Notas fiscais de serviço");
    const card = (id: string) => [txt($(`[data-card="${id}"] [data-card-valor]`)), txt($(`[data-card="${id}"] [data-card-qtd]`))];
    expect(card("aberto")).toEqual(["R$ 1.500,00", "2 medições"]);
    expect(card("transmissao")).toEqual(["R$ 70,00", "1 nota"]);
    expect(card("emitidas")).toEqual(["R$ 1.630,00", "2 notas"]);
    expect(card("falha")).toEqual(["R$ 300,00", "1 nota"]);
    expect(card("canceladas")).toEqual(["R$ 40,00", "1 nota"]);
    expect(card("total")).toEqual(["R$ 1.630,00", "5 notas no período"]);
    expect($('[data-card="aberto"]')!.getAttribute("href")).toBe("/financeiro/medicoes?status=PC_RECEBIDO");
    expect($('[data-card="total"]')!.tagName).toBe("DIV"); // não clicável
  });

  it("clicar num card filtra a situação; clicar de novo tira o filtro", async () => {
    await tela();
    await clicar($('[data-card="falha"]'));
    expect(ultimaUrl()).toBe("/financeiro/notas-fiscais?situacao=falha");
    await act(async () => root.unmount()); caixa.remove();
    await tela(DADOS({ filtros: { ...DADOS().filtros, situacao: "falha" } }));
    expect($('[data-card="falha"]')!.getAttribute("aria-pressed")).toBe("true");
    nav.sp = "situacao=falha";
    await clicar($('[data-card="falha"]'));
    expect(ultimaUrl()).toBe("/financeiro/notas-fiscais");
  });

  it("dica ⓘ: texto curto ao tocar (sem bloco de texto na tela)", async () => {
    await tela();
    const botao = $('[data-card-caixa="aberto"] [data-dica]')!;
    await clicar(botao);
    const balao = document.getElementById(botao.getAttribute("aria-describedby")!)!;
    expect([balao.hidden, txt(balao), botao.getAttribute("aria-label")]).toEqual([false, "Medições aprovadas no período (pedido de compra recebido) ainda sem NFS-e.", "Ajuda: Em aberto"]);
  });
});

describe("período, busca e filtros (na URL)", () => {
  it("‹ › troca o mês; o mês corrente sai da URL", async () => {
    await tela();
    expect(txt($("[data-mes-rotulo]"))).toBe("Março de 2026");
    await clicar($("[data-mes-anterior]"));
    expect(ultimaUrl()).toBe("/financeiro/notas-fiscais?mes=2026-02");
    await clicar($("[data-mes-seguinte]"));
    expect(ultimaUrl()).toBe("/financeiro/notas-fiscais?mes=2026-04");
    expect($("[data-todo-periodo]")).toBeNull(); // "Todo o período" só onde a tela permite (Contas a Receber)
  });

  it("período personalizado: de/até → Aplicar (sai o mês); 'Voltar ao mês atual' limpa", async () => {
    nav.sp = "mes=2026-03";
    await tela();
    await clicar($("[data-alternar-periodo]"));
    const campos = $$('[data-intervalo] [data-input-data]') as HTMLInputElement[];
    expect(campos).toHaveLength(2);
    expect(($("[data-aplicar-intervalo]") as HTMLButtonElement).disabled).toBe(true);
    const digitar = async (el: HTMLInputElement, v: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    await digitar(campos[0], "05/03/2026");
    await digitar(campos[1], "20/03/2026");
    await esperar();
    await clicar($("[data-aplicar-intervalo]"));
    expect(ultimaUrl()).toBe("/financeiro/notas-fiscais?de=2026-03-05&ate=2026-03-20");
    await clicar($("[data-alternar-periodo]"));
    expect(ultimaUrl()).toBe("/financeiro/notas-fiscais");
  });

  it("intervalo ativo: mostra o rótulo e já abre nos campos", async () => {
    await tela(DADOS({ filtros: { ...DADOS().filtros, periodo: { tipo: "intervalo", mes: null, de: "2026-03-05", ate: "2026-03-20", rotulo: "05/03/2026 a 20/03/2026" } } }));
    expect($("[data-periodo]")!.getAttribute("data-periodo")).toBe("intervalo");
    expect(txt($("[data-periodo-rotulo]"))).toBe("05/03/2026 a 20/03/2026");
    expect(($$('[data-intervalo] [data-input-data]') as HTMLInputElement[]).map((i) => i.value)).toEqual(["05/03/2026", "20/03/2026"]);
  });

  it("busca ao vivo (debounce) e os selects de situação e ambiente", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await tela();
    const busca = $("[data-busca]") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(busca, "Hospital");
      busca.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(ultimaUrl()).toBe("/financeiro/notas-fiscais?q=Hospital");
    vi.useRealTimers();
    const sel = async (s: string, v: string) => act(async () => {
      const el = $(s) as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await sel("[data-filtro-situacao]", "transmissao");
    expect(ultimaUrl()).toContain("situacao=transmissao");
    await sel("[data-filtro-ambiente]", "PRODUCAO");
    expect(ultimaUrl()).toContain("ambiente=PRODUCAO");
    expect($$("[data-filtro-situacao] option").map(txt)).toEqual(["Todas as situações", "Em transmissão", "Emitidas", "Com falha", "Canceladas"]);
  });

  it("vazio: mensagem do período e 'Limpar busca'", async () => {
    await tela(DADOS({ notas: [], total: 0, filtros: { ...DADOS().filtros, q: "xyz" } }));
    expect(txt($("[data-lista-vazia]"))).toContain("Nenhuma nota em março de 2026");
    await clicar([...caixa.querySelectorAll("button")].find((b) => txt(b) === "Limpar busca")!);
    expect(ultimaUrl()).toBe("/financeiro/notas-fiscais");
  });
});

describe("lista", () => {
  it("tabela: situação, número, data, tomador, origem (OS ou medição), valor e ambiente", async () => {
    await tela();
    const a = linhaTabela("nA");
    expect(txt($("[data-situacao]", a))).toBe("Autorizada");
    expect($("[data-situacao]", a)!.getAttribute("data-tom")).toBe("ok");
    expect(txt(a)).toContain("2026000122");
    expect(txt(a)).toContain("16/10/2026"); // data da autorização
    expect(txt(a)).toContain("60.701.190/0001-04");
    expect($("[data-origem] a", a)!.getAttribute("href")).toBe("/financeiro/medicoes/m1");
    expect(txt($("[data-valor]", a))).toBe("180,00"); // planilha: R$ no cabeçalho, número à direita e tabular
    expect($("[data-valor]", a)!.className).toContain("tabular-nums");
    expect($("[data-tabela]")!.className).toContain("text-[13px]");
    expect([...caixa.querySelectorAll("[data-tabela] th")].map((t) => txt(t))).toContain("Valor (R$)");
    const b = linhaTabela("nB");
    // emitida pela OS: a OS em destaque e a medição (por onde a nota saiu) embaixo
    expect($$("[data-origem] a", b).map((l) => [txt(l), l.getAttribute("href")])).toEqual([["OS OS-2026-8802", "/ordens/os1"], ["Medição MED-2026-0009", "/financeiro/medicoes/m1"]]);
    expect(txt($("[data-ambiente]", b))).toBe("Produção");
    expect(txt(linhaTabela("nC"))).toContain("15/10/2026"); // ainda não autorizada: a data do envio
    expect($("[data-situacao]", linhaTabela("nC"))!.getAttribute("data-tom")).toBe("atencao");
  });

  it("rejeitada: o motivo aparece na linha", async () => {
    await tela();
    const d = linhaTabela("nD");
    expect($("[data-situacao]", d)!.getAttribute("data-tom")).toBe("atrasado");
    expect(txt($("[data-motivo]", d))).toBe("E-SP 105: o código de serviço 140601 não é permitido.");
  });

  it("celular: as mesmas notas em cartões (sem tabela cortada)", async () => {
    await tela();
    expect($$("[data-cartoes] [data-nota]").map((e) => e.getAttribute("data-nota"))).toEqual(["nA", "nB", "nC", "nD", "nF"]);
    expect($("[data-tabela]")!.closest(".hidden.md\\:block")).toBeTruthy();
    expect($("[data-cartoes]")!.className).toContain("md:hidden");
    expect($('[data-cartoes] [data-nota="nD"] [data-acao="menu"]')).toBeTruthy();
  });

  it("paginação no padrão", async () => {
    await tela(DADOS({ total: 120, pagina: 2, porPagina: 50 }));
    expect(txt($("[data-faixa]"))).toBe("Mostrando 51–100 de 120 notas");
    await clicar($("[data-pagina-proxima]"));
    expect(ultimaUrl()).toBe("/financeiro/notas-fiscais?pagina=3");
  });
});

describe("ações por status (menu ⋮)", () => {
  it("autorizada com PDF e XML: ver, abrir origem, baixar PDF/XML; cancelar desabilitado 'em breve'", async () => {
    await tela();
    const m = await abrirMenu("nA");
    expect(itens(m)).toEqual([["detalhes", false], ["origem", false], ["pdf", false], ["xml", false], ["cancelar", true]]);
    expect($('[data-item="pdf"]', m)!.getAttribute("href")).toBe("/api/fiscal/notas/nA/arquivo?tipo=pdf");
    expect($('[data-item="pdf"]', m)!.getAttribute("target")).toBe("_blank");
    expect($('[data-item="xml"]', m)!.getAttribute("href")).toBe("/api/fiscal/notas/nA/arquivo?tipo=xml");
    expect(txt($('[data-item="origem"]', m))).toBe("Abrir medição MED-2026-0009");
    expect($('[data-item="cancelar"]', m)!.getAttribute("title")).toBe("Em breve: o cancelamento pelo PlugNotas ainda não está disponível.");
    expect($('[data-item="cancelar"]', m)!.tagName).toBe("SPAN"); // não é botão: não faz nada quebrado
  });

  it("autorizada sem o PDF no PlugNotas: PDF desabilitado com o motivo; XML disponível; origem = OS", async () => {
    await tela();
    const m = await abrirMenu("nB");
    expect(itens(m)).toEqual([["detalhes", false], ["origem", false], ["pdf", true], ["xml", false], ["cancelar", true]]);
    expect($('[data-item="pdf"]', m)!.getAttribute("title")).toBe("O PlugNotas ainda não disponibilizou o PDF desta nota.");
    expect($('[data-item="pdf"]', m)!.hasAttribute("href")).toBe(false);
    expect([txt($('[data-item="origem"]', m)), $('[data-item="origem"]', m)!.getAttribute("href")]).toEqual(["Abrir OS OS-2026-8802", "/ordens/os1"]);
  });

  it("em processamento: reconsultar; PDF/XML desabilitados; sem cancelar", async () => {
    await tela();
    const m = await abrirMenu("nC");
    expect(itens(m)).toEqual([["detalhes", false], ["origem", false], ["pdf", true], ["xml", true], ["reconsultar", false]]);
    expect($('[data-item="xml"]', m)!.getAttribute("title")).toBe("Disponível após a autorização da nota.");
  });

  it("rejeitada: corrigir e reemitir (abre a emissão na medição); sem cancelar nem reconsultar", async () => {
    await tela();
    const m = await abrirMenu("nD");
    expect(itens(m)).toEqual([["detalhes", false], ["origem", false], ["pdf", true], ["xml", true], ["reemitir", false]]);
    expect($('[data-item="reemitir"]', m)!.getAttribute("href")).toBe("/financeiro/medicoes/m8?nfse=emitir#nfse");
  });

  it("cancelada: só ver e abrir a origem (arquivos desabilitados)", async () => {
    await tela();
    const m = await abrirMenu("nF");
    expect(itens(m)).toEqual([["detalhes", false], ["origem", false], ["pdf", true], ["xml", true]]);
  });

  it("o menu nunca sai da tela: perto do rodapé abre para cima; no alto, para baixo", async () => {
    await tela();
    const botao = $('[data-acao="menu"]', linhaTabela("nF"))!;
    const altura = window.innerHeight;
    botao.getBoundingClientRect = () => ({ top: altura - 60, bottom: altura - 30, right: 900, left: 870, width: 30, height: 30, x: 870, y: altura - 60, toJSON: () => ({}) });
    await clicar(botao);
    let m = $("[data-menu-acoes]", document) as HTMLElement;
    expect([m.style.top, m.style.bottom]).toEqual(["", "64px"]);
    await clicar(m.previousElementSibling);
    botao.getBoundingClientRect = () => ({ top: 100, bottom: 130, right: 900, left: 870, width: 30, height: 30, x: 870, y: 100, toJSON: () => ({}) });
    await clicar(botao);
    m = $("[data-menu-acoes]", document) as HTMLElement;
    expect([m.style.top, m.style.bottom]).toEqual(["134px", ""]);
  });

  it("tabela larga: rola por dentro e a coluna de ações fica fixa à direita", async () => {
    await tela();
    expect($("[data-tabela-rolagem]")!.className).toContain("overflow-x-auto");
    expect($$("[data-celula-acoes]").every((c) => c.className.includes("sticky") && c.className.includes("right-0"))).toBe(true);
    // O menu sai da célula fixa (que cria camada própria): vai direto no body, por cima das outras linhas
    const m = await abrirMenu("nA");
    expect(m.parentElement).toBe(document.body);
    expect(m.closest("[data-celula-acoes]")).toBeNull();
  });

  it("menu fecha ao clicar fora", async () => {
    await tela();
    await abrirMenu("nA");
    await clicar($("[data-menu-acoes]", document)!.previousElementSibling);
    expect($("[data-menu-acoes]", document)).toBeNull();
  });

  it("reconsultar: POST na consulta, aviso com o resultado e a lista atualiza; erro vira aviso", async () => {
    respostas["POST /api/fiscal/notas/nC/consultar"] = { status: 200, corpo: { id: "nC", status: "CONCLUIDO" } };
    await tela();
    const m = await abrirMenu("nC");
    await clicar($('[data-item="reconsultar"]', m));
    expect(chamadas).toEqual([{ url: "/api/fiscal/notas/nC/consultar", metodo: "POST" }]);
    expect(avisos.toasts).toEqual([["Nota autorizada.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    respostas["POST /api/fiscal/notas/nC/consultar"] = { status: 502, corpo: { erro: "O PlugNotas não respondeu a tempo. Tente de novo." } };
    await clicar($('[data-item="reconsultar"]', await abrirMenu("nC")));
    expect(avisos.toasts.at(-1)).toEqual(["O PlugNotas não respondeu a tempo. Tente de novo.", "erro"]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("gaveta de detalhes", () => {
  const DETALHE = {
    ...linha({ id: "nD", status: "REJEITADO", valorServicos: 300, motivo: "E-SP 105: o código de serviço 140601 não é permitido.", medicaoId: "m8", medicaoNumero: "MED-2026-0015" }),
    codigoVerificacao: null, protocolo: "b0c1-0001", codigoLc116: "14.06", codigoTributacao: "140601", aliquotaIss: 5, issRetido: false,
    valorDesconto: 30, discriminacao: "Instalação de equipamento de ar-condicionado. | Instalação split 18k", emitidaPor: "Administrador",
    contaReceber: { id: "cr1", numero: "CR-2026-0091" },
    itens: [{ descricao: "Instalação split 18k", quantidade: 1, valorTotal: 300, valorDesconto: 30 }],
    eventos: [
      { tipo: "STATUS", status: "REJEITADO", mensagem: "E-SP 105: o código de serviço 140601 não é permitido.", criadoEm: "2026-10-15T15:01:00.000Z", usuario: null },
      { tipo: "ENVIO", status: "PROCESSANDO", mensagem: "Enviada ao PlugNotas (Homologação (testes)).", criadoEm: "2026-10-15T15:00:00.000Z", usuario: "Administrador" },
    ],
  };

  it("abre pelo olho: motivo, dados fiscais, valores, discriminação, itens, histórico e ações do status", async () => {
    respostas["GET /api/fiscal/notas/nD"] = { status: 200, corpo: DETALHE };
    await tela();
    await clicar($('[data-acao="detalhes"]', linhaTabela("nD")));
    expect(chamadas).toEqual([{ url: "/api/fiscal/notas/nD", metodo: "GET" }]);
    const g = $("[data-gaveta-nota]", document.body)!;
    expect(txt($("[data-gaveta-motivo]", g))).toBe("Motivo da rejeiçãoE-SP 105: o código de serviço 140601 não é permitido.");
    expect(txt(g)).toContain("Código municipal140601");
    expect(txt(g)).toContain("Alíquota do ISS5%");
    expect(txt(g)).toContain("Valor líquidoR$ 270,00");
    expect(txt($("[data-gaveta-discriminacao]", g))).toBe("Instalação de equipamento de ar-condicionado. | Instalação split 18k");
    expect($$("[data-gaveta-historico] li", g).map(txt)).toEqual([
      "15/10/2026 às 12:01 · SistemaE-SP 105: o código de serviço 140601 não é permitido.",
      "15/10/2026 às 12:00 · AdministradorEnviada ao PlugNotas (Homologação (testes)).",
    ]);
    const acoes = $("[data-gaveta-acoes]", document.body)!;
    expect($$("[data-gaveta]", acoes).map((a) => a.getAttribute("data-gaveta"))).toEqual(["reemitir", "origem"]);
    expect($('[data-gaveta="reemitir"]', acoes)!.getAttribute("href")).toBe("/financeiro/medicoes/m8?nfse=emitir#nfse");
  });

  it("autorizada: PDF/XML e origem no rodapé; nota não encontrada vira aviso", async () => {
    respostas["GET /api/fiscal/notas/nA"] = { status: 200, corpo: { ...DETALHE, ...linha({ id: "nA", status: "CONCLUIDO", numero: "2026000122", temPdf: true, temXml: true }), motivo: null } };
    await tela();
    await clicar($('[data-acao="detalhes"]', linhaTabela("nA")));
    expect($$("[data-gaveta-acoes] [data-gaveta]", document.body).map((a) => a.getAttribute("data-gaveta"))).toEqual(["pdf", "xml", "origem"]);
    expect($("[data-gaveta-motivo]", document.body)).toBeNull();
    await act(async () => root.unmount()); caixa.remove();
    await tela();
    await clicar($('[data-acao="detalhes"]', linhaTabela("nC")));
    expect(txt($("[data-gaveta-erro]", document.body))).toBe("Nota não encontrada.");
  });

  it("enviando com aviso do envio (sem resposta ainda): não aparece como 'motivo da rejeição'; reconsultar no rodapé", async () => {
    respostas["GET /api/fiscal/notas/nC"] = { status: 200, corpo: { ...DETALHE, ...linha({ id: "nC", status: "ENVIANDO" }), motivo: "O PlugNotas não respondeu a tempo. Consultando o status…" } };
    await tela();
    await clicar($('[data-acao="detalhes"]', linhaTabela("nC")));
    expect($("[data-gaveta-nota]", document.body)).toBeTruthy();
    expect($("[data-gaveta-motivo]", document.body)).toBeNull();
    expect($$("[data-gaveta-acoes] [data-gaveta]", document.body).map((a) => a.getAttribute("data-gaveta"))).toEqual(["reconsultar", "origem"]);
  });
});

describe("menu lateral", () => {
  // Montado no DOM: a vista (Operacional/Financeiro) segue a rota num efeito
  const menu = async (permissoes: ReturnType<typeof montarPermissoes>) => {
    const { Sidebar } = await import("@/components/layout/sidebar");
    caixa?.remove();
    caixa = document.createElement("div");
    document.body.appendChild(caixa);
    root = createRoot(caixa);
    await act(async () => { root.render(createElement(Sidebar, { session: { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role: "OPERADOR", permissoes } } as any })); });
    await esperar();
    const html = caixa.innerHTML;
    await act(async () => root.unmount());
    return html;
  };
  it("'Notas fiscais' em Financeiro › Fiscal, só com a permissão Fiscal", async () => {
    nav.path = "/financeiro/notas-fiscais";
    const com = await menu(montarPermissoes({ financeiro: ["visualizar", "fiscal"] }));
    expect(com).toContain('href="/financeiro/notas-fiscais"');
    expect(com).toContain(">Notas fiscais<");
    const sem = await menu(montarPermissoes({ financeiro: ["visualizar", "medicoes"] }));
    expect(sem).not.toContain('href="/financeiro/notas-fiscais"');
  });
});
