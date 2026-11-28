// @vitest-environment happy-dom
/**
 * ERRO NO CAMPO — a gaveta genérica de cadastro (CadastroPadrao: produtos, serviços, fornecedores…) e o editor de
 * usuário, num DOM de verdade:
 *  - obrigatório vazio: o campo fica marcado (aria-invalid, borda vermelha) com "<Rótulo> é obrigatório." logo
 *    abaixo, recebe o foco, e nada vai para o servidor; digitou, o erro some na hora;
 *  - o erro do SERVIDOR ({ erro, campos }: documento repetido, e-mail de login em uso) cai no campo certo;
 *  - o <select> da gaveta segue o mesmo padrão (aria-invalid/aria-describedby + borda);
 *  - formato ao sair do campo (e-mail).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let enviados: { url: string; metodo: string; corpo: any }[];
let resposta: { status: number; corpo: unknown };
beforeEach(() => {
  enviados = [];
  resposta = { status: 201, corpo: { id: "novo", nome: "x", ativo: true } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    if (metodo !== "GET") {
      enviados.push({ url, metodo, corpo: JSON.parse(String(init!.body)) });
      return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
    }
    const u = new URL(url, "http://localhost");
    const corpo = u.searchParams.get("sugestoes") === "1" ? { sugestoes: [] }
      : u.pathname.startsWith("/api/cadastros/") ? { itens: [], total: 0, pagina: 1, porPagina: 50, contagens: { ativos: 0, inativos: 0, todos: 0 } } : {};
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 40)); });
async function renderizar(el: React.ReactElement) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}
// A gaveta abre num portal: procura no documento todo
const campo = (nome: string) => document.querySelector(`[data-campo-nome="${nome}"]`) as HTMLElement;
const controle = (nome: string) => campo(nome).querySelector("input, select, textarea") as HTMLInputElement;
const mensagem = (nome: string) => campo(nome)?.querySelector("[data-erro-campo]")?.textContent ?? null;
function digitar(el: HTMLInputElement, v: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const botao = (texto: RegExp) => [...document.querySelectorAll("button")].find((b) => texto.test(b.textContent ?? ""))!;
async function clicar(b: HTMLElement) { await act(async () => { b.click(); }); await esperar(); }

async function abrirNovo(entidade: string) {
  const { CadastroPadrao } = await import("@/components/cadastros/cadastro-padrao");
  await renderizar(createElement(CadastroPadrao, { entidade } as any));
  await clicar(document.querySelector<HTMLElement>('[data-acao="novo-cadastro"]')!);
}

describe("gaveta genérica de cadastro", () => {
  it("obrigatório vazio: marcado no campo, com foco, sem ir ao servidor; digitou, some", async () => {
    await abrirNovo("fornecedores");
    await clicar(botao(/^\s*Salvar\s*$/));
    expect(enviados).toHaveLength(0);
    const nome = controle("nome");
    expect(nome.getAttribute("aria-invalid")).toBe("true");
    expect(nome.className).toContain("border-atrasado");
    expect(mensagem("nome")).toBe("Nome / razão social é obrigatório.");
    expect(document.getElementById(nome.getAttribute("aria-describedby")!)!.textContent).toBe("Nome / razão social é obrigatório.");
    expect(document.activeElement).toBe(nome);
    expect(document.querySelector("[data-resumo-erros]")!.textContent).toBe("Nome / razão social é obrigatório.");
    digitar(nome, "Frigelar");
    expect(nome.getAttribute("aria-invalid")).toBeNull();
    expect(mensagem("nome")).toBeNull();
    expect(document.querySelector("[data-resumo-erros]")).toBeNull();
  });

  it("o erro do servidor cai no campo certo: documento repetido", async () => {
    await abrirNovo("fornecedores");
    digitar(controle("nome"), "Frigelar");
    digitar(controle("documento"), "11.222.333/0001-81");
    const msg = "Já existe um fornecedor com este CNPJ/CPF: “Frigelar Matriz”.";
    resposta = { status: 409, corpo: { erro: msg, campos: { documento: msg } } };
    await clicar(botao(/^\s*Salvar\s*$/));
    expect(enviados).toHaveLength(1);
    expect(enviados[0].url).toBe("/api/cadastros/fornecedores");
    expect(mensagem("documento")).toBe(msg);
    expect(controle("documento").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(controle("documento"));
    expect(mensagem("nome")).toBeNull();
  });

  it("o erro geral do servidor (sem campo) fica só na faixa", async () => {
    await abrirNovo("fornecedores");
    digitar(controle("nome"), "Frigelar");
    resposta = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar(botao(/^\s*Salvar\s*$/));
    expect(document.querySelector("[data-resumo-erros]")!.textContent).toBe("Sem permissão para esta ação");
    expect(document.querySelector("[data-campo-com-erro]")).toBeNull();
  });

  it("e-mail com formato errado: acusa ao sair do campo", async () => {
    await abrirNovo("fornecedores");
    const email = controle("email");
    digitar(email, "contato@");
    expect(email.getAttribute("aria-invalid")).toBeNull();
    act(() => { email.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(mensagem("email")).toBe("E-mail inválido: confira o endereço.");
  });

  it("o <select> da gaveta também fica marcado com o erro do servidor", async () => {
    await abrirNovo("produtos");
    digitar(controle("nome"), "Gás R410A");
    resposta = { status: 400, corpo: { erro: "Unidade: inválida", campos: { unidade: "Escolha a unidade." } } };
    await clicar(botao(/^\s*Salvar\s*$/));
    const sel = controle("unidade") as unknown as HTMLSelectElement;
    expect(sel.tagName).toBe("SELECT");
    expect(sel.getAttribute("aria-invalid")).toBe("true");
    expect(sel.className).toContain("border-atrasado");
    expect(document.getElementById(sel.getAttribute("aria-describedby")!)!.textContent).toBe("Escolha a unidade.");
    // erro geral diferente do campo: a faixa traz os dois
    expect(document.querySelector("[data-resumo-erros]")!.textContent).toContain("Unidade: inválida");
    // trocou a opção: o erro some
    await act(async () => { sel.value = sel.options[1]?.value ?? sel.value; sel.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(sel.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("editor de usuário", () => {
  it("e-mail de login já usado: o erro do servidor fica no e-mail, com foco", async () => {
    const { criarEditorUsuario } = await import("@/components/cadastros/editores/editor-usuario");
    const Editor = criarEditorUsuario("u0");
    await renderizar(createElement(Editor, { item: null, aberto: true, onFechar: () => {}, onSalvo: () => {} } as any));
    await clicar(botao(/Criar e enviar convite/));
    expect(enviados).toHaveLength(0);
    expect(mensagem("nome")).toBe("Informe o nome.");
    expect(mensagem("email")).toBe("Informe o e-mail (é o login).");
    expect(document.querySelector("[data-resumo-erros]")!.textContent).toContain("2 campos para corrigir");
    digitar(controle("nome"), "Ana Lima");
    digitar(controle("email"), "ana@polar.ficticio");
    const msg = "Este e-mail já é login de outra pessoa.";
    resposta = { status: 409, corpo: { erro: msg, campos: { email: msg } } };
    await clicar(botao(/Criar e enviar convite/));
    expect(enviados).toHaveLength(1);
    expect(mensagem("email")).toBe(msg);
    expect(document.activeElement).toBe(controle("email"));
  });
});
