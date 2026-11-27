// @vitest-environment happy-dom
/**
 * Leva G — as telas, num DOM de verdade:
 *  - TabelaPro: a linha com `aoAbrir` (sem `href`) abre o editor ao clicar (a caixa de seleção e os botões não
 *    abrem); a coluna "grudada" fica presa à direita — a lista de Produtos/Serviços numa gaveta estreita não perde
 *    o Editar;
 *  - grade do orçamento: o preço que veio da tabela do cliente aparece travado (sem campo); destravado, campo;
 *  - editor da tabela de preço: sem os dois botões de bloqueio; caixa por linha, "Selecionar todos" do filtro e
 *    "Adicionar selecionados" de uma vez; o salvar manda o bloqueio sempre desligado;
 *  - Meu perfil: o perfil de acesso uma vez só; abas Dados/Segurança(/Preferências); a aba pela URL; o "Salvar" só
 *    com mudança e só o que mudou no corpo;
 *  - botão de anotações: arrastar (ponteiro: mouse e dedo) move e grava por usuário; o clique depois do arraste não
 *    liga o modo; o clique parado liga; "voltar à posição padrão" limpa; posição gravada fora da tela volta para dentro.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const roteador = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => roteador, usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, update: vi.fn(async () => null) }) }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));
vi.mock("@/components/push/notificacoes-aparelho", () => ({ NotificacoesAparelho: () => createElement("div", { "data-notificacoes": "" }, "notificações") }));

let raiz: Root | null = null;
let caixa: HTMLDivElement;
const chamadas: { url: string; init?: RequestInit }[] = [];
let respostas: Record<string, unknown> = {};

beforeEach(() => {
  chamadas.length = 0;
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push({ url: String(url), init });
    const k = Object.keys(respostas).find((x) => String(url).startsWith(x));
    return new Response(JSON.stringify(k ? respostas[k] : {}), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  try { window.localStorage.clear(); } catch { /* sem armazenamento */ }
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
});
afterEach(() => { act(() => raiz?.unmount()); raiz = null; caixa.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: ReactElement) { raiz = createRoot(caixa); await act(async () => { raiz!.render(el); }); await esperar(); }
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}

