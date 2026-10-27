// @vitest-environment happy-dom
/**
 * Pedido de Compra num DOM de verdade:
 *  - editor (criar/editar inline): ao escolher o produto, a dica "Última compra: R$ — fornecedor — data"
 *    aparece e o estimado vem dela (sugestão, editável; "usar" volta a ela); sem histórico, vazio;
 *    comprador só da lista de quem tem Compras, com aviso claro quando não há ninguém; avulso pede o
 *    motivo; editar manda PUT com os ids dos itens;
 *  - painel: Baixar/E-mail/WhatsApp (WhatsApp abre a aba já no clique; sem contato = desabilitado com o
 *    motivo), Editar inline e Cancelar (confirmação da casa), histórico; sem permissão = sem botões;
 *  - seção da OS: abrir o pedido ali mesmo (sem trocar de tela).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PedidoTela } from "@/lib/compras/pedido";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/compras/pedidos", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ toasts: [] as [string, string][], confirmar: true }));
vi.mock("@/components/ui/avisos", () => ({
  toast: (m: string, t = "sucesso") => { avisos.toasts.push([m, t]); },
  confirmar: async () => avisos.confirmar,
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const PRODUTOS = [{ id: "pFiltro", nome: "Filtro secador", unidade: "un", ativo: true }, { id: "pNovo", nome: "Capacitor", unidade: "pc", ativo: true }];
const FORNECEDORES = [{ id: "fFrig", nome: "Frigelar", ativo: true }];

beforeEach(() => {
  chamadas.length = 0;
  avisos.toasts = []; avisos.confirmar = true;
  respostas = {
    "GET /api/cadastros/produtos?ativo=todos": { status: 200, corpo: PRODUTOS },
    "GET /api/cadastros/fornecedores?ativo=todos": { status: 200, corpo: FORNECEDORES },
    "GET /api/compras/compradores": { status: 200, corpo: [{ id: "uComp", nome: "Paulo Compras" }] },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function renderizar(el: React.ReactElement) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
async function escolher(sel: Element | null | undefined, v: string) {
  expect(sel).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, v);
    sel!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}
const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const campo = (nome: string, i = 0) => $$<HTMLInputElement>(`[data-campo="${nome}"]`)[i];

const PEDIDO: PedidoTela = {
  id: "pc1", numero: "PCI-2026-0002", status: "SOLICITADO", statusEm: "2026-10-27T12:00:00Z", criadoEm: "2026-10-27T12:00:00Z",
  prazoNecessario: "2026-11-05", observacao: "Urgente", motivo: null, tokenPublico: "tok1",
  solicitante: { id: "u1", nome: "Ana" }, comprador: { id: "uComp", nome: "Paulo Compras" },
  fornecedor: { id: "fFrig", nome: "Frigelar", email: "vendas@frigelar.com.br", telefone: "1133334444", ativo: true },
  origem: { tipo: "OS", os: { id: "os1", numero: "OS-2026-0012" }, orcamento: { id: "o1", codigo: "ORC-2026-0003" } },
  itens: [
    { id: "i1", produtoId: "pFiltro", produtoNome: "Filtro secador", descricao: "Filtro secador", quantidade: 4, unidade: "un", valorEstimado: 18.45, valorReal: null },
    { id: "i2", produtoId: null, produtoNome: null, descricao: "Gás R410A", quantidade: 11.35, unidade: "kg", valorEstimado: null, valorReal: 99.9 },
  ],
  eventos: [
    { id: "e2", tipo: "EDITADO", detalhe: "Quantidade de Filtro secador: 2 un → 4 un", criadoEm: "2026-10-27T13:00:00Z", usuarioNome: "Paulo Compras" },
    { id: "e1", tipo: "CRIADO", detalhe: "2 itens", criadoEm: "2026-10-27T12:00:00Z", usuarioNome: "Ana" },
  ],
  podeEditar: true, podeEnviar: true,
};

describe("editor do pedido", () => {
  it("escolher o produto: dica da última compra e o estimado vem dela (editável; 'usar' volta)", async () => {
    respostas["GET /api/compras/ultima-compra?produtoIds=pFiltro"] = { status: 200, corpo: { pFiltro: { valorUnitario: 18.454, fornecedor: "Frigelar", data: "2026-10-15T12:00:00Z" } } };
    const { EditorPedido } = await import("@/components/compras/editor-pedido");
    await renderizar(createElement(EditorPedido, { ordemServicoId: "os1", onSalvo: () => {}, onCancelar: () => {} }));
    expect($("[data-dica-ultima-compra]")).toBeNull();
    await escolher($("[data-item-editor] select"), "pFiltro");
    expect(texto($('[data-dica-ultima-compra="pFiltro"]'))).toBe("Última compra: R$ 18,45 — Frigelar — 15/10/2026");
    expect(campo("valorEstimado").value).toBe("18,45");
    expect(campo("descricao").value).toBe("Filtro secador");
    expect($("[data-usar-ultima-compra]")).toBeNull();
    await digitar(campo("valorEstimado"), "20");
    expect(campo("valorEstimado").value).toBe("20");
    await clicar($("[data-usar-ultima-compra]"));
    expect(campo("valorEstimado").value).toBe("18,45");
    // Sem histórico (Capacitor): sem dica, estimado vazio
    await clicar($("[data-adicionar-item]"));
    await escolher($$("[data-item-editor] select")[1], "pNovo");
    expect($('[data-dica-ultima-compra="pNovo"]')).toBeNull();
    expect(campo("valorEstimado", 1).value).toBe("");
    expect(campo("unidade", 1).value).toBe("pc");
    expect(chamadas.filter((c) => c.url.startsWith("/api/compras/ultima-compra")).map((c) => c.url))
      .toEqual(["/api/compras/ultima-compra?produtoIds=pFiltro", "/api/compras/ultima-compra?produtoIds=pNovo"]);
  });

  it("solicitar: POST com a origem, itens (vírgula aceita) e o comprador da lista de Compras", async () => {
    respostas["POST /api/pedidos-compra"] = { status: 201, corpo: { ...PEDIDO, whatsappUrl: null } };
    const salvo = vi.fn();
    const { EditorPedido } = await import("@/components/compras/editor-pedido");
    await renderizar(createElement(EditorPedido, { orcamentoId: "o1", onSalvo: salvo, onCancelar: () => {} }));
    expect([...$<HTMLSelectElement>('[data-campo="comprador"]')!.options].map((o) => o.textContent)).toEqual(["Sem comprador", "Paulo Compras"]);
    expect($('[data-campo="motivo"]')).toBeNull(); // não é avulso
    await digitar(campo("descricao"), "Fita isolante");
    await digitar(campo("quantidade"), "2,5");
    await escolher($('[data-campo="comprador"]'), "uComp");
    await escolher($('[data-seletor-cadastro="fornecedores"]'), "fFrig");
    await clicar($("[data-salvar-pedido]"));
    const post = chamadas.find((c) => c.metodo === "POST")!;
    expect(post.corpo).toEqual({
      ordemServicoId: null, orcamentoId: "o1", compradorId: "uComp", fornecedorId: "fFrig", prazoNecessario: null, observacao: null, motivo: null,
      itens: [{ id: null, produtoId: null, descricao: "Fita isolante", quantidade: 2.5, unidade: "un", valorEstimado: null }],
    });
    expect(salvo).toHaveBeenCalledOnce();
  });

  it("validações na tela e erro do servidor aparecem sem salvar", async () => {
    respostas["POST /api/pedidos-compra"] = { status: 400, corpo: { erro: "O comprador precisa ser um usuário ativo com acesso a Compras." } };
    const salvo = vi.fn();
    const { EditorPedido } = await import("@/components/compras/editor-pedido");
    await renderizar(createElement(EditorPedido, { ordemServicoId: "os1", onSalvo: salvo, onCancelar: () => {} }));
    await clicar($("[data-salvar-pedido]"));
    expect(texto($("[data-erro-pedido]"))).toBe("Adicione ao menos um item com descrição.");
    await digitar(campo("descricao"), "X");
    await digitar(campo("quantidade"), "0");
    await clicar($("[data-salvar-pedido]"));
    expect(texto($("[data-erro-pedido]"))).toBe("A quantidade de cada item precisa ser maior que zero.");
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
    await digitar(campo("quantidade"), "1");
    await clicar($("[data-salvar-pedido]"));
    expect(texto($("[data-erro-pedido]"))).toBe("O comprador precisa ser um usuário ativo com acesso a Compras.");
    expect(salvo).not.toHaveBeenCalled();
  });

  it("ninguém com Compras: aviso claro no lugar do comprador; avulso pede o motivo", async () => {
    respostas["GET /api/compras/compradores"] = { status: 200, corpo: [] };
    const { EditorPedido } = await import("@/components/compras/editor-pedido");
    await renderizar(createElement(EditorPedido, { avulso: true, onSalvo: () => {}, onCancelar: () => {} }));
    expect(texto($("[data-sem-comprador]"))).toContain("Nenhum usuário ativo tem acesso a Compras");
    expect($('[data-campo="comprador"]')).toBeNull();
    expect(campo("motivo").value).toBe("Reposição de estoque");
  });

  it("editar: PUT com os ids dos itens; comprador que perdeu o acesso continua aparecendo", async () => {
    respostas["GET /api/compras/compradores"] = { status: 200, corpo: [{ id: "uOutro", nome: "Rita" }] };
    respostas["PUT /api/pedidos-compra/pc1"] = { status: 200, corpo: { ...PEDIDO, mudancas: ["x"] } };
    const salvo = vi.fn();
    const { EditorPedido } = await import("@/components/compras/editor-pedido");
    await renderizar(createElement(EditorPedido, { pedido: PEDIDO, onSalvo: salvo, onCancelar: () => {} }));
    expect([...$<HTMLSelectElement>('[data-campo="comprador"]')!.options].map((o) => o.textContent)).toEqual(["Sem comprador", "Rita", "Paulo Compras (sem acesso a Compras)"]);
    expect(campo("quantidade", 1).value).toBe("11,35");
    expect(campo("valorEstimado", 0).value).toBe("18,45");
    await digitar(campo("quantidade", 0), "6");
    await clicar($$('[aria-label="Remover item"]')[1]);
    await clicar($("[data-salvar-pedido]"));
    const put = chamadas.find((c) => c.metodo === "PUT")!;
    expect(put.url).toBe("/api/pedidos-compra/pc1");
    expect(put.corpo).toMatchObject({ compradorId: "uComp", fornecedorId: "fFrig", prazoNecessario: "2026-11-05", observacao: "Urgente", motivo: null });
    expect(put.corpo.itens).toEqual([{ id: "i1", produtoId: "pFiltro", descricao: "Filtro secador", quantidade: 6, unidade: "un", valorEstimado: 18.45 }]);
    expect(salvo).toHaveBeenCalledWith(expect.objectContaining({ mudancas: ["x"] }));
  });
});

describe("painel do pedido", () => {
  it("cabeçalho, origem com link, itens, histórico", async () => {
    const { PedidoPainel } = await import("@/components/compras/pedido-painel");
    await renderizar(createElement(PedidoPainel, { inicial: PEDIDO }));
    expect(texto($("[data-status-pedido]"))).toBe("Solicitado");
    expect(texto($("[data-status-desde]"))).toBe("desde 27/10/2026");
    expect(texto($("[data-origem-pedido]"))).toBe("OS OS-2026-0012 (orçamento ORC-2026-0003)");
    expect($<HTMLAnchorElement>('[data-origem-pedido] a[href="/ordens/os1?aba=materiais"]')).toBeTruthy();
    expect($<HTMLAnchorElement>('[data-origem-pedido] a[href="/orcamentos/o1"]')).toBeTruthy();
    expect(texto($("[data-itens-pedido]"))).toContain("Gás R410A");
    expect(texto($("[data-total-estimado]"))).toBe("R$ 73,80");
    expect($$("[data-evento]").map((e) => e.getAttribute("data-evento"))).toEqual(["EDITADO", "CRIADO"]);
    expect(texto($('[data-evento="EDITADO"]'))).toContain("Pedido editado");
    expect(texto($('[data-evento="EDITADO"]'))).toContain("Paulo Compras");
    expect(texto($('[data-evento="EDITADO"]'))).toContain("Quantidade de Filtro secador: 2 un → 4 un");
  });

  it("WhatsApp: abre a aba já no clique e leva ao wa.me; status atualizado", async () => {
    const aba = { closed: false, opener: {}, location: { href: "" }, close: vi.fn() };
    const abrir = vi.fn(() => aba);
    vi.stubGlobal("open", abrir);
    respostas["POST /api/pedidos-compra/pc1/enviar"] = { status: 200, corpo: { ok: true, status: "COTANDO", whatsappUrl: "https://wa.me/551133334444?text=x" } };
    respostas["GET /api/pedidos-compra/pc1"] = { status: 200, corpo: { ...PEDIDO, status: "COTANDO", eventos: [{ id: "e3", tipo: "ENVIADO_WHATSAPP", detalhe: "Frigelar · 1133334444", criadoEm: "2026-10-27T14:00:00Z", usuarioNome: "Ana" }, ...PEDIDO.eventos] } };
    const mudou = vi.fn();
    const { PedidoPainel } = await import("@/components/compras/pedido-painel");
    await renderizar(createElement(PedidoPainel, { inicial: PEDIDO, onMudou: mudou }));
    await clicar($("[data-enviar-whatsapp-pc]"));
    expect(abrir).toHaveBeenCalledWith("", "_blank");
    expect(aba.location.href).toBe("https://wa.me/551133334444?text=x");
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toEqual({ canal: "WHATSAPP" });
    expect(texto($("[data-status-pedido]"))).toBe("Em cotação");
    expect(texto($('[data-evento="ENVIADO_WHATSAPP"]'))).toContain("Enviado ao fornecedor por WhatsApp");
    expect(mudou).toHaveBeenCalledWith(expect.objectContaining({ status: "COTANDO" }));
  });

  it("WhatsApp recusado: a aba aberta fecha e o erro aparece", async () => {
    const aba = { closed: false, opener: {}, location: { href: "" }, close: vi.fn() };
    vi.stubGlobal("open", vi.fn(() => aba));
    respostas["POST /api/pedidos-compra/pc1/enviar"] = { status: 409, corpo: { erro: "Pedido cancelada: não dá mais para enviar ao fornecedor." } };
    const { PedidoPainel } = await import("@/components/compras/pedido-painel");
    await renderizar(createElement(PedidoPainel, { inicial: PEDIDO }));
    await clicar($("[data-enviar-whatsapp-pc]"));
    expect(aba.close).toHaveBeenCalled();
    expect(avisos.toasts).toEqual([["Pedido cancelada: não dá mais para enviar ao fornecedor.", "erro"]]);
  });

  it("Baixar PDF abre o PC público para imprimir e registra; e-mail enviado avisa", async () => {
    const abrir = vi.fn(() => null);
    vi.stubGlobal("open", abrir);
    respostas["POST /api/pedidos-compra/pc1/enviar"] = { status: 200, corpo: { ok: true, status: "COTANDO", emailEnviado: true } };
    const { PedidoPainel } = await import("@/components/compras/pedido-painel");
    await renderizar(createElement(PedidoPainel, { inicial: PEDIDO }));
    await clicar($("[data-baixar-pc]"));
    expect(abrir).toHaveBeenCalledWith("/pedido-compra/tok1?imprimir=1", "_blank", "noopener");
    expect(chamadas.filter((c) => c.metodo === "POST").map((c) => c.corpo)).toEqual([{ canal: "BAIXAR" }]);
    await clicar($("[data-enviar-email-pc]"));
    expect(avisos.toasts).toContainEqual(["Pedido enviado por e-mail para vendas@frigelar.com.br.", "sucesso"]);
  });

  it("sem fornecedor / sem contato: e-mail e WhatsApp desabilitados com o motivo; baixar continua", async () => {
    const { PedidoPainel } = await import("@/components/compras/pedido-painel");
    await renderizar(createElement(PedidoPainel, { inicial: { ...PEDIDO, fornecedor: null } }));
    expect($<HTMLButtonElement>("[data-enviar-email-pc]")!.disabled).toBe(true);
    expect($("[data-enviar-email-pc]")!.getAttribute("title")).toBe("Escolha o fornecedor do pedido para enviar.");
    expect($<HTMLButtonElement>("[data-baixar-pc]")!.disabled).toBe(false);
    expect($("[data-aviso-sem-fornecedor]")).toBeTruthy();
    act(() => root.unmount());
    await renderizar(createElement(PedidoPainel, { inicial: { ...PEDIDO, fornecedor: { ...PEDIDO.fornecedor!, telefone: null } } }));
    expect($<HTMLButtonElement>("[data-enviar-email-pc]")!.disabled).toBe(false);
    expect($("[data-enviar-whatsapp-pc]")!.getAttribute("title")).toBe("O fornecedor Frigelar não tem telefone no cadastro.");
  });

  it("encerrado ou sem permissão: sem editar/cancelar; enviar desabilitado; só ver: nada", async () => {
    const { PedidoPainel } = await import("@/components/compras/pedido-painel");
    await renderizar(createElement(PedidoPainel, { inicial: { ...PEDIDO, status: "CONCLUIDO", podeEditar: false } }));
    expect($("[data-editar-pedido]")).toBeNull();
    expect($("[data-cancelar-pedido]")).toBeNull();
    expect($("[data-enviar-email-pc]")!.getAttribute("title")).toBe("Pedido encerrado: não dá mais para enviar.");
    expect($<HTMLButtonElement>("[data-baixar-pc]")!.disabled).toBe(false);
    act(() => root.unmount());
    await renderizar(createElement(PedidoPainel, { inicial: { ...PEDIDO, podeEditar: false, podeEnviar: false } }));
    expect($("[data-acoes-pedido]")!.children).toHaveLength(0);
  });

  it("Editar abre o editor inline; salvar volta com o pedido novo; Cancelar pede confirmação", async () => {
    respostas["PUT /api/pedidos-compra/pc1"] = { status: 200, corpo: { ...PEDIDO, observacao: "Nova obs", mudancas: ["Observação alterada"] } };
    const { PedidoPainel } = await import("@/components/compras/pedido-painel");
    await renderizar(createElement(PedidoPainel, { inicial: PEDIDO }));
    await clicar($("[data-editar-pedido]"));
    expect($('[data-editor-pedido="pc1"]')).toBeTruthy();
    expect($("[data-dados-pedido]")).toBeNull();
    await clicar($("[data-salvar-pedido]"));
    expect($("[data-editor-pedido]")).toBeNull();
    expect(texto($("[data-dados-pedido]"))).toContain("Nova obs");
    expect(avisos.toasts).toContainEqual(["Pedido atualizado.", "sucesso"]);

    avisos.confirmar = false;
    await clicar($("[data-cancelar-pedido]"));
    expect(chamadas.some((c) => c.url.endsWith("/cancelar"))).toBe(false);
    avisos.confirmar = true;
    respostas["GET /api/pedidos-compra/pc1"] = { status: 200, corpo: { ...PEDIDO, status: "CANCELADO", podeEditar: false } };
    await clicar($("[data-cancelar-pedido]"));
    expect(chamadas.some((c) => c.metodo === "POST" && c.url === "/api/pedidos-compra/pc1/cancelar")).toBe(true);
    expect(texto($("[data-status-pedido]"))).toBe("Cancelada");
    expect($("[data-cancelar-pedido]")).toBeNull();
  });
});

describe("seção Compras da OS", () => {
  it("abre o pedido ali mesmo (sem trocar de tela) e fecha de novo", async () => {
    respostas["GET /api/pedidos-compra?ordemServicoId=os1"] = { status: 200, corpo: [{ id: "pc1", numero: "PCI-2026-0002", status: "SOLICITADO", prazoNecessario: "2026-11-05", itens: [{ id: "i1", descricao: "Filtro", quantidade: "4", unidade: "un" }] }] };
    respostas["GET /api/pedidos-compra/pc1"] = { status: 200, corpo: PEDIDO };
    const { ComprasSecao } = await import("@/components/compras/compras-secao");
    await renderizar(createElement(ComprasSecao, { ordemServicoId: "os1" }));
    expect($("a[href='/compras/pedidos/pc1']")).toBeNull();
    await clicar($('[data-abrir-pedido="pc1"]'));
    expect($('[data-painel-pedido="pc1"]')).toBeTruthy();
    expect($('[data-abrir-pedido="pc1"]')!.getAttribute("aria-expanded")).toBe("true");
    await clicar($('[data-abrir-pedido="pc1"]'));
    expect($('[data-painel-pedido="pc1"]')).toBeNull();
    await clicar($("[data-solicitar-compra]"));
    expect($('[data-editor-pedido="novo"]')).toBeTruthy();
  });
});
