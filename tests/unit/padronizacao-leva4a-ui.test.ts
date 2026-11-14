// @vitest-environment happy-dom
/**
 * PADRONIZAÇÃO — LEVA 4A: Clientes, Equipamentos e QR Codes montados de verdade (DOM real, API simulada).
 *
 * PRIORIDADE Nº 1 — botão destrutivo (Inativar) ou de ação sensível só aparece para quem pode:
 *  - QR Codes: quem só visualiza vê a lista e imprime; Gerar, Vincular, Desvincular, Inativar e Reativar
 *    só com QR Codes › gerenciar;
 *  - Clientes: lápis com "editar" (olho sem), Inativar com "excluir", Reativar com "editar";
 *  - Equipamentos: editar/QR com "editar", Inativar com "excluir", Reativar com "editar", Novo com "criar";
 *  - se o servidor recusa (403), a TELA NÃO MUDA (nada de atualizar a lista) e o motivo aparece;
 *  - cancelar a confirmação não grava nada.
 *
 * PADRÃO: as três listas na tabela da casa (TabelaPro) com cartões no celular; toast em toda gravação;
 * instrução no ⓘ; vocabulário (Pesquisar, Inativar) e nada de tabela própria.
 *
 * SUGESTÃO INTELIGENTE: no cadastro rápido de cliente, "Consultar" puxa razão social, fantasia e
 * telefone pelo CNPJ — só nos campos vazios, dizendo de onde veio, e tudo continua editável.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { aplicarSugestao, cnpjCompleto, digitosDoDocumento, notaDaSugestao, sugestaoDoCnpj } from "@/lib/cadastros/autofill-cnpj";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/qrcodes", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => {
  const real = await original<typeof import("@/components/ui/avisos")>();
  return { ...real, toast: vi.fn(real.toast) };
});

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

let root: Root, caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown; texto?: string }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const $ = <T extends Element = HTMLElement>(sel: string, dentro: ParentNode = document) => dentro.querySelector(sel) as T | null;
const $$ = (sel: string, dentro: ParentNode = document) => [...dentro.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (t: string, dentro: ParentNode = document) => [...dentro.querySelectorAll("button")].filter((b) => txt(b) === t).at(-1) ?? null;
async function digitar(el: Element | null | undefined, v: string) {
  expect(el, "campo a preencher").toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(el: Element | null | undefined, v: string) {
  expect(el, "select a mudar").toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function montar(el: ReactElement, permissoes: Permissoes) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { Avisos } = await import("@/components/ui/avisos");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: [createElement("div", { key: "tela" }, el), createElement(Avisos, { key: "avisos" })] })); });
  await esperar();
}
const toasts = async () => vi.mocked((await import("@/components/ui/avisos")).toast).mock.calls.map((c) => [c[0], c[1] ?? "sucesso"]);
/** O que foi para as rotas da tela (a tabela também lê e grava a preferência de colunas do usuário) */
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET" && !c.url.startsWith("/api/preferencias"));
const consultas = () => chamadas.filter((c) => c.url.startsWith("/api/cnpj"));
const confirmacao = () => $("[data-confirmacao]");
const dica = (rotulo: string, dentro: ParentNode = document) => {
  const b = $(`[data-dica][aria-label="Ajuda: ${rotulo}"]`, dentro);
  return b ? txt(document.getElementById(b.getAttribute("aria-describedby") ?? "")) : null;
};

