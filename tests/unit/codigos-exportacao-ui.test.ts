// @vitest-environment happy-dom
/**
 * Códigos e planilha de ida e volta — num DOM de verdade:
 *  - "Baixar planilha" ao lado do "Importar": aparece para quem VÊ o módulo (mesmo sem poder criar);
 *    sem ver, não aparece; o link é o da exportação daquela entidade;
 *  - lista de produtos/serviços: coluna Código (fonte mono); no celular o cartão traz "código + nome";
 *  - busca de itens do orçamento/medição acha pelo código e mostra o código;
 *  - o assistente de importação explica que a planilha baixada atualiza (id_sistema/código).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
}));

const PRODUTOS = [
  { id: "p1", codigo: 1, nome: "Gás R410A", unidade: "kg", valorPadrao: 800, estoqueMinimo: 2, ativo: true },
  { id: "p2", codigo: 15, nome: "Capacitor 35uF", unidade: "un", valorPadrao: 38.9, estoqueMinimo: null, ativo: true },
];
let root: Root;
let caixa: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = new URL(url, "http://localhost");
    const corpo = u.searchParams.get("sugestoes") === "1" ? { sugestoes: [] }
      : u.pathname.startsWith("/api/cadastros/") ? { itens: PRODUTOS, total: 2, pagina: 1, porPagina: 50, contagens: { ativos: 2, inativos: 0, todos: 2 } } : {};
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
async function renderizar(el: React.ReactElement, permissoes: Permissoes = permissoesTotais(), role = "OPERADOR") {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role, permissoes, children: el })); });
  await esperar();
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)];
const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("Baixar planilha", () => {
  it("link da exportação da entidade, com o rótulo curto no celular", async () => {
    const { BaixarPlanilha } = await import("@/components/importacao/baixar-planilha");
    await renderizar(createElement(BaixarPlanilha, { entidade: "produtos" }), montarPermissoes({ configuracoes: ["visualizar"] }));
    const a = $<HTMLAnchorElement>('[data-acao="baixar-planilha"]')!;
    expect(a.getAttribute("href")).toBe("/api/importacao/produtos/exportar");
    expect(a.hasAttribute("download")).toBe(true);
    // rótulo curto ("Baixar") no celular, completo no desktop
    expect([...a.querySelectorAll("span")].map((s) => [s.textContent, s.className])).toEqual([["Baixar", "sm:hidden"], ["Baixar planilha", "hidden sm:inline"]]);
    expect(a.getAttribute("title")).toBe("Baixar a planilha com todos os produtos (mesmo formato da importação)");
  });

  it("sem ver o módulo, não aparece; cada entidade pede o seu módulo", async () => {
    const { BaixarPlanilha } = await import("@/components/importacao/baixar-planilha");
    const caso = async (entidade: "produtos" | "clientes" | "fornecedores", p: Permissoes) => {
      await renderizar(createElement(BaixarPlanilha, { entidade }), p);
      const tem = !!$('[data-acao="baixar-planilha"]');
      act(() => root.unmount()); caixa.remove();
      return tem;
    };
    expect(await caso("produtos", montarPermissoes({ clientes: ["visualizar"] }))).toBe(false);
    expect(await caso("clientes", montarPermissoes({ clientes: ["visualizar"] }))).toBe(true);
    expect(await caso("fornecedores", montarPermissoes({ financeiro: ["visualizar"] }))).toBe(true);
    expect(await caso("fornecedores", montarPermissoes({ configuracoes: ["visualizar"] }))).toBe(true);
    expect(await caso("fornecedores", montarPermissoes({ ordens: ["visualizar"] }))).toBe(false);
  });

  it("na lista: quem só VÊ tem Baixar (sem Importar/Novo); quem cria tem os três", async () => {
    const { CadastroPadrao } = await import("@/components/cadastros/cadastro-padrao");
    await renderizar(createElement(CadastroPadrao, { entidade: "produtos" }), montarPermissoes({ configuracoes: ["visualizar"] }));
    expect($('[data-acao="baixar-planilha"]')).toBeTruthy();
    expect($('[data-acao="importar-planilha"]')).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await renderizar(createElement(CadastroPadrao, { entidade: "produtos" }));
    expect($('[data-acao="baixar-planilha"]')).toBeTruthy();
    expect($('[data-acao="importar-planilha"]')).toBeTruthy();
  });
});

describe("código na lista", () => {
  it("coluna Código em fonte mono; no celular, o título do cartão é código + nome", async () => {
    const { CadastroPadrao } = await import("@/components/cadastros/cadastro-padrao");
    await renderizar(createElement(CadastroPadrao, { entidade: "produtos" }));
    const cabecalho = $$("thead th").map((th) => texto(th));
    expect(cabecalho[1]).toContain("Cód.");
    const cartao = $('[data-cartao="p2"]')!;
    const titulo = cartao.querySelector(".text-sm")!;
    const cod = titulo.querySelector("[data-codigo]")!;
    expect(cod.textContent).toBe("15");
    expect(cod.className).toContain("font-mono");
    expect(texto(titulo)).toBe("15Capacitor 35uF"); // código (span separado, com margem) + nome
    // Código e nome não se repetem embaixo
    expect([...cartao.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Unidade", "Valor padrão", "Est. mín."]);
  });
});

describe("busca de itens do orçamento", () => {
  it("acha pelo código (número do produto / começo do código do serviço) e mostra o código", async () => {
    const { ItensTabela } = await import("@/components/orcamento/itens-tabela");
    const catalogo = [{ id: "s1", codigo: "LIMP01", nome: "Limpeza de Filtro", valorPadrao: 80 }, { id: "s2", codigo: "MANU01", nome: "Manutenção", valorPadrao: 350 }];
    await renderizar(createElement(ItensTabela, { titulo: "Serviços", labelAdicionar: "Buscar serviço por nome ou código...", catalogo, itens: [], onChange: () => {} }));
    const campo = $<HTMLInputElement>('input[placeholder="Buscar serviço por nome ou código..."]')!;
    await act(async () => {
      campo.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, "limp01"); // só o código: o nome “Limpeza…” não contém “limp01”
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await esperar();
    const opcoes = $$("[data-codigo-item]").map((e) => e.textContent);
    expect(opcoes).toEqual(["LIMP01"]);
    expect(texto($("[data-codigo-item]")!.parentElement)).toBe("LIMP01Limpeza de Filtro"); // span do código + nome
    expect($("[data-codigo-item]")!.className).toContain("mr-1.5");
  });
});

describe("assistente de importação", () => {
  it("explica que a planilha baixada atualiza pelo id_sistema (e código, onde há)", async () => {
    const { ImportarPlanilha } = await import("@/components/importacao/importar-planilha");
    await renderizar(createElement(ImportarPlanilha, { entidade: "servicos" }));
    await act(async () => { $<HTMLButtonElement>('[data-acao="importar-planilha"]')!.click(); });
    await esperar();
    expect(texto(document.querySelector("[data-dica-exportar]"))).toContain("id_sistema e o código de cada serviço");
    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
    await renderizar(createElement(ImportarPlanilha, { entidade: "clientes" }));
    await act(async () => { $<HTMLButtonElement>('[data-acao="importar-planilha"]')!.click(); });
    await esperar();
    const dica = texto(document.querySelector("[data-dica-exportar]"));
    expect(dica).toContain("id_sistema de cada cliente");
    expect(dica).not.toContain("código");
  });
});