describe("TabelaPro — a linha abre o editor (aoAbrir) e as ações ficam presas à direita", () => {
  it("clicar na linha chama aoAbrir; a caixa e o botão da linha não; a coluna grudada tem a marca", async () => {
    const { TabelaPro } = await import("@/components/listagem/tabela-pro");
    const abrir = vi.fn();
    const editar = vi.fn();
    await montar(createElement(TabelaPro, {
      tela: "teste-leva-g",
      colunas: [{ id: "sel", titulo: "Sel", fixa: true }, { id: "nome", titulo: "Nome" }, { id: "acoes", titulo: "Ações", fixa: true, grudada: true }],
      linhas: [
        { id: "a", aoAbrir: abrir, celulas: { sel: createElement("input", { type: "checkbox", "data-caixa": "" }), nome: "Capacitor", acoes: createElement("button", { type: "button", onClick: editar, "data-editar": "" }, "Editar") } },
        { id: "b", celulas: { sel: null, nome: "Só leitura", acoes: null } },
      ],
    } as any));
    const linha = $('tr[data-linha="a"]')!;
    expect(linha.hasAttribute("data-abrir")).toBe(true);
    expect(linha.getAttribute("tabindex")).toBe("0");
    await clicar(linha.querySelector('[data-celula="nome"]'));
    expect(abrir).toHaveBeenCalledTimes(1);
    await clicar($("[data-caixa]"));
    await clicar($("[data-editar]"));
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(editar).toHaveBeenCalledTimes(1);
    // Enter na linha também abre
    await act(async () => { linha.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(abrir).toHaveBeenCalledTimes(2);
    // Sem href nem aoAbrir: a linha é só leitura
    const b = $('tr[data-linha="b"]')!;
    expect(b.hasAttribute("data-abrir")).toBe(false);
    expect(b.hasAttribute("tabindex")).toBe(false);
    // A coluna de ações presa à direita (célula e cabeçalho)
    const td = linha.querySelector('[data-celula="acoes"]')!;
    expect(td.hasAttribute("data-grudada")).toBe(true);
    expect(td.className).toMatch(/\bsticky\b/);
    expect(td.className).toMatch(/\bright-0\b/);
    expect($('th[data-coluna="acoes"]')!.className).toMatch(/\bsticky\b/);
    expect(linha.querySelector('[data-celula="nome"]')!.className).not.toMatch(/\bsticky\b/);
  });
});

describe("grade do orçamento — preço de tabela travado", () => {
  it("travado: sem campo, com o cadeado e o aviso; destravado (com a permissão): campo editável", async () => {
    const { ItensTabela } = await import("@/components/orcamento/itens-tabela");
    const item = (bloqueado: boolean) => ({ id: "i1", catalogoId: "s1", descricao: "Limpeza", quantidade: 1, valorUnitario: 150, origemPreco: "contrato" as const, valorTabela: 150, bloqueado });
    await montar(createElement(ItensTabela, { titulo: "Serviços", catalogo: [], itens: [item(true)], onChange: () => {}, tabela: { nome: "Contrato", tipo: "PERSONALIZADA", itens: { s1: { valorFinal: 150, tipoPreco: "VALOR_FIXO", descontoPercent: null } } } } as any));
    expect($('[data-campo="unitario"]')).toBeNull();
    expect($('[title="Preço definido em contrato — não pode ser alterado"]')).toBeTruthy();
    act(() => raiz!.unmount()); raiz = null;
    await montar(createElement(ItensTabela, { titulo: "Serviços", catalogo: [], itens: [item(false)], onChange: () => {}, podeAlterarPrecoTabela: true } as any));
    expect($('[data-campo="unitario"]')).toBeTruthy();
  });
});

describe("editor da tabela de preço — sem bloqueio, adicionar em massa", () => {
  beforeEach(() => {
    respostas = {
      "/api/cadastros/servicos": [{ id: "s1", nome: "Limpeza de split", codigo: "LIMP01", valorPadrao: 200 }, { id: "s2", nome: "Instalação", codigo: "INST01", valorPadrao: 800 }],
      "/api/cadastros/produtos": [{ id: "p1", nome: "Filtro secador", codigo: 7, valorPadrao: 35 }, { id: "p2", nome: "Gás R410A", codigo: 8, valorPadrao: 120 }],
      "/api/cadastros/tabelas-preco": { id: "t1", nome: "Contrato fictício", ativo: true },
    };
  });

  it("não há mais os botões de bloqueio; filtrar, selecionar todos do filtro, adicionar de uma vez e salvar sem bloqueio", async () => {
    const { EditorTabelaPreco } = await import("@/components/cadastros/editores/editor-tabela-preco");
    const onSalvo = vi.fn();
    await montar(createElement(EditorTabelaPreco, { item: null, aberto: true, onFechar: () => {}, onSalvo } as any));
    const tela = () => document.body.textContent ?? "";
    expect(tela()).not.toMatch(/Preços bloqueados|Preço bloqueado/);
    expect($$("[data-opcao-catalogo]")).toHaveLength(4);
    expect(($("[data-adicionar-selecionados]") as HTMLButtonElement).disabled).toBe(true);
    // Só produtos → selecionar todos (2) → adicionar
    const tipo = $<HTMLSelectElement>("[data-filtro-tipo]")!;
    await act(async () => { tipo.value = "PRODUTO"; tipo.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
    expect($$("[data-opcao-catalogo]").map((e) => e.getAttribute("data-opcao-catalogo"))).toEqual(["p1", "p2"]);
    expect(tela()).toContain("Selecionar todos do filtro (2)");
    await clicar($("[data-selecionar-todos]"));
    expect($("[data-contagem-selecionados]")!.textContent).toBe("2 selecionados");
    await clicar($("[data-adicionar-selecionados]"));
    // Os dois entraram na tabela e saíram da lista de escolha
    expect(tela()).toContain("Filtro secador");
    expect(tela()).toContain("Gás R410A");
    expect($$("[data-opcao-catalogo]")).toHaveLength(0);
    expect($("[data-contagem-selecionados]")!.textContent).toBe("Nenhum selecionado");
    // Um serviço pela busca + caixa da linha
    await act(async () => { tipo.value = "TODOS"; tipo.dispatchEvent(new Event("change", { bubbles: true })); });
    await digitar($('input[aria-label="Filtrar serviços e produtos"]'), "limp01");
    expect($$("[data-opcao-catalogo]").map((e) => e.getAttribute("data-opcao-catalogo"))).toEqual(["s1"]);
    await clicar($('[data-opcao-catalogo="s1"] input'));
    await clicar($("[data-adicionar-selecionados]"));
    // Salvar: nome + itens; o bloqueio vai desligado
    await digitar($('input[placeholder="Ex.: Contrato, Belma"]'), "Contrato fictício");
    await clicar([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Criar"));
    const post = chamadas.find((c) => c.url.startsWith("/api/cadastros/tabelas-preco") && c.init?.method === "POST")!;
    const corpo = JSON.parse(String(post.init!.body));
    expect(corpo.precosBloqueados).toBe(false);
    expect(corpo.itens.map((i: any) => [i.servicoId ?? i.produtoId, i.bloqueado, i.valorFixo])).toEqual([["p1", false, "35"], ["p2", false, "120"], ["s1", false, "200"]]);
  });
});

describe("Meu perfil — redesenho", () => {
  const initial = { nome: "Ana Fictícia", email: "ana@ficticio.test", telefone: "", avatar: null, empresaNome: "Clima Fictícia", perfilNome: null, cargo: "Administrador", ultimoAcesso: "2026-11-27T12:00:00.000Z" };
  const PerfilClient = async () => (await import("@/components/perfil/perfil-client")).PerfilClient;

  it("o perfil de acesso aparece uma vez; abas Dados e Segurança (sem as notificações); a da URL abre", async () => {
    const P = await PerfilClient();
    await montar(createElement(P, { initial, abaPedida: "seguranca" }));
    const topo = $("[data-topo-perfil]")!.textContent!;
    expect(topo.match(/Administrador/g)).toHaveLength(1);
    expect($("[data-linha-conta]")!.textContent).toBe("Administrador · Clima Fictícia");
    expect($$("[data-aba]").map((b) => b.textContent)).toEqual(["Dados", "Segurança"]);
    expect($('[data-aba="seguranca"]')!.getAttribute("aria-current")).toBe("page");
    expect($('[data-bloco="senha"]')).toBeTruthy();
    expect($("[data-ultimo-acesso]")!.textContent).toMatch(/27\/11\/2026/);
    expect($$("[data-trocar-senha]")).toHaveLength(1);
  });

  it("com as notificações: a aba Preferências; o nome antigo da aba leva ao lugar novo", async () => {
    const P = await PerfilClient();
    await montar(createElement(P, { initial, notificacoes: true, abaPedida: "notificacoes" }));
    expect($$("[data-aba]").map((b) => b.textContent)).toEqual(["Dados", "Segurança", "Preferências"]);
    expect($("[data-notificacoes]")).toBeTruthy();
  });

  it("Dados: o Salvar só com mudança, e o corpo leva só o que mudou (o telefone novo)", async () => {
    respostas = { "/api/perfil": { nome: "Ana Fictícia", email: "ana@ficticio.test", telefone: "(11) 90000-0000" } };
    const P = await PerfilClient();
    await montar(createElement(P, { initial }));
    const salvar = $<HTMLButtonElement>("[data-salvar-dados]")!;
    expect(salvar.disabled).toBe(true);
    await digitar($("[data-telefone]"), "(11) 90000-0000");
    expect(salvar.disabled).toBe(false);
    await clicar(salvar);
    const patch = chamadas.find((c) => c.url === "/api/perfil")!;
    expect(patch.init!.method).toBe("PATCH");
    expect(JSON.parse(String(patch.init!.body))).toEqual({ telefone: "(11) 90000-0000" });
  });
});

describe("botão de anotações — arrastar e lembrar", () => {
  const Ferramenta = async () => (await import("@/components/anotacoes/ferramenta")).AnotacoesFerramenta;
  const ponteiro = async (el: Element, tipo: string, x: number, y: number) => {
    await act(async () => {
      const ev = new MouseEvent(tipo, { bubbles: true, clientX: x, clientY: y, button: 0 }) as any;
      Object.defineProperty(ev, "pointerId", { value: 1 });
      el.dispatchEvent(ev);
    });
  };
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    (Element.prototype as any).setPointerCapture = () => {};
  });

  it("arrastar move, grava por usuário e não liga o modo; clicar parado liga; voltar ao padrão limpa", async () => {
    const F = await Ferramenta();
    await montar(createElement(F, { usuarioId: "uDono" }));
    const botao = $("[data-anotacoes-botao]")!;
    expect(botao.getAttribute("style") ?? "").not.toMatch(/left/);
    expect(botao.className).toMatch(/right-4/);
    // happy-dom: o retângulo do botão começa em 0,0
    await ponteiro(botao, "pointerdown", 100, 100);
    await ponteiro(botao, "pointermove", 102, 101); // abaixo do limiar: ainda não é arraste
    expect(botao.getAttribute("style") ?? "").not.toMatch(/left/);
    await ponteiro(botao, "pointermove", 400, 300);
    await ponteiro(botao, "pointerup", 400, 300);
    await clicar(botao); // o clique que o navegador dispara depois do arraste
    expect(botao.getAttribute("aria-pressed")).toBe("false");
    expect((botao as HTMLElement).style.left).toBe("300px");
    expect((botao as HTMLElement).style.top).toBe("200px");
    expect(botao.className).not.toMatch(/right-4/);
    expect(JSON.parse(window.localStorage.getItem("frivo:anotacoes-botao:uDono")!)).toEqual({ x: 300, y: 200 });
    expect(window.localStorage.getItem("frivo:anotacoes-botao:outro")).toBeNull();
    // Clique parado: liga o modo
    await clicar(botao);
    expect(botao.getAttribute("aria-pressed")).toBe("true");
    await clicar(botao);
    // Voltar à posição padrão
    await clicar($("[data-anotacoes-voltar]"));
    expect((botao as HTMLElement).style.left).toBe("");
    expect(botao.className).toMatch(/right-4/);
    expect(window.localStorage.getItem("frivo:anotacoes-botao:uDono")).toBeNull();
    expect($("[data-anotacoes-voltar]")).toBeNull();
  });

  it("a posição gravada fora da tela (janela menor) volta para dentro; gravação estragada é ignorada", async () => {
    window.localStorage.setItem("frivo:anotacoes-botao:uDono", JSON.stringify({ x: 5000, y: -40 }));
    const F = await Ferramenta();
    await montar(createElement(F, { usuarioId: "uDono" }));
    const botao = $<HTMLElement>("[data-anotacoes-botao]")!;
    expect(parseInt(botao.style.left)).toBeLessThanOrEqual(1440 - 8);
    expect(botao.style.top).toBe("8px");
    act(() => raiz!.unmount()); raiz = null; document.body.innerHTML = ""; caixa = document.createElement("div"); document.body.appendChild(caixa);
    window.localStorage.setItem("frivo:anotacoes-botao:uDono", "lixo");
    await montar(createElement(F, { usuarioId: "uDono" }));
    expect($<HTMLElement>("[data-anotacoes-botao]")!.style.left).toBe("");
  });
});
