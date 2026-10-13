// @vitest-environment happy-dom
/**
 * Padrão de listas — tela (CadastroPadrao real num DOM de verdade, happy-dom). A URL é reativa
 * (useSearchParams/router.replace simulados) e a API é uma rota falsa que pagina/busca/ordena
 * como o servidor. Prova o comportamento que o usuário vê:
 *  - paginação: tamanho 25/50/100 (lembrado), avançar/voltar/número, "Mostrando X–Y de Z";
 *  - busca ao vivo: filtra conforme digita com debounce de 300 ms, sem Enter; "x" limpa;
 *  - sugestões compactas (≤5) e escolher uma aplica o filtro;
 *  - ordenar clicando no cabeçalho (asc → desc); estado vazio claro; esqueleto ao carregar;
 *  - atalho "/" foca a busca; no celular, cartões.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

/* ───────── URL reativa ───────── */
const nav = vi.hoisted(() => {
  let sp = new URLSearchParams();
  const ouvintes = new Set<() => void>();
  return {
    historico: [] as string[],
    get sp() { return sp; },
    definir(qs: string) { sp = new URLSearchParams(qs); ouvintes.forEach((f) => f()); },
    assinar(f: () => void) { ouvintes.add(f); return () => { ouvintes.delete(f); }; },
  };
});
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSearchParams: () => useSyncExternalStore(nav.assinar, () => nav.sp, () => nav.sp),
    usePathname: () => "/lista",
    useRouter: () => ({
      replace: (u: string) => { nav.historico.push(u); nav.definir(u.split("?")[1] ?? ""); },
      push: (u: string) => { nav.historico.push(u); },
      refresh: () => {},
    }),
  };
});

/* ───────── API falsa (pagina/busca/ordena como o servidor) ───────── */
const PRODUTOS = Array.from({ length: 60 }, (_, i) => ({
  id: `p${String(i + 1).padStart(2, "0")}`, nome: `Produto ${String(i + 1).padStart(2, "0")}`, unidade: "un", valorPadrao: (i % 7) * 10, estoqueMinimo: null, ativo: true,
}));
const pedidos: URL[] = [];
let segurar: Promise<void> | null = null;
function api(urlStr: string) {
  const u = new URL(urlStr, "http://localhost");
  pedidos.push(u);
  const q = (u.searchParams.get("q") ?? "").toLowerCase();
  let rs = PRODUTOS.filter((p) => p.nome.toLowerCase().includes(q));
  if (u.searchParams.get("sugestoes") === "1") return { sugestoes: rs.slice(0, 50).map((p) => ({ id: p.id, rotulo: p.nome })).slice(0, 5) };
  const ordem = u.searchParams.get("ordem");
  if (ordem) rs = [...rs].sort((a: any, b: any) => (a[ordem] - b[ordem] || a.id.localeCompare(b.id)) * (u.searchParams.get("dir") === "desc" ? -1 : 1));
  const por = Number(u.searchParams.get("por")), total = rs.length;
  const pagina = Math.min(Math.max(1, Number(u.searchParams.get("pagina"))), Math.max(1, Math.ceil(total / por)));
  return { itens: rs.slice((pagina - 1) * por, pagina * por), total, pagina, porPagina: por, contagens: { ativos: total, inativos: 0, todos: total } };
}
const ultimo = (pred: (u: URL) => boolean = (u) => !u.searchParams.has("sugestoes")) => [...pedidos].reverse().find(pred)!;

/* ───────── Montagem ───────── */
let root: Root;
let caixa: HTMLDivElement;
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