beforeAll(async () => {
  // Um de cada vez, com os avisos primeiro: importar em paralelo cria duas cópias do módulo simulado e
  // o teste passaria a ler um `toast` que não é o da tela
  await import("@/components/ui/avisos");
  for (const m of [
    () => import("@/components/providers/permissoes-provider"), () => import("@/app/(dashboard)/qrcodes/qrcodes-client"), () => import("@/app/(dashboard)/qrcodes/imprimir/imprimir-client"),
    () => import("@/components/clientes/cliente-acoes"), () => import("@/components/equipamentos/equipamento-ativo-botao"), () => import("@/components/equipamentos/gerar-qr-botao"),
    () => import("@/components/forms/equipamento-qr-section"), () => import("@/app/(dashboard)/equipamentos/equipamentos-lista-client"), () => import("@/components/ui/select-cadastro-rapido"),
    () => import("@/components/cadastro-rapido/definicoes"),
  ]) await m();
}, 120_000);
beforeEach(async () => {
  chamadas.length = 0; respostas = {}; nav.refresh.mockClear(); nav.push.mockClear();
  vi.mocked((await import("@/components/ui/avisos")).toast).mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).find((k) => { const [m, u] = k.split(" "); return m === metodo && url.split("?")[0] === u; });
    const r = chave ? respostas[chave] : { status: 200, corpo: {} };
    return new Response(r.texto ?? JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": r.texto === undefined ? "application/json" : "text/html" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

/* ═════════ QR Codes ═════════ */
describe("QR Codes (lista)", () => {
  const GERENCIA = montarPermissoes({ qrcodes: ["visualizar", "gerenciar"] });
  const SO_VE = montarPermissoes({ qrcodes: ["visualizar"] });
  const LISTA = [
    { id: "q1", codigo: "QR-101", ativo: true, criadoEm: "2026-11-10T12:00:00.000Z", equipamento: { id: "e1", nome: "LG S4-W12", local: "Matriz" } },
    { id: "q2", codigo: "QR-102", ativo: true, criadoEm: "2026-11-11T12:00:00.000Z", equipamento: null },
    { id: "q3", codigo: "QR-103", ativo: false, criadoEm: "2026-11-12T12:00:00.000Z", equipamento: null },
  ];
  async function abrir(permissoes: Permissoes, lista = LISTA) {
    const { QrcodesClient } = await import("@/app/(dashboard)/qrcodes/qrcodes-client");
    await montar(createElement(QrcodesClient, { lista, equipamentosLivres: [{ id: "e2", nome: "Daikin FTXS" }, { id: "e3", nome: "Carrier 30XA" }], proximoCodigo: "QR-104" }), permissoes);
  }
  const linhas = () => $$("tr[data-qr]").map((l) => l.getAttribute("data-qr"));
  const naLinha = (id: string, sel: string) => $(`tr[data-qr="${id}"] ${sel}`);

  it("quem só visualiza: vê a lista e imprime; sem Gerar, Vincular, Desvincular, Inativar nem Reativar", async () => {
    await abrir(SO_VE);
    expect(linhas()).toEqual(["q1", "q2", "q3"]);
    expect($("[data-gerar-qr]")).toBeNull();
    for (const sel of ["[data-vincular-qr]", "[data-desvincular-qr]", "[data-alternar-qr]"]) expect([sel, $$(sel).length]).toEqual([sel, 0]);
    // imprimir é leitura: fica para todos, na tabela e nos cartões do celular
    expect($$("tr[data-qr] [data-imprimir-qr]").map((a) => a.getAttribute("href"))).toEqual(["/qrcodes/imprimir?ids=q1", "/qrcodes/imprimir?ids=q2", "/qrcodes/imprimir?ids=q3"]);
    expect($$("[data-cartao] [data-imprimir-qr]")).toHaveLength(3);
  });

  it("quem gerencia: cada linha tem a ação que cabe (vinculada: desvincular; livre: vincular; ativa: inativar; inativa: reativar)", async () => {
    await abrir(GERENCIA);
    expect($("[data-gerar-qr]")).toBeTruthy();
    expect(naLinha("q1", "[data-desvincular-qr]")).toBeTruthy();
    expect(naLinha("q1", "[data-vincular-qr]")).toBeNull();
    expect(naLinha("q2", "[data-vincular-qr]")).toBeTruthy();
    expect(naLinha("q2", "[data-desvincular-qr]")).toBeNull();
    expect($$("tr[data-qr] [data-alternar-qr]").map((b) => b.getAttribute("aria-label"))).toEqual(["Inativar QR-101", "Inativar QR-102", "Reativar QR-103"]);
    // os cartões do celular trazem as mesmas ações
    expect($$("[data-cartao] [data-alternar-qr]").map((b) => b.getAttribute("aria-label"))).toEqual(["Inativar QR-101", "Inativar QR-102", "Reativar QR-103"]);
    expect($$("[data-cartao] [data-desvincular-qr], [data-cartao] [data-vincular-qr]")).toHaveLength(3);
  });

  it("padrão de lista: tabela da casa, cartões no celular, contador, ⓘ no título e sem parágrafo de instrução", async () => {
    await abrir(GERENCIA);
    expect($('[data-tabela-pro="qrcodes"]')).toBeTruthy();
    expect($$("[data-cartoes] [data-cartao]").map((c) => c.getAttribute("data-cartao"))).toEqual(["q1", "q2", "q3"]);
    expect(txt($("[data-total-qr]"))).toBe("3");
    expect(txt($("[data-contagem-qr]"))).toBe("3 de 3");
    expect(dica("QR Codes")).toContain("pode ser reativada");
    expect($$("[data-qrcodes] p").filter((p) => txt(p).length > 60)).toEqual([]);
    expect(txt($('tr[data-qr="q3"] [data-status-qr]'))).toBe("Inativo");
    expect(txt($('tr[data-qr="q2"]'))).toContain("Não vinculado");
  });

  it("pesquisa e filtros: por código ou equipamento, por vínculo e por status; sem resultado, o estado vazio", async () => {
    await abrir(GERENCIA);
    await digitar($("[data-busca]"), "lg s4");
    expect(linhas()).toEqual(["q1"]);
    expect(txt($("[data-contagem-qr]"))).toBe("1 de 3");
    await digitar($("[data-busca]"), "qr-10");
    expect(linhas()).toEqual(["q1", "q2", "q3"]);
    await escolher($("[data-filtro-vinculo]"), "nao");
    expect(linhas()).toEqual(["q2", "q3"]);
    await escolher($("[data-filtro-status]"), "inativo");
    expect(linhas()).toEqual(["q3"]);
    await escolher($("[data-filtro-vinculo]"), "vinculado");
    expect(linhas()).toEqual([]);
    expect(txt($("[data-lista-vazia]"))).toContain("Nenhum QR Code encontrado");
  });

  it("desvincular: confirma, grava { equipamentoId: null }, avisa e atualiza a lista", async () => {
    await abrir(GERENCIA);
    await clicar(naLinha("q1", "[data-desvincular-qr]"));
    expect(txt(confirmacao())).toContain("Desvincular a etiqueta QR-101?");
    expect(txt(confirmacao())).toContain("LG S4-W12 e o histórico não mudam");
    expect(gravacoes()).toEqual([]);
    await clicar($("[data-confirmar-sim]"));
    expect(gravacoes()).toEqual([{ url: "/api/qrcodes/q1", metodo: "PATCH", corpo: { equipamentoId: null } }]);
    expect(await toasts()).toEqual([["Etiqueta QR-101 desvinculada.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("cancelar a confirmação não grava nada (desvincular e inativar)", async () => {
    await abrir(GERENCIA);
    await clicar(naLinha("q1", "[data-desvincular-qr]"));
    await clicar($("[data-confirmar-nao]"));
    await clicar(naLinha("q1", "[data-alternar-qr]"));
    expect(txt(confirmacao())).toContain("Inativar a etiqueta QR-101?");
    await clicar($("[data-confirmar-nao]"));
    expect(gravacoes()).toEqual([]);
    expect(await toasts()).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("inativar pede confirmação e grava { ativo: false }; reativar vai direto com { ativo: true }", async () => {
    await abrir(GERENCIA);
    await clicar(naLinha("q2", "[data-alternar-qr]"));
    await clicar($("[data-confirmar-sim]"));
    await clicar(naLinha("q3", "[data-alternar-qr]"));
    expect(confirmacao()).toBeNull();
    expect(gravacoes()).toEqual([
      { url: "/api/qrcodes/q2", metodo: "PATCH", corpo: { ativo: false } },
      { url: "/api/qrcodes/q3", metodo: "PATCH", corpo: { ativo: true } },
    ]);
    expect(await toasts()).toEqual([["Etiqueta QR-102 inativada.", "sucesso"], ["Etiqueta QR-103 reativada.", "sucesso"]]);
  });

  it("o servidor recusa (403): a tela não muda — sem atualizar a lista, sem aviso de sucesso, com o motivo", async () => {
    respostas["PATCH /api/qrcodes/q1"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await abrir(GERENCIA);
    const antes = $("[data-qrcodes]")!.innerHTML;
    await clicar(naLinha("q1", "[data-alternar-qr]"));
    await clicar($("[data-confirmar-sim]"));
    expect(await toasts()).toEqual([["Sem permissão para esta ação", "erro"]]);
    expect(nav.refresh).not.toHaveBeenCalled();
    expect($("[data-qrcodes]")!.innerHTML).toBe(antes);
  });

  it("resposta de erro que não é JSON (queda do servidor) não derruba a tela: mostra o texto de reserva", async () => {
    respostas["PATCH /api/qrcodes/q1"] = { status: 502, corpo: null, texto: "<html>Bad Gateway</html>" };
    await abrir(GERENCIA);
    await clicar(naLinha("q1", "[data-desvincular-qr]"));
    await clicar($("[data-confirmar-sim]"));
    expect(await toasts()).toEqual([["Não foi possível desvincular a etiqueta.", "erro"]]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("gerar: mostra a prévia a partir do contador, grava a quantidade, avisa e atualiza", async () => {
    await abrir(GERENCIA);
    await clicar($("[data-gerar-qr]"));
    await digitar($("[data-quantidade]"), "5");
    expect(txt($("[data-previa-codigos]"))).toContain("QR-104QR-105QR-106… até QR-108");
    await clicar($("[data-confirmar-gerar]"));
    expect(gravacoes()).toEqual([{ url: "/api/qrcodes", metodo: "POST", corpo: { quantidade: 5 } }]);
    expect(await toasts()).toEqual([["5 QR Codes gerados.", "sucesso"]]);
    expect($("[data-modal-gerar]")).toBeNull();
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("gerar recusado: o erro aparece no próprio diálogo, que continua aberto, e a lista não atualiza", async () => {
    respostas["POST /api/qrcodes"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await abrir(GERENCIA);
    await clicar($("[data-gerar-qr]"));
    await clicar($("[data-confirmar-gerar]"));
    expect(txt($("[data-erro-gerar]"))).toBe("Sem permissão para esta ação");
    expect($("[data-modal-gerar]")).toBeTruthy();
    expect(await toasts()).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("vincular: escolhe um equipamento sem etiqueta, grava, avisa e atualiza; sem escolher, não grava", async () => {
    await abrir(GERENCIA);
    await clicar(naLinha("q2", "[data-vincular-qr]"));
    const modal = $("[data-modal-vincular]")!;
    await clicar($("[data-confirmar-vincular]"));
    expect(txt($("[data-erro-vincular]"))).toBe("Selecione um equipamento.");
    expect(gravacoes()).toEqual([]);
    // a lista fica dentro do diálogo (no celular, o seletor suspenso era cortado pela moldura) e a pesquisa filtra
    expect($$("[data-opcao-equipamento]", modal).map(txt)).toEqual(["Daikin FTXS", "Carrier 30XA"]);
    await digitar($("[data-pesquisa-equipamento]"), "carr");
    expect($$("[data-opcao-equipamento]", modal).map(txt)).toEqual(["Carrier 30XA"]);
    await clicar($('[data-opcao-equipamento="e3"]'));
    expect($('[data-opcao-equipamento="e3"]')!.getAttribute("aria-selected")).toBe("true");
    expect($("[data-erro-vincular]")).toBeNull();
    await clicar($("[data-confirmar-vincular]"));
    expect(gravacoes()).toEqual([{ url: "/api/qrcodes/q2", metodo: "PATCH", corpo: { equipamentoId: "e3" } }]);
    expect(await toasts()).toEqual([["Etiqueta QR-102 vinculada.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("seleção para imprimir: o botão só liga com etiquetas marcadas e leva as escolhidas", async () => {
    await abrir(SO_VE);
    const imprimir = $<HTMLButtonElement>("[data-imprimir-selecionados]")!;
    expect(imprimir.disabled).toBe(true);
    await clicar($('tr[data-qr="q1"] [data-selecionar-qr]'));
    await clicar($('tr[data-qr="q3"] [data-selecionar-qr]'));
    expect(txt(imprimir)).toBe("Imprimir (2)");
    await clicar(imprimir);
    expect(nav.push).toHaveBeenCalledWith("/qrcodes/imprimir?ids=q1,q3");
    await clicar($("[data-selecionar-todos]"));
    expect(txt(imprimir)).toBe("Imprimir (3)");
  });

  it("lista vazia: diz que não há QR Code (e não que a pesquisa não achou)", async () => {
    await abrir(GERENCIA, []);
    expect(txt($("[data-lista-vazia]"))).toContain("Nenhum QR Code gerado");
    expect($('[data-tabela-pro="qrcodes"]')).toBeNull();
  });
});

describe("QR Codes (impressão)", () => {
  const EMPRESA = { nome: "Clima Total", telefone: "(11) 3333-0000", email: "", site: "", logo: null };
  const etiqueta = (n: number) => ({ id: `q${n}`, codigo: `QR-10${n}`, imagem: "data:image/png;base64,AAAA", equipamento: "LG S4-W12", local: "Matriz" });
  async function abrir(quantas: number) {
    const { ImprimirClient } = await import("@/app/(dashboard)/qrcodes/imprimir/imprimir-client");
    await montar(createElement(ImprimirClient, { etiquetas: Array.from({ length: quantas }, (_, i) => etiqueta(i + 1)), empresa: EMPRESA }), permissoesTotais());
  }

  it("conta as etiquetas no singular e no plural (sem 'etiqueta(s)')", async () => {
    await abrir(1);
    expect(txt($("[data-total-etiquetas]"))).toBe("1 etiqueta");
    act(() => root.unmount());
    await abrir(3);
    expect(txt($("[data-total-etiquetas]"))).toBe("3 etiquetas");
    expect(document.body.textContent).not.toContain("etiqueta(s)");
  });

  it("celular: a folha fica numa moldura que rola de lado, em tamanho real, e as opções empilham", async () => {
    await abrir(3);
    const moldura = $("[data-previa-etiquetas]")!;
    expect(moldura.className).toContain("overflow-x-auto");
    expect(moldura.className).toContain("print:overflow-visible");
    expect($$("[data-etiqueta]", moldura)).toHaveLength(3);
    // a regra que impede as colunas de espremer (só na tela; no papel sai como sempre)
    expect(txt($("style"))).toMatch(/@media screen \{ \.etiquetas-grid \{ min-width: max-content; \} \}/);
    expect($("[data-opcoes-etiqueta]")!.className).toContain("grid-cols-1");
    expect($<HTMLElement>("[data-imprimir]")!.className).toContain("w-full sm:w-auto");
    expect(dica("Imprimir QR Codes")).toContain("tamanho real");
  });

  it("as opções mudam a etiqueta: tamanho e dados", async () => {
    await abrir(1);
    const img = () => $<HTMLImageElement>("[data-etiqueta] img")!;
    expect(img().style.width).toBe("5cm");
    await escolher($("[data-tamanho]"), "8x8");
    expect(img().style.width).toBe("8cm");
    expect(img().getAttribute("alt")).toBe("QR Code QR-101");
    expect(txt($("[data-etiqueta]"))).toContain("Clima Total");
    await clicar($$("[data-opcoes-etiqueta] [role=switch]").find((s) => s.getAttribute("aria-label") === "Nome da empresa" || txt(s.closest("label") ?? s.parentElement) === "Nome da empresa"));
    expect(txt($("[data-etiqueta]"))).not.toContain("Clima Total");
  });
});

/* ═════════ Clientes ═════════ */
describe("Clientes: ações da linha", () => {
  async function abrir(permissoes: Permissoes, ativo = true) {
    const { ClienteAcoes } = await import("@/components/clientes/cliente-acoes");
    await montar(createElement(ClienteAcoes, { id: "c1", nome: "Padaria Pão Quente", ativo }), permissoes);
  }
  const P = (acoes: ("visualizar" | "criar" | "editar" | "excluir")[]) => montarPermissoes({ clientes: acoes });

  it("quem só visualiza: abre a ficha para ver (olho), sem Inativar nem Reativar", async () => {
    await abrir(P(["visualizar"]));
    expect($("[data-abrir-cliente]")!.getAttribute("aria-label")).toBe("Ver Padaria Pão Quente");
    expect($("[data-abrir-cliente]")!.getAttribute("href")).toBe("/clientes/c1/editar");
    expect($("[data-inativar-cliente]")).toBeNull();
    expect($("[data-reativar-cliente]")).toBeNull();
  });

  it("editar sem excluir: lápis, sem Inativar; excluir sem editar: Inativar, e a ficha abre para ver", async () => {
    await abrir(P(["visualizar", "editar"]));
    expect($("[data-abrir-cliente]")!.getAttribute("aria-label")).toBe("Editar Padaria Pão Quente");
    expect($("[data-inativar-cliente]")).toBeNull();
    expect($("[data-reativar-cliente]")).toBeNull(); // cliente ativo não tem o que reativar
    act(() => root.unmount());
    await abrir(P(["visualizar", "excluir"]));
    expect($("[data-abrir-cliente]")!.getAttribute("aria-label")).toBe("Ver Padaria Pão Quente");
    expect($("[data-inativar-cliente]")).toBeTruthy();
  });

  it("cliente inativo: Reativar com editar (sem Inativar); sem editar, nada", async () => {
    await abrir(P(["visualizar", "editar", "excluir"]), false);
    expect($("[data-reativar-cliente]")).toBeTruthy();
    expect($("[data-inativar-cliente]")).toBeNull();
    act(() => root.unmount());
    await abrir(P(["visualizar", "excluir"]), false);
    expect($("[data-reativar-cliente]")).toBeNull();
    expect($("[data-inativar-cliente]")).toBeNull();
  });

  it("inativar: confirma, grava, avisa e atualiza a lista", async () => {
    await abrir(P(["visualizar", "editar", "excluir"]));
    await clicar($("[data-inativar-cliente]"));
    expect(txt(confirmacao())).toContain("Inativar Padaria Pão Quente?");
    expect(txt(confirmacao())).toContain("pode ser reativado");
    expect(gravacoes()).toEqual([]);
    await clicar($("[data-confirmar-sim]"));
    expect(gravacoes()).toEqual([{ url: "/api/clientes/c1", metodo: "DELETE", corpo: null }]);
    expect(await toasts()).toEqual([["Cliente inativado.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("cancelar a confirmação NÃO inativa", async () => {
    await abrir(P(["visualizar", "editar", "excluir"]));
    await clicar($("[data-inativar-cliente]"));
    await clicar($("[data-confirmar-nao]"));
    expect(gravacoes()).toEqual([]);
    expect(await toasts()).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("o servidor recusa (403): a lista não atualiza e o motivo aparece", async () => {
    respostas["DELETE /api/clientes/c1"] = { status: 403, corpo: { erro: "Sem permissão" } };
    await abrir(P(["visualizar", "editar", "excluir"]));
    await clicar($("[data-inativar-cliente]"));
    await clicar($("[data-confirmar-sim]"));
    expect(await toasts()).toEqual([["Sem permissão", "erro"]]);
    expect(nav.refresh).not.toHaveBeenCalled();
    expect($("[data-inativar-cliente]")).toBeTruthy();
  });

  it("reativar: grava { ativo: true }, avisa e atualiza; recusado, não atualiza", async () => {
    await abrir(P(["visualizar", "editar"]), false);
    await clicar($("[data-reativar-cliente]"));
    expect(gravacoes()).toEqual([{ url: "/api/clientes/c1", metodo: "PATCH", corpo: { ativo: true } }]);
    expect(await toasts()).toEqual([["Cliente reativado.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    nav.refresh.mockClear();
    respostas["PATCH /api/clientes/c1"] = { status: 403, corpo: { erro: "Sem permissão" } };
    await abrir(P(["visualizar", "editar"]), false);
    await clicar($("[data-reativar-cliente]"));
    expect((await toasts()).at(-1)).toEqual(["Sem permissão", "erro"]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});

/* ═════════ Equipamentos ═════════ */
describe("Equipamentos", () => {
  const E = (acoes: ("visualizar" | "criar" | "editar" | "excluir")[]) => montarPermissoes({ equipamentos: acoes });
  const item = (id: string, extra: Record<string, unknown> = {}) => ({
    id, nome: "Split da recepção", temNome: true, marca: "LG", modelo: "S4-W12", numeroSerie: "SN-1", patrimonio: "AC-01", tipo: "AR_CONDICIONADO_SPLIT", tipoLabel: "Split",
    capacidade: "12000 BTU/h", setor: "Térreo", ambiente: "Recepção", garantiaAte: null, ativo: true, qrcodeId: null, foto: null, clienteId: "c1", cliente: "Hospital Santa Clara",
    unidadeId: "un1", unidade: "Matriz", ultimoAtendimento: null, ...extra,
  });
  const FILTROS = { q: "", cliente: "", unidade: "", setor: "", tipos: [], status: "ativo", garantia: "", qr: "", fluido: "", ordem: "nome", dir: "asc", pagina: 1, porPagina: 50 };
  async function abrirLista(permissoes: Permissoes, itens = [item("eq1"), item("eq2", { ativo: false, qrcodeId: "q1" })]) {
    const { EquipamentosListaClient } = await import("@/app/(dashboard)/equipamentos/equipamentos-lista-client");
    const { SelecaoMassaProvider } = await import("@/components/acoes-massa/selecao");
    // a página do servidor monta a lista dentro da seleção em massa (quem pode editar ganha as caixas)
    await montar(createElement(SelecaoMassaProvider, { entidade: "equipamentos", idsPagina: itens.map((i) => i.id), total: itens.length, children: createElement(EquipamentosListaClient, {
      itens, total: itens.length, filtros: FILTROS as any, opcoes: { clientes: [], unidades: [], setores: [], fluidos: [], tipos: [] }, resumo: { ativos: 1, vencendo: 0, vencidas: 0, semQr: 1 },
    }) }), permissoes);
  }
  const acoes = (id: string) => $(`tr[data-equipamento="${id}"] [data-acoes-equipamento]`)!;

  it("lista de quem só visualiza: só 'Ver ficha' na linha; sem Novo, Por foto, Editar, QR nem Inativar", async () => {
    await abrirLista(E(["visualizar"]));
    expect($("[data-novo-equipamento]")).toBeNull();
    expect($("[data-novo-por-foto]")).toBeNull();
    expect($$("a, button", acoes("eq1")).map((b) => b.getAttribute("title"))).toEqual(["Ver ficha"]);
    expect($$("[data-alternar-equipamento]")).toEqual([]);
  });

  it("lista de quem tem tudo: Novo e Por foto; na linha, ficha, QR, editar e Inativar (ativo) ou Reativar (inativo)", async () => {
    await abrirLista(E(["visualizar", "criar", "editar", "excluir"]));
    expect($("[data-novo-equipamento]")).toBeTruthy();
    expect($("[data-novo-por-foto]")!.getAttribute("aria-label")).toBe("Cadastrar pela foto da etiqueta");
    expect($$("a, button", acoes("eq1")).map((b) => b.getAttribute("title"))).toEqual(["Ver ficha", "Gerar ou vincular QR Code", "Editar", "Inativar"]);
    expect($$("a, button", acoes("eq2")).map((b) => b.getAttribute("title"))).toEqual(["Ver ficha", "QR Code vinculado", "Editar", "Reativar"]);
  });

  it("editar sem excluir: edita e reativa, mas não inativa; criar sem editar: só cadastra", async () => {
    await abrirLista(E(["visualizar", "editar"]));
    expect($$("a, button", acoes("eq1")).map((b) => b.getAttribute("title"))).toEqual(["Ver ficha", "Gerar ou vincular QR Code", "Editar"]);
    expect($$("a, button", acoes("eq2")).map((b) => b.getAttribute("title"))).toContain("Reativar");
    act(() => root.unmount());
    await abrirLista(E(["visualizar", "criar"]));
    expect($("[data-novo-equipamento]")).toBeTruthy();
    expect($$("a, button", acoes("eq1")).map((b) => b.getAttribute("title"))).toEqual(["Ver ficha"]);
  });

  it("padrão de lista: tabela da casa (sem tabela própria), o inativo leva o selo ao lado do nome, sem rolar de lado no notebook", async () => {
    await abrirLista(E(["visualizar", "editar"]));
    expect($('[data-tabela-pro="equipamentos"]')).toBeTruthy();
    expect($$("tr[data-equipamento]").map((l) => l.getAttribute("data-equipamento"))).toEqual(["eq1", "eq2"]);
    const celulaDoNome = (id: string) => $(`tr[data-equipamento="${id}"] [data-descricao]`)!.closest("td");
    expect(txt(celulaDoNome("eq2"))).toContain("Inativo");
    expect(txt(celulaDoNome("eq1"))).not.toContain("Inativo");
    expect(txt($('tr[data-equipamento="eq1"]'))).toContain("Split da recepção · LG S4-W12 · S/N SN-1 · TAG AC-01");
    // a soma das larguras cabe em 1110px (1440px de tela com o menu aberto): as ações não saem da vista
    const larguras = [...fonte("app/(dashboard)/equipamentos/equipamentos-lista-client.tsx").matchAll(/(?:largura|minimo): (\d+)/g)].map((m) => Number(m[1]));
    expect(larguras.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1110);
  });

  it("inativar: confirma, grava, avisa e atualiza; cancelar não grava", async () => {
    const { EquipamentoAtivoBotao } = await import("@/components/equipamentos/equipamento-ativo-botao");
    await montar(createElement(EquipamentoAtivoBotao, { id: "eq1", nome: "Split da recepção", ativo: true }), E(["visualizar", "excluir"]));
    await clicar($("[data-alternar-equipamento]"));
    expect(txt(confirmacao())).toContain("Inativar Split da recepção?");
    await clicar($("[data-confirmar-nao]"));
    expect(gravacoes()).toEqual([]);
    await clicar($("[data-alternar-equipamento]"));
    await clicar($("[data-confirmar-sim]"));
    expect(gravacoes()).toEqual([{ url: "/api/equipamentos/eq1", metodo: "DELETE", corpo: null }]);
    expect(await toasts()).toEqual([["Equipamento inativado.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("reativar vai direto (não destrói nada), avisa e atualiza; recusado pelo servidor, a tela fica como está", async () => {
    const { EquipamentoAtivoBotao } = await import("@/components/equipamentos/equipamento-ativo-botao");
    await montar(createElement(EquipamentoAtivoBotao, { id: "eq2", nome: "Split antigo", ativo: false }), E(["visualizar", "editar"]));
    await clicar($("[data-alternar-equipamento]"));
    expect(confirmacao()).toBeNull();
    expect(gravacoes()).toEqual([{ url: "/api/equipamentos/eq2", metodo: "PATCH", corpo: { ativo: true } }]);
    expect(await toasts()).toEqual([["Equipamento reativado.", "sucesso"]]);
    act(() => root.unmount());
    nav.refresh.mockClear();
    respostas["PATCH /api/equipamentos/eq2"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await montar(createElement(EquipamentoAtivoBotao, { id: "eq2", nome: "Split antigo", ativo: false }), E(["visualizar", "editar"]));
    await clicar($("[data-alternar-equipamento]"));
    expect((await toasts()).at(-1)).toEqual(["Sem permissão para esta ação", "erro"]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("sem a permissão da ação, o botão nem existe (inativar sem excluir; reativar sem editar)", async () => {
    const { EquipamentoAtivoBotao } = await import("@/components/equipamentos/equipamento-ativo-botao");
    await montar(createElement("div", null, createElement(EquipamentoAtivoBotao, { id: "a", nome: "A", ativo: true }), createElement(EquipamentoAtivoBotao, { id: "b", nome: "B", ativo: false })), E(["visualizar", "criar"]));
    expect($$("[data-alternar-equipamento]")).toEqual([]);
  });

  it("'Gerar QR' na ficha: avisa com o código gerado e atualiza; recusado, mostra o motivo e não atualiza", async () => {
    const { GerarQrBotao } = await import("@/components/equipamentos/gerar-qr-botao");
    respostas["POST /api/equipamentos/eq1/qrcode"] = { status: 201, corpo: { id: "q9", codigo: "QR-109" } };
    await montar(createElement(GerarQrBotao, { equipamentoId: "eq1", variante: "botao" }), E(["visualizar", "criar"]));
    await clicar($("[data-gerar-qr]"));
    expect(await toasts()).toEqual([["QR Code QR-109 gerado.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    nav.refresh.mockClear();
    respostas["POST /api/equipamentos/eq1/qrcode"] = { status: 400, corpo: { erro: "Equipamento já possui um QR Code vinculado." } };
    await montar(createElement(GerarQrBotao, { equipamentoId: "eq1" }), E(["visualizar", "criar"]));
    await clicar($("[data-gerar-qr]"));
    expect((await toasts()).at(-1)).toEqual(["Equipamento já possui um QR Code vinculado.", "erro"]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  describe("aba QR Code da edição", () => {
    async function abrir(qr: { id: string; codigo: string } | null) {
      const { EquipamentoQrSection } = await import("@/components/forms/equipamento-qr-section");
      respostas["GET /api/qrcodes"] = { status: 200, corpo: [{ id: "q5", codigo: "QR-105" }] };
      respostas["GET /api/qrcodes/q1"] = { status: 200, corpo: { imagem: "data:image/png;base64,AAAA", urlPublica: "https://x/qr/t" } };
      await montar(createElement(EquipamentoQrSection, { equipamentoId: "eq1", qrInicial: qr }), E(["visualizar", "editar"]));
    }

    it("desvincular pede confirmação; cancelar não grava; confirmar grava, avisa e a aba volta ao 'sem QR'", async () => {
      await abrir({ id: "q1", codigo: "QR-101" });
      await clicar($("[data-desvincular-qr]"));
      expect(txt(confirmacao())).toContain("Desvincular a etiqueta QR-101?");
      await clicar($("[data-confirmar-nao]"));
      expect(gravacoes()).toEqual([]);
      await clicar($("[data-desvincular-qr]"));
      await clicar($("[data-confirmar-sim]"));
      expect(gravacoes()).toEqual([{ url: "/api/equipamentos/eq1/qrcode", metodo: "DELETE", corpo: null }]);
      expect(await toasts()).toEqual([["Etiqueta QR-101 desvinculada.", "sucesso"]]);
      expect($("[data-gerar-qr]")).toBeTruthy();
    });

    it("desvincular recusado (403): a etiqueta continua na aba, com o motivo, e sem aviso de sucesso", async () => {
      respostas["DELETE /api/equipamentos/eq1/qrcode"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
      await abrir({ id: "q1", codigo: "QR-101" });
      await clicar($("[data-desvincular-qr]"));
      await clicar($("[data-confirmar-sim]"));
      expect(txt($("[data-erro-qr]"))).toBe("Sem permissão para esta ação");
      expect($("[data-desvincular-qr]")).toBeTruthy();
      expect(await toasts()).toEqual([]);
    });

    it("gerar: avisa com o código; erro sem JSON não derruba a aba", async () => {
      respostas["POST /api/equipamentos/eq1/qrcode"] = { status: 201, corpo: { id: "q7", codigo: "QR-107" } };
      await abrir(null);
      await clicar($("[data-gerar-qr]"));
      expect(await toasts()).toEqual([["QR Code QR-107 gerado.", "sucesso"]]);
      expect($("[data-desvincular-qr]")).toBeTruthy();
      act(() => root.unmount());
      respostas["POST /api/equipamentos/eq1/qrcode"] = { status: 502, corpo: null, texto: "<html>Bad Gateway</html>" };
      await abrir(null);
      await clicar($("[data-gerar-qr]"));
      expect(txt($("[data-erro-qr]"))).toBe("Não foi possível gerar o QR Code.");
      expect($("[data-gerar-qr]")).toBeTruthy();
    });
  });
});

/* ═════════ Sugestão inteligente: CNPJ no cadastro rápido de cliente ═════════ */
describe("CNPJ no cadastro rápido de cliente — as regras puras", () => {
  it("só dá para consultar com os 14 dígitos (com ou sem máscara)", () => {
    expect(cnpjCompleto("45.723.174/0001-10")).toBe(true);
    expect(cnpjCompleto("45723174000110")).toBe(true);
    expect(cnpjCompleto("4572317400011")).toBe(false);
    expect(cnpjCompleto("457231740001100")).toBe(false);
    expect(cnpjCompleto("")).toBe(false);
    expect(cnpjCompleto(undefined)).toBe(false);
    expect(digitosDoDocumento("45.723.174/0001-10")).toBe("45723174000110");
  });

  it("da consulta, aproveita só razão social, fantasia e telefone — e só o que veio preenchido", () => {
    expect(sugestaoDoCnpj({ nome: " PADARIA LTDA ", nomeFantasia: "", telefone: "(11) 3333-9000", email: "x@y.com", cidade: "SP", optanteSimples: true })).toEqual({ nome: "PADARIA LTDA", telefone: "(11) 3333-9000" });
    expect(sugestaoDoCnpj(null)).toEqual({});
    expect(sugestaoDoCnpj({ nome: 12, telefone: "   " })).toEqual({});
  });

  it("a sugestão entra só no campo VAZIO do formulário; o que já foi digitado fica", () => {
    const sugestao = { nome: "PADARIA LTDA", nomeFantasia: "PAO QUENTE", telefone: "(11) 3333-9000" };
    expect(aplicarSugestao({ cpfCnpj: "45723174000110" }, sugestao, ["nome", "nomeFantasia", "telefone"])).toEqual({
      valores: { cpfCnpj: "45723174000110", nome: "PADARIA LTDA", nomeFantasia: "PAO QUENTE", telefone: "(11) 3333-9000" }, preenchidos: ["nome", "nomeFantasia", "telefone"],
    });
    const r = aplicarSugestao({ nome: "Padaria do Zé", nomeFantasia: "  ", telefone: "" }, sugestao, ["nome", "nomeFantasia", "telefone"]);
    expect(r).toEqual({ valores: { nome: "Padaria do Zé", nomeFantasia: "PAO QUENTE", telefone: "(11) 3333-9000" }, preenchidos: ["nomeFantasia", "telefone"] });
    // campo que o formulário não tem não entra
    expect(aplicarSugestao({}, sugestao, ["nome"])).toEqual({ valores: { nome: "PADARIA LTDA" }, preenchidos: ["nome"] });
    // e não mexe no objeto recebido
    const original = { nome: "" };
    aplicarSugestao(original, sugestao, ["nome"]);
    expect(original).toEqual({ nome: "" });
  });

  it("a frase diz de onde veio e o que entrou; sem nada a preencher, diz isso", () => {
    const rotulos = { nome: "Nome / Razão social", nomeFantasia: "Nome fantasia", telefone: "Telefone" };
    expect(notaDaSugestao(["nome", "nomeFantasia", "telefone"], rotulos, "Dados da Receita Federal")).toBe("Dados da Receita Federal: nome / razão social, nome fantasia e telefone. Confira antes de salvar.");
    expect(notaDaSugestao(["telefone"], rotulos, "Dados da Receita Federal")).toBe("Dados da Receita Federal: telefone. Confira antes de salvar.");
    expect(notaDaSugestao(["nome", "telefone"], rotulos, "Dados da Receita Federal")).toBe("Dados da Receita Federal: nome / razão social e telefone. Confira antes de salvar.");
    expect(notaDaSugestao([], rotulos, "Dados da Receita Federal")).toBe("Dados da Receita Federal: nada a preencher, os campos já estavam preenchidos.");
  });
});

describe("CNPJ no cadastro rápido de cliente — na tela", () => {
  const RECEITA = { nome: "PADARIA PAO QUENTE LTDA", nomeFantasia: "PAO QUENTE", telefone: "(11) 3333-9000", email: "contato@paoquente.com.br" };
  const criado: Record<string, string>[] = [];
  async function abrir() {
    const { CadastroRapidoModal } = await import("@/components/ui/select-cadastro-rapido");
    const { CLIENTE } = await import("@/components/cadastro-rapido/definicoes");
    criado.length = 0;
    await montar(createElement(CadastroRapidoModal, {
      aberto: true, onFechar: () => {}, titulo: "Novo cliente", campos: CLIENTE.campos, valoresIniciais: CLIENTE.valoresIniciais, onCriado: () => {},
      criar: async (v: Record<string, string>) => { criado.push(v); return { value: "c1", label: v.nome }; },
    }), permissoesTotais());
  }
  const modal = () => $('[role="dialog"]')!;
  /** O campo pelo rótulo: o rótulo envolve o campo ou, no campo com consulta, aponta para ele (htmlFor) */
  const campo = (rotulo: string) => {
    const l = $$("label", modal()).find((x) => txt((x as HTMLLabelElement).htmlFor ? x : $("span", x)).replace(" *", "") === rotulo) as HTMLLabelElement;
    expect(l, `rótulo "${rotulo}"`).toBeTruthy();
    return (l.htmlFor ? document.getElementById(l.htmlFor) : l.querySelector("input")) as HTMLInputElement;
  };
  const consultar = () => $<HTMLButtonElement>('[data-consultar="cpfCnpj"]');

  it("o botão Consultar fica ao lado do CNPJ, desligado até os 14 dígitos; para pessoa física, some", async () => {
    await abrir();
    expect(consultar()!.disabled).toBe(true);
    await digitar(campo("CPF / CNPJ"), "4572317400011");
    expect(consultar()!.disabled).toBe(true);
    await digitar(campo("CPF / CNPJ"), "45.723.174/0001-10");
    expect(consultar()!.disabled).toBe(false);
    await escolher($("select", modal()), "FISICA");
    expect(consultar()).toBeNull();
    expect(consultas()).toEqual([]);
  });

  it("consultar preenche os campos vazios, diz de onde veio, e tudo continua editável", async () => {
    respostas["GET /api/cnpj/45723174000110"] = { status: 200, corpo: RECEITA };
    await abrir();
    await digitar(campo("CPF / CNPJ"), "45.723.174/0001-10");
    await clicar(consultar());
    expect(consultas().map((c) => c.url)).toEqual(["/api/cnpj/45723174000110"]);
    expect(campo("Nome / Razão social").value).toBe("PADARIA PAO QUENTE LTDA");
    expect(campo("Nome fantasia").value).toBe("PAO QUENTE");
    expect(campo("Telefone").value).toBe("(11) 3333-9000");
    expect(txt($("[data-nota-consulta='ok']"))).toBe("Dados da Receita Federal: nome / razão social, nome fantasia e telefone. Confira antes de salvar.");
    // nada é travado: a pessoa corrige e é o valor dela que vai
    expect([campo("Nome / Razão social"), campo("Nome fantasia"), campo("Telefone")].some((c) => c.disabled || c.readOnly)).toBe(false);
    // a frase e o botão ficam FORA do rótulo: para o leitor de tela, o nome do campo é só "CPF / CNPJ"
    expect($$("label", modal()).filter((l) => /Consultar|Receita/.test(txt(l)))).toEqual([]);
    expect(campo("CPF / CNPJ").closest("label")).toBeNull();
    await digitar(campo("Nome fantasia"), "Padaria Pão Quente");
    await clicar(botao("SalvarSalvar e selecionar", modal()));
    expect(criado).toEqual([{ tipoPessoa: "JURIDICA", cpfCnpj: "45.723.174/0001-10", nome: "PADARIA PAO QUENTE LTDA", nomeFantasia: "Padaria Pão Quente", telefone: "(11) 3333-9000" }]);
  });

  it("não preenche no escuro: o que já foi digitado NÃO é trocado, e a frase lista só o que entrou", async () => {
    respostas["GET /api/cnpj/45723174000110"] = { status: 200, corpo: RECEITA };
    await abrir();
    await digitar(campo("CPF / CNPJ"), "45723174000110");
    await digitar(campo("Nome / Razão social"), "Padaria do Zé");
    await digitar(campo("Telefone"), "(11) 99999-0000");
    await clicar(consultar());
    expect(campo("Nome / Razão social").value).toBe("Padaria do Zé");
    expect(campo("Telefone").value).toBe("(11) 99999-0000");
    expect(campo("Nome fantasia").value).toBe("PAO QUENTE");
    expect(txt($("[data-nota-consulta='ok']"))).toBe("Dados da Receita Federal: nome fantasia. Confira antes de salvar.");
    // segunda consulta: nada mais a preencher
    await clicar(consultar());
    expect(txt($("[data-nota-consulta='ok']"))).toBe("Dados da Receita Federal: nada a preencher, os campos já estavam preenchidos.");
  });

  it("consulta que falha: mostra o motivo da rota, não preenche nada e o cadastro segue à mão", async () => {
    respostas["GET /api/cnpj/45723174000110"] = { status: 404, corpo: { erro: "CNPJ não encontrado na Receita Federal. Verifique o número digitado." } };
    await abrir();
    await digitar(campo("CPF / CNPJ"), "45723174000110");
    await clicar(consultar());
    expect(txt($("[data-nota-consulta='erro']"))).toBe("CNPJ não encontrado na Receita Federal. Verifique o número digitado.");
    expect(campo("Nome / Razão social").value).toBe("");
    expect(consultar()!.disabled).toBe(false);
    await digitar(campo("Nome / Razão social"), "Padaria à mão");
    await clicar(botao("SalvarSalvar e selecionar", modal()));
    expect(criado.map((c) => c.nome)).toEqual(["Padaria à mão"]);
  });

  it("os outros cadastros rápidos não ganham o botão (só o CNPJ do cliente consulta)", async () => {
    const { UNIDADE, CLIENTE } = await import("@/components/cadastro-rapido/definicoes");
    expect(UNIDADE.campos.some((c) => c.consulta)).toBe(false);
    expect(CLIENTE.campos.filter((c) => c.consulta).map((c) => c.nome)).toEqual(["cpfCnpj"]);
    expect(CLIENTE.campos.find((c) => c.nome === "cpfCnpj")!.consulta!.origem).toBe("Dados da Receita Federal");
  });
});

/* ═════════ QR Codes: qual equipamento é qual ═════════ */
describe("QR Codes: o nome do equipamento diz QUAL é (marca e modelo se repetem)", () => {
  const BASE = { marca: "LG", modelo: "S4-W12" };
  it("o apelido vem primeiro; sem apelido, marca e modelo", async () => {
    const { nomeEquipamentoQr } = await import("@/lib/qrcode-rotulos");
    expect(nomeEquipamentoQr({ ...BASE, nome: "Split UTI 1" })).toBe("Split UTI 1 · LG S4-W12");
    expect(nomeEquipamentoQr({ ...BASE, nome: "  " })).toBe("LG S4-W12");
    expect(nomeEquipamentoQr(BASE)).toBe("LG S4-W12");
  });
  it("na lista, o lugar junta unidade e ambiente (o que houver)", async () => {
    const { localEquipamentoQr } = await import("@/lib/qrcode-rotulos");
    expect(localEquipamentoQr({ ...BASE, localizacao: "UTI", unidade: { nome: "Matriz" } })).toBe("Matriz · UTI");
    expect(localEquipamentoQr({ ...BASE, localizacao: null, unidade: { nome: "Matriz" } })).toBe("Matriz");
    expect(localEquipamentoQr({ ...BASE, localizacao: "UTI" })).toBe("UTI");
    expect(localEquipamentoQr(BASE)).toBeNull();
  });
  it("no vincular, dois splits iguais se distinguem pelo apelido, cliente, unidade e ambiente", async () => {
    const { rotuloParaVincular } = await import("@/lib/qrcode-rotulos");
    const santaClara = { nome: "Matriz", cliente: { nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" } };
    expect(rotuloParaVincular({ ...BASE, nome: "Split UTI 1", localizacao: "UTI", unidade: santaClara })).toBe("Split UTI 1 · LG S4-W12 — Hospital Santa Clara · Matriz · UTI");
    expect(rotuloParaVincular({ ...BASE, localizacao: "Recepção", unidade: { nome: "Sede", cliente: { nome: "Padaria Ltda", nomeFantasia: null } } })).toBe("LG S4-W12 — Padaria Ltda · Sede · Recepção");
    expect(rotuloParaVincular(BASE)).toBe("LG S4-W12");
    expect(fonte("app/(dashboard)/qrcodes/page.tsx")).toContain("nome: rotuloParaVincular(e)");
  });
});

/* ═════════ Varredura do código das telas ═════════ */
describe("as telas da leva seguem o padrão (varredura)", () => {
  const LISTAS = ["app/(dashboard)/clientes/page.tsx", "app/(dashboard)/equipamentos/equipamentos-lista-client.tsx", "app/(dashboard)/qrcodes/qrcodes-client.tsx", "components/forms/equipamento-form.tsx"];

  it("nenhuma tabela própria: as listas usam a tabela da casa", () => {
    for (const f of LISTAS) {
      expect([f, /<table[\s>]/.test(fonte(f))]).toEqual([f, false]);
      expect([f, /TabelaPro(Url)?\b/.test(fonte(f))]).toEqual([f, true]);
    }
  });

  it("clientes: a lista do servidor usa a tabela pela URL, as ações da linha e os cartões do celular", () => {
    const pagina = fonte("app/(dashboard)/clientes/page.tsx");
    expect(pagina).toContain('<TabelaProUrl');
    expect(pagina).toContain('tela="clientes"');
    expect(pagina).toContain("data-cartoes");
    expect(pagina).toContain("Novo cliente");
    expect(pagina).not.toContain("Novo Cliente");
    // o botão de criar continua atrás da permissão
    expect(pagina).toMatch(/\{podeCriar && \(/);
  });

  it("QR Codes: toda ação que grava está atrás de QR Codes › gerenciar, e a tela não oferece excluir de vez", () => {
    const tela = fonte("app/(dashboard)/qrcodes/qrcodes-client.tsx");
    expect(tela).toContain('usePermissoes().pode("qrcodes", "gerenciar")');
    expect(tela).not.toMatch(/method: "DELETE"/);
    expect(tela).not.toMatch(/\balert\(|\bconfirm\(/);
  });

  it("gravações das telas de equipamento avisam (toast) e os seletores editam no contexto", () => {
    for (const f of ["components/forms/equipamento-form.tsx", "components/equipamentos/cadastro-por-foto.tsx", "components/equipamentos/gerar-qr-botao.tsx", "components/forms/equipamento-qr-section.tsx", "components/equipamentos/equipamento-ativo-botao.tsx", "components/clientes/cliente-acoes.tsx"]) {
      expect([f, /\btoast\(/.test(fonte(f))]).toEqual([f, true]);
    }
    const form = fonte("components/forms/equipamento-form.tsx");
    expect(form.match(/edicao=\{CLIENTE\.edicao\(\)\}/g)).toHaveLength(2);
    expect(form.match(/edicao=\{edicaoUnidade\}/g)).toHaveLength(2);
    expect(form).toContain('toast(isEditing ? "Equipamento atualizado." : "Equipamento cadastrado.")');
    expect(fonte("components/equipamentos/cadastro-por-foto.tsx")).toContain("edicao={UNIDADE.edicao<UnidadeItem>(");
  });
});
