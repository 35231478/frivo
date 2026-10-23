// @vitest-environment happy-dom
/**
 * UX-1 "Dinheiro sem atrito" — princípio 1 (cadastro inline) e princípio 3 (feedback sempre):
 *  - SeletorCadastro ganha "+ Novo …": abre o cadastro rápido (campos do registro), cria pela
 *    API genérica e JÁ SELECIONA o criado — sem sair da tela, sem "cadastre e recarregue";
 *  - RBAC: sem a permissão de criar do registro a opção não aparece; cadastro com editor
 *    próprio (ex.: modelo de prazo) e seletor usado como filtro (semCriar) também não;
 *  - erro da API aparece DENTRO do mini-cadastro (não grava em silêncio);
 *  - os-orcamento da OS: adicionar item e "Marcar executado" deixam de falhar em silêncio.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PermissoesProvider } from "@/components/providers/permissoes-provider";
import { permissoesTotais, montarPermissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

let root: Root; let caixa: HTMLDivElement;
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const esperar = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
const clicar = async (el: Element | null | undefined) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function escolher(select: Element | null, v: string) {
  expect(select).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, v);
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}
async function montar(el: any, permissoes = permissoesTotais(), role = "OPERADOR") {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role, permissoes, children: el })); });
  await esperar();
}

/* ───────── SeletorCadastro com cadastro inline ───────── */

