// @vitest-environment happy-dom
/**
 * OS-B — "Criar orçamento" sem sair da OS, num DOM de verdade:
 *  - o botão só aparece para quem pode criar orçamento (e "Vincular" só para quem edita a OS);
 *  - abre o construtor REAL do comercial (OrcamentoForm) numa gaveta, sem cabeçalho de página,
 *    com o cliente da OS travado e a OS já marcada;
 *  - salvar usa o mesmo POST /api/orcamentos, com a OS no vínculo (mesmo se desmarcada na lista);
 *    a gaveta fecha, o orçamento aparece na aba Comercial e a página recarrega os dados;
 *  - erro do servidor fica na gaveta; fechar com o construtor aberto pede confirmação.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: nav.back }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const DADOS = {
  clientes: [{ id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" }, { id: "c2", nome: "Padaria", nomeFantasia: null }],
  catalogoServicos: [{ id: "s1", nome: "Limpeza de split", descricao: null, unidade: "UN", valorPadrao: 180 }],
  catalogoProdutos: [], tecnicos: [], termoTemplates: [],
  clienteIdInicial: "c1", osInicialId: "os1",
  osInicial: { id: "os1", numero: "OS-2026-0301", descricao: "Corretiva", status: "EM_ANDAMENTO" },
};

beforeAll(async () => {
  await Promise.all([import("@/components/os/os-orcamentos-vinculados"), import("@/components/providers/permissoes-provider")]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  nav.push.mockClear(); nav.refresh.mockClear(); nav.back.mockClear();
  respostas = { "GET /api/orcamentos/form-dados": { status: 200, corpo: DADOS }, "GET /api/clientes/c1/tabela-preco": { status: 200, corpo: null } };
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function montar(permissoes: Permissoes = permissoesTotais(), vinculados: any[] = []) {
  const [{ OsOrcamentosVinculados }, { PermissoesProvider }] = await Promise.all([import("@/components/os/os-orcamentos-vinculados"), import("@/components/providers/permissoes-provider")]);
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(OsOrcamentosVinculados, { osId: "os1", clienteId: "c1", numeroOs: "OS-2026-0301", vinculados }) }));
  });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (texto: string, dentro = document.body) => [...dentro.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto) as HTMLElement | undefined;
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
const sem = (modulo: string, acao: string) => {
  const p = permissoesTotais() as any;
  p[modulo] = { ...p[modulo], [acao]: false };
  return p as Permissoes;
};
/** "Criar orçamento" da gaveta (o botão de envio do construtor: dispara o submit do form) */
async function criar() {
  expect(botao("Criar orçamento", $("[data-gaveta-orcamento]")!)?.getAttribute("type")).toBe("submit");
  await act(async () => { $("[data-gaveta-orcamento] form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await esperar();
}
async function montarOrcamento() {
  await digitar($("[data-gaveta-orcamento] input[placeholder^='Ex.: Manutenção']"), "Troca de capacitor");
  await digitar($("[data-gaveta-orcamento] input[placeholder='Buscar serviço por nome...']"), "Limpeza");
  await clicar([...document.querySelectorAll("[data-gaveta-orcamento] button")].find((b) => b.textContent?.includes("Limpeza de split")));
}

describe("criar orçamento sem sair da OS", () => {
  it("abre o construtor REAL do comercial numa gaveta, com o cliente da OS travado e a OS marcada", async () => {
    await montar();
    expect($("a[href^='/orcamentos/novo']")).toBeNull(); // não sai mais da OS
    await clicar($("[data-criar-orcamento]"));
    expect(chamadas.find((c) => c.url.startsWith("/api/orcamentos/form-dados"))?.url).toBe("/api/orcamentos/form-dados?osId=os1");
    expect($("[role='dialog']")?.textContent).toContain("Novo orçamento — OS-2026-0301");
    const form = $("[data-gaveta-orcamento] [data-orcamento-form]");
    expect(form?.getAttribute("data-orcamento-form")).toBe("embutido");
    expect(form?.querySelector("h1")).toBeNull(); // sem cabeçalho de página dentro da gaveta
    const cliente = [...form!.querySelectorAll("button[disabled]")].find((b) => b.textContent?.includes("Hospital Santa Clara"));
    expect(cliente).toBeTruthy();
    expect(form?.textContent).toContain("OS-2026-0301");
  });

  it("salvar: mesmo POST /api/orcamentos com a OS no vínculo; fecha, mostra na lista e recarrega a OS", async () => {
    respostas["POST /api/orcamentos"] = { status: 201, corpo: { id: "orcN", codigo: "ORC-0042", nome: "Troca de capacitor", status: "RASCUNHO", totalGeral: 180, criadoEm: "2026-10-30T13:00:00Z", validadeEm: null, tokenPublico: "t" } };
    await montar();
    await clicar($("[data-criar-orcamento]"));
    await montarOrcamento();
    await criar();
    const post = chamadas.find((c) => c.metodo === "POST");
    expect(post?.url).toBe("/api/orcamentos");
    expect(post?.corpo).toMatchObject({ nome: "Troca de capacitor", clienteId: "c1", ordensServicoIds: ["os1"], servicos: [expect.objectContaining({ catalogoId: "s1", valorUnitario: 180 })] });
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); }); // animação da gaveta
    expect($("[data-gaveta-orcamento]")).toBeNull();
    expect(nav.push).not.toHaveBeenCalled(); // não navegou para /orcamentos/…
    expect(nav.refresh).toHaveBeenCalled();
    expect(caixa.textContent).toContain("ORC-0042");
    expect(caixa.textContent).toContain("1 orçamento(s) vinculado(s).");
  });

  it("a OS de origem vai no vínculo mesmo se desmarcada na lista de OS do construtor", async () => {
    respostas["GET /api/ordens"] = { status: 200, corpo: [{ id: "os1", numero: "OS-2026-0301", descricao: "Corretiva", status: "EM_ANDAMENTO" }] };
    respostas["POST /api/orcamentos"] = { status: 201, corpo: { id: "orcN", codigo: "ORC-0043", nome: "X", status: "RASCUNHO", totalGeral: 180, criadoEm: "2026-10-30T13:00:00Z", tokenPublico: "t" } };
    await montar();
    await clicar($("[data-criar-orcamento]"));
    await montarOrcamento();
    const marca = [...document.querySelectorAll<HTMLInputElement>("[data-gaveta-orcamento] input[type='checkbox']")].find((c) => c.checked);
    expect(marca?.closest("label")?.textContent).toContain("OS-2026-0301");
    await clicar(marca);
    expect([...document.querySelectorAll<HTMLInputElement>("[data-gaveta-orcamento] input[type='checkbox']")].some((c) => c.checked)).toBe(false);
    await criar();
    expect(chamadas.find((c) => c.metodo === "POST")?.corpo.ordensServicoIds).toEqual(["os1"]);
  });

  it("erro do servidor fica na gaveta (nada some, nada navega)", async () => {
    respostas["POST /api/orcamentos"] = { status: 400, corpo: { erro: "OS inválida para este cliente." } };
    await montar();
    await clicar($("[data-criar-orcamento]"));
    await montarOrcamento();
    await criar();
    expect($("[data-gaveta-orcamento]")?.textContent).toContain("OS inválida para este cliente.");
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(caixa.textContent).toContain("Nenhum orçamento vinculado");
  });

  it("Cancelar pede confirmação e fecha sem gravar; recusar a confirmação mantém o que foi montado", async () => {
    await montar();
    await clicar($("[data-criar-orcamento]"));
    await montarOrcamento();
    (window.confirm as any).mockReturnValueOnce(false);
    await clicar(botao("Cancelar", $("[data-gaveta-orcamento]")!));
    expect($("[data-gaveta-orcamento] input[placeholder^='Ex.: Manutenção']")?.getAttribute("value") ?? ($("[data-gaveta-orcamento] input[placeholder^='Ex.: Manutenção']") as HTMLInputElement)?.value).toBe("Troca de capacitor");
    await clicar(botao("Cancelar", $("[data-gaveta-orcamento]")!));
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect($("[data-gaveta-orcamento]")).toBeNull();
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);
    expect(nav.back).not.toHaveBeenCalled(); // não volta a página
  });

  it("falha ao abrir (sem permissão no servidor) mostra o erro na gaveta", async () => {
    respostas["GET /api/orcamentos/form-dados"] = { status: 403, corpo: { erro: "Sem permissão" } };
    await montar();
    await clicar($("[data-criar-orcamento]"));
    expect($("[data-gaveta-orcamento] [role='alert']")?.textContent).toBe("Sem permissão");
    expect($("[data-orcamento-form]")).toBeNull();
  });

  it("vincular existente: depois do router.refresh() a lista acompanha a OS recarregada", async () => {
    await montar();
    expect(caixa.textContent).toContain("Nenhum orçamento vinculado");
    const [{ OsOrcamentosVinculados }, { PermissoesProvider }] = await Promise.all([import("@/components/os/os-orcamentos-vinculados"), import("@/components/providers/permissoes-provider")]);
    const vinc = [{ id: "v9", orcamento: { id: "o9", codigo: "ORC-0009", nome: "Do servidor", status: "ENVIADO", totalGeral: 90, criadoEm: "2026-10-01T13:00:00Z", tokenPublico: "t" } }];
    await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(OsOrcamentosVinculados, { osId: "os1", clienteId: "c1", numeroOs: "OS-2026-0301", vinculados: vinc }) })); });
    await esperar();
    expect(caixa.textContent).toContain("ORC-0009");
  });

  it("RBAC na tela: sem orcamentos.criar não há 'Criar orçamento'; sem ordens.editar não há vincular/desvincular", async () => {
    const vinc = [{ id: "v1", orcamento: { id: "o1", codigo: "ORC-0001", nome: "Antigo", status: "APROVADO", totalGeral: 500, criadoEm: "2026-10-01T13:00:00Z", tokenPublico: "t" } }];
    await montar(sem("orcamentos", "criar"), vinc);
    expect($("[data-criar-orcamento]")).toBeNull();
    expect(botao("Vincular existente")).toBeTruthy();
    act(() => root.unmount()); caixa.remove();
    await montar(sem("ordens", "editar"), vinc);
    expect($("[data-criar-orcamento]")).toBeTruthy();
    expect(botao("Vincular existente")).toBeUndefined();
    expect($("button[title='Desvincular']")).toBeNull();
  });
});