async function montar() {
  const { CadastroPadrao } = await import("@/components/cadastros/cadastro-padrao");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(CadastroPadrao, { entidade: "produtos" }) }));
  });
  await flush();
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)];
const texto = () => caixa.textContent ?? "";
const faixa = () => $("[data-faixa]")?.textContent?.replace(/\s+/g, " ").trim();
async function digitar(el: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function clicar(el: Element | null) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
}
async function escolher(el: HTMLSelectElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  pedidos.length = 0;
  nav.historico.length = 0;
  nav.definir("");
  segurar = null;
  localStorage.clear();
  globalThis.fetch = vi.fn(async (u: any) => {
    if (segurar) await segurar;
    return new Response(JSON.stringify(api(String(u))), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as any;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  caixa?.remove();
  vi.useRealTimers();
});

// ═════════════════════════ Paginação ═════════════════════════
describe("paginação no servidor", () => {
  it("abre com 50 por página e o total certo; pede ao servidor só a página", async () => {
    await montar();
    const u = ultimo();
    expect(u.pathname).toBe("/api/cadastros/produtos");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ ativo: "sim", pagina: "1", por: "50" });
    expect(faixa()).toBe("Mostrando 1–50 de 60 produtos");
    expect($$("tr[data-linha]")).toHaveLength(50);
    expect($$("[data-cartao]")).toHaveLength(50); // celular: cartões
  });

  it("mudar para 25: busca de novo com 25, volta à página 1 e lembra a preferência", async () => {
    nav.definir("pagina=2");
    await montar();
    await escolher($<HTMLSelectElement>("[data-por-pagina]")!, "25");
    expect(nav.sp.get("por")).toBe("25");
    expect(nav.sp.get("pagina")).toBeNull();
    expect(ultimo().searchParams.get("por")).toBe("25");
    expect(faixa()).toBe("Mostrando 1–25 de 60 produtos");
    expect(localStorage.getItem("frivo:listas:por")).toBe("25");
  });

  it("avançar, ir para a página 3 e voltar; o texto acompanha", async () => {
    nav.definir("por=25");
    await montar();
    await clicar($("[data-pagina-proxima]"));
    expect(nav.sp.get("pagina")).toBe("2");
    expect(ultimo().searchParams.get("pagina")).toBe("2");
    expect(faixa()).toBe("Mostrando 26–50 de 60 produtos");
    await clicar($('[data-pagina="3"]'));
    expect(faixa()).toBe("Mostrando 51–60 de 60 produtos");
    expect($$("tr[data-linha]")).toHaveLength(10);
    expect($<HTMLButtonElement>("[data-pagina-proxima]")!.disabled).toBe(true);
    await clicar($("[data-pagina-anterior]"));
    expect(faixa()).toBe("Mostrando 26–50 de 60 produtos");
  });

  it("a preferência lembrada vale ao abrir outra lista", async () => {
    localStorage.setItem("frivo:listas:por", "100");
    await montar();
    expect(nav.sp.get("por")).toBe("100");
    expect(ultimo().searchParams.get("por")).toBe("100");
    expect(faixa()).toBe("Mostrando 1–60 de 60 produtos");
  });

  it("enquanto a primeira página não chega: esqueleto", async () => {
    let soltar!: () => void;
    segurar = new Promise((r) => { soltar = r; });
    await montar();
    expect($("[data-skeleton]")).toBeTruthy();
    soltar();
    await flush();
    expect($("[data-skeleton]")).toBeNull();
    expect($$("tr[data-linha]").length).toBeGreaterThan(0);
  });
});