function stubApiCadastros(opts: { postStatus?: number; postResposta?: unknown } = {}) {
  const chamadas: { url: string; metodo: string; corpo?: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push({ url, metodo: init?.method ?? "GET", corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.startsWith("/api/cadastros/") && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify([{ id: "f1", nome: "Frigelar", ativo: true }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("/api/cadastros/") && init?.method === "POST") {
      return new Response(JSON.stringify(opts.postResposta ?? { id: "f9", nome: "Nova Peças Ltda", ativo: true }),
        { status: opts.postStatus ?? 201, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  }));
  return chamadas;
}

async function montarSeletor(props: Record<string, unknown> = {}, permissoes = permissoesTotais()) {
  const { SeletorCadastro } = await import("@/components/cadastros/seletor-cadastro");
  function Tela() {
    const [v, setV] = useState("");
    return createElement("div", null,
      createElement(SeletorCadastro, { entidade: "fornecedores", valor: v, onChange: (nv: string) => setV(nv), vazio: "Selecione…", ...props }),
      createElement("output", { "data-valor": true }, v),
    );
  }
  await montar(createElement(Tela), permissoes);
}

describe("UX-1: SeletorCadastro cria sem sair da tela", () => {
  it("'+ Novo fornecedor…' abre o mini-cadastro, cria pela API e já seleciona o criado", async () => {
    const chamadas = stubApiCadastros();
    await montarSeletor();
    const select = $("select[data-seletor-cadastro=fornecedores]")!;
    expect(select.textContent).toContain("Frigelar");
    expect($("option[data-criar]")!.textContent).toContain("Novo fornecedor");

    await escolher(select, "__criar__");
    // abriu o modal (sem gravar nada) e o select não ficou preso na opção de criar
    expect($("[role=dialog]")).not.toBeNull();
    expect((select as HTMLSelectElement).value).toBe("");
    // campos do registro (sem os de grupo): nome, documento, telefone, e-mail, observações
    expect($("[role=dialog]")!.textContent).toContain("Nome / razão social");
    expect($("[role=dialog]")!.textContent).toContain("CNPJ / CPF");
    // link para o cadastro completo vem do registro (def.rota)
    expect($<HTMLAnchorElement>("[role=dialog] a[target=_blank]")!.getAttribute("href")).toBe("/financeiro/fornecedores");

    // obrigatório vazio não envia nada
    await clicar($$("[role=dialog] button").find((b) => b.textContent!.includes("Salvar")));
    expect($("[role=dialog]")!.textContent).toContain("Preencha os campos obrigatórios");
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);

    await digitar($("[role=dialog] input"), "Nova Peças Ltda");
    await clicar($$("[role=dialog] button").find((b) => b.textContent!.includes("Salvar")));
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([
      { url: "/api/cadastros/fornecedores", metodo: "POST", corpo: { nome: "Nova Peças Ltda" } },
    ]);
    // modal fechou, o criado entrou na lista e JÁ está selecionado
    expect($("[role=dialog]")).toBeNull();
    expect($("[data-valor]")!.textContent).toBe("f9");
    expect((select as HTMLSelectElement).value).toBe("f9");
    expect(select.textContent).toContain("Nova Peças Ltda");
  });

  it("erro da API aparece dentro do mini-cadastro e nada é selecionado", async () => {
    stubApiCadastros({ postStatus: 400, postResposta: { erro: "Já existe um fornecedor com esse nome." } });
    await montarSeletor();
    await escolher($("select[data-seletor-cadastro=fornecedores]"), "__criar__");
    await digitar($("[role=dialog] input"), "Frigelar");
    await clicar($$("[role=dialog] button").find((b) => b.textContent!.includes("Salvar")));
    expect($("[role=dialog]")!.textContent).toContain("Já existe um fornecedor com esse nome.");
    expect($("[data-valor]")!.textContent).toBe("");
  });

  it("RBAC: sem a permissão de criar do registro a opção não aparece (mas a lista segue)", async () => {
    stubApiCadastros();
    // financeiro.visualizar lista fornecedores, mas criar exige fluxoCaixa (ou configurações.gerenciar)
    await montarSeletor({}, montarPermissoes({ financeiro: ["visualizar"] }));
    expect($("select[data-seletor-cadastro=fornecedores]")!.textContent).toContain("Frigelar");
    expect($("option[data-criar]")).toBeNull();
  });

  it("cadastro com editor próprio e seletor com semCriar ficam sem a opção", async () => {
    stubApiCadastros();
    const { SeletorCadastro } = await import("@/components/cadastros/seletor-cadastro");
    await montar(createElement("div", null,
      createElement(SeletorCadastro, { entidade: "modelos-prazo", valor: "", onChange: () => {} }),
      createElement(SeletorCadastro, { entidade: "fornecedores", valor: "", onChange: () => {}, semCriar: true }),
    ));
    expect($("select[data-seletor-cadastro=modelos-prazo]")!.querySelector("option[data-criar]")).toBeNull();
    expect($("select[data-seletor-cadastro=fornecedores]")!.querySelector("option[data-criar]")).toBeNull();
  });
});

/* ───────── os-orcamento: gravação nunca falha em silêncio ───────── */

describe("UX-1: orçamento da OS avisa quando a gravação falha", () => {
  const ITEM = { id: "i1", descricao: "Gás R410A", quantidade: 1, valorUnitario: 100, valorTotal: 100, executado: false };

  it("'Marcar executado' que falha mostra o motivo (e sucesso atualiza a linha)", async () => {
    const { OsOrcamento } = await import("@/components/os/os-orcamento");
    let status = 403;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify(status === 200 ? { ...ITEM, executado: true } : { erro: "Sem permissão para esta ação" }),
      { status, headers: { "content-type": "application/json" } })));
    await montar(createElement(OsOrcamento, { osId: "os1", itens: [ITEM] }));
    await clicar($$("button").find((b) => b.textContent!.includes("Marcar executado")));
    expect($("[data-erro-orcamento]")!.textContent).toBe("Sem permissão para esta ação");
    status = 200;
    await clicar($$("button").find((b) => b.textContent!.includes("Marcar executado")));
    expect($("[data-erro-orcamento]")).toBeNull();
    expect(caixa.textContent).toContain("Executado");
  });

  it("adicionar item sem rede mostra 'Erro de conexão' (nada some em silêncio)", async () => {
    const { OsOrcamento } = await import("@/components/os/os-orcamento");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await montar(createElement(OsOrcamento, { osId: "os1", itens: [] }));
    await clicar($$("button").find((b) => b.textContent!.includes("Adicionar item")));
    const inputs = $$("input");
    await digitar(inputs[0], "Gás R410A");
    await digitar(inputs[2], "100");
    await clicar($$("button").find((b) => b.textContent!.trim() === "Adicionar"));
    expect($("[data-erro-orcamento]")!.textContent).toContain("Erro de conexão");
  });
});