// ═════════════════════════ Busca ao vivo ═════════════════════════
describe("busca ao vivo", () => {
  it("filtra conforme digita (300 ms), sem Enter, e volta para a página 1", async () => {
    nav.definir("por=25&pagina=2");
    await montar();
    const antes = pedidos.length;
    await digitar($<HTMLInputElement>("[data-busca]")!, "Produto 1");
    await flush(299);
    expect(pedidos.filter((u) => u.searchParams.get("q") && !u.searchParams.has("sugestoes"))).toHaveLength(0);
    await flush(1);
    expect(nav.sp.get("q")).toBe("Produto 1");
    expect(nav.sp.get("pagina")).toBeNull();
    const u = ultimo();
    expect(u.searchParams.get("q")).toBe("Produto 1");
    expect(u.searchParams.get("pagina")).toBe("1");
    expect(pedidos.length).toBeGreaterThan(antes);
    expect(faixa()).toBe("Mostrando 1–10 de 10 produtos");
  });

  it("digitar rápido faz UMA busca (debounce), com o texto final", async () => {
    await montar();
    const campo = $<HTMLInputElement>("[data-busca]")!;
    for (const parcial of ["P", "Pr", "Pro", "Prod", "Produto 5"]) { await digitar(campo, parcial); await flush(100); }
    await flush(300);
    const buscas = pedidos.filter((u) => u.searchParams.has("q") && !u.searchParams.has("sugestoes"));
    expect(buscas.map((u) => u.searchParams.get("q"))).toEqual(["Produto 5"]);
  });

  it("o “x” limpa a busca e volta a lista inteira", async () => {
    nav.definir("q=Produto 1");
    await montar();
    expect(faixa()).toBe("Mostrando 1–10 de 10 produtos");
    await clicar($("[data-limpar-busca]"));
    await flush(300);
    expect(nav.sp.get("q")).toBeNull();
    expect(ultimo().searchParams.has("q")).toBe(false);
    expect(faixa()).toBe("Mostrando 1–50 de 60 produtos");
    expect($<HTMLInputElement>("[data-busca]")!.value).toBe("");
  });

  it("estado vazio claro quando nada combina", async () => {
    nav.definir("q=zzz");
    await montar();
    expect($("[data-lista-vazia]")).toBeTruthy();
    expect(texto()).toContain("Nenhum produto encontrado");
    expect(texto()).toContain("Nada combina com “zzz”");
    expect($("[data-paginacao]")).toBeNull();
  });

  it("sugestões: até 5 nomes, compactas; escolher uma aplica o filtro", async () => {
    await montar();
    const campo = $<HTMLInputElement>("[data-busca]")!;
    await act(async () => { campo.focus(); });
    await digitar(campo, "Produto 1");
    await flush(300);
    const sug = $$("[data-sugestao]");
    expect(sug.length).toBeGreaterThan(0);
    expect(sug.length).toBeLessThanOrEqual(5);
    expect(ultimo((u) => u.searchParams.has("sugestoes")).searchParams.get("q")).toBe("Produto 1");
    await clicar(sug[0]);
    await flush(300);
    expect(campo.value).toBe("Produto 10");
    expect(nav.sp.get("q")).toBe("Produto 10");
    expect($("[data-sugestoes]")).toBeNull();
  });

  it("atalho “/” foca a busca; dentro de um campo, “/” é só um caractere", async () => {
    await montar();
    const campo = $<HTMLInputElement>("[data-busca]")!;
    expect(document.activeElement).not.toBe(campo);
    const ev = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    await act(async () => { document.body.dispatchEvent(ev); });
    expect(document.activeElement).toBe(campo);
    expect(ev.defaultPrevented).toBe(true);
    const dentro = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    await act(async () => { campo.dispatchEvent(dentro); });
    expect(dentro.defaultPrevented).toBe(false);
  });
});

// ═════════════════════════ Ordenação ═════════════════════════
describe("ordenar pelo cabeçalho", () => {
  it("1º clique asc, 2º desc; o servidor recebe a ordem e a página é mantida", async () => {
    nav.definir("por=25&pagina=2");
    await montar();
    await clicar($('[data-ordenar="valorPadrao"]'));
    expect(nav.sp.get("ordem")).toBe("valorPadrao");
    expect(nav.sp.get("dir")).toBeNull();
    expect(ultimo().searchParams.get("ordem")).toBe("valorPadrao");
    expect($('th[aria-sort="ascending"]')?.textContent).toContain("Valor padrão");
    await clicar($('[data-ordenar="valorPadrao"]'));
    expect(nav.sp.get("dir")).toBe("desc");
    expect(ultimo().searchParams.get("dir")).toBe("desc");
    expect($('th[aria-sort="descending"]')).toBeTruthy();
    // Coluna sem `ordenar` no registro não vira botão
    expect($('[data-ordenar="unidade"]')).toBeTruthy();
    expect($$("[data-ordenar]").map((b) => b.getAttribute("data-ordenar"))).toEqual(["nome", "unidade", "valorPadrao", "estoqueMinimo"]);
  });
});
