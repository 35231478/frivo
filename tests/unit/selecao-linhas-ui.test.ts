// @vitest-environment happy-dom
/**
 * Seleção de linhas + realce + painel de totais, montados de verdade (happy-dom + React):
 *  - SelecaoLinhasProvider: marcar/desmarcar uma linha, a página inteira (indeterminado quando é
 *    só parte), limpar, e a seleção ZERA quando os ids da página mudam (filtro/página);
 *  - TabelaPro pinta a linha marcada (PLANILHA.linhaSelecionada: permanente, vence a zebra e a
 *    linha vermelha de vencida) e marca data-selecionada/aria-selected — em qualquer tela, inclusive
 *    com a seleção em massa (SelecaoMassaProvider);
 *  - PainelTotais: sem seleção mostra o período; com seleção "Total dos N selecionados" e a quebra
 *    só do marcado; avisa quando parte da seleção está fora da página; abre/fecha pela setinha.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PLANILHA } from "@/lib/planilha";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: () => {} }),
  usePathname: () => "/orcamentos", useSearchParams: () => new URLSearchParams(""),
}));

let root: Root;
let caixa: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ valor: null }), { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string, de: ParentNode = document) => de.querySelector(sel) as T | null;
const $$ = (sel: string, de: ParentNode = document) => [...de.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const marcados = () => $$("[data-selecao-linha]").filter((i) => (i as HTMLInputElement).checked).map((i) => i.getAttribute("data-selecao-linha"));

async function montar(el: ReactNode) {
  if (root) { act(() => root.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(el as any); });
  await esperar();
}

/** Uma lista com a TabelaPro dentro do provedor leve: caixa por linha + caixa da página */
async function Lista(ids: string[], vermelhas: string[] = []) {
  const { SelecaoLinhasProvider, CheckboxSelecao, CheckboxSelecaoPagina } = await import("@/components/listagem/selecao-linhas");
  const { TabelaPro } = await import("@/components/listagem/tabela-pro");
  const colunas = [
    { id: "sel", titulo: "Selecionar a página", fixa: true, largura: 36, cabecalho: createElement(CheckboxSelecaoPagina) },
    { id: "nome", titulo: "Nome", obrigatoria: true },
  ];
  const linhas = ids.map((id) => ({
    id, classe: vermelhas.includes(id) ? "even:bg-atrasado-claro bg-atrasado-claro hover:bg-atrasado-claro/70" : undefined,
    celulas: { sel: createElement(CheckboxSelecao, { id, rotulo: id }), nome: `Linha ${id}` },
  }));
  return createElement(SelecaoLinhasProvider, { idsPagina: ids, children: createElement(TabelaPro, { tela: "teste-selecao", colunas, linhas } as any) });
}

describe("SelecaoLinhasProvider + TabelaPro", () => {
  it("marcar pinta a linha (token linhaSelecionada, por cima da zebra e da vencida); desmarcar tira; data-selecionada/aria-selected acompanham", async () => {
    await montar(await Lista(["a", "b", "c", "d"], ["b"]));
    expect($$("tbody tr[data-selecionada]")).toHaveLength(0);
    expect($$("tbody tr").map((tr) => tr.getAttribute("aria-selected"))).toEqual(["false", "false", "false", "false"]);
    await clicar($("[data-selecao-linha=b]"));
    await clicar($("[data-selecao-linha=c]"));
    expect(marcados()).toEqual(["b", "c"]);
    const trB = $("tr[data-linha=b]")!, trC = $("tr[data-linha=c]")!, trA = $("tr[data-linha=a]")!;
    for (const tr of [trB, trC]) {
      expect(tr.hasAttribute("data-selecionada")).toBe(true);
      expect(tr.getAttribute("aria-selected")).toBe("true");
      for (const cls of PLANILHA.linhaSelecionada.split(" ")) expect(tr.classList.contains(cls)).toBe(true);
    }
    // A vencida marcada perde o vermelho (o realce da seleção manda) e a zebra par também
    expect(trB.className).not.toMatch(/bg-atrasado-claro(?!\/)/);
    expect(trB.className).not.toContain("even:bg-surface-linha");
    expect(trA.hasAttribute("data-selecionada")).toBe(false);
    expect(trA.classList.contains("bg-primary-50")).toBe(false);
    await clicar($("[data-selecao-linha=b]"));
    expect(trB.hasAttribute("data-selecionada")).toBe(false);
    expect(trB.classList.contains("bg-atrasado-claro")).toBe(true);
    expect(marcados()).toEqual(["c"]);
  });

  it("o realce é permanente (não depende do hover) e mais forte que o hover: o token fixa o fundo e o hover dele é o escuro", () => {
    expect(PLANILHA.linhaSelecionada).toBe("bg-primary-50 even:bg-primary-50 hover:bg-primary-100");
    expect(PLANILHA.linhaHover).toBe("hover:bg-primary-100/60");
  });

  it("caixa da página: marca todas, fica indeterminada com parte, desmarca todas; a caixa some sem linhas", async () => {
    await montar(await Lista(["a", "b", "c"]));
    const pagina = () => $<HTMLInputElement>("[data-selecao-pagina]")!;
    expect(pagina().getAttribute("aria-label")).toBe("Selecionar todos desta página");
    expect(pagina().title).toBe("Selecionar os 3 desta página");
    await clicar(pagina());
    expect(marcados()).toEqual(["a", "b", "c"]);
    expect(pagina().checked).toBe(true);
    expect(pagina().indeterminate).toBe(false);
    expect(pagina().getAttribute("aria-label")).toBe("Desmarcar todos desta página");
    await clicar($("[data-selecao-linha=b]"));
    expect(pagina().checked).toBe(false);
    expect(pagina().indeterminate).toBe(true);
    await clicar(pagina());
    expect(marcados()).toEqual(["a", "b", "c"]);
    await clicar(pagina());
    expect(marcados()).toEqual([]);
    expect(pagina().indeterminate).toBe(false);
    await montar(await Lista([]));
    expect($("[data-selecao-pagina]")).toBeNull();
  });

  it("a seleção zera quando os ids da página mudam (outra página/filtro) e continua quando só a ordem/conteúdo é o mesmo", async () => {
    const { SelecaoLinhasProvider, CheckboxSelecao, useSelecaoLinhas } = await import("@/components/listagem/selecao-linhas");
    function Corpo({ ids }: { ids: string[] }) {
      const { selecionados } = useSelecaoLinhas();
      return createElement("div", { "data-n": selecionados.size }, ids.map((id) => createElement(CheckboxSelecao, { id, key: id })));
    }
    const Tela = (ids: string[]) => createElement(SelecaoLinhasProvider, { idsPagina: ids, children: createElement(Corpo, { ids }) });
    await montar(Tela(["a", "b"]));
    await clicar($("[data-selecao-linha=a]"));
    expect($("[data-n]")!.getAttribute("data-n")).toBe("1");
    await act(async () => { root.render(Tela(["a", "b"])); }); await esperar(); // mesma página: fica
    expect($("[data-n]")!.getAttribute("data-n")).toBe("1");
    await act(async () => { root.render(Tela(["c", "d"])); }); await esperar(); // outra página: zera
    expect($("[data-n]")!.getAttribute("data-n")).toBe("0");
    expect(marcados()).toEqual([]);
  });

  it("a caixa não deixa o clique vazar para a linha (abrir/navegar) e tem rótulo acessível", async () => {
    const { SelecaoLinhasProvider, CheckboxSelecao } = await import("@/components/listagem/selecao-linhas");
    const aoClicarLinha = vi.fn();
    await montar(createElement(SelecaoLinhasProvider, { idsPagina: ["a"], children:
      createElement("div", { onClick: aoClicarLinha, "data-linha-clicavel": "" }, createElement(CheckboxSelecao, { id: "a", rotulo: "CR-1" })) }));
    expect($("[data-selecao-linha=a]")!.getAttribute("aria-label")).toBe("Selecionar CR-1");
    await clicar($("[data-selecao-linha=a]"));
    expect(marcados()).toEqual(["a"]);
    expect(aoClicarLinha).not.toHaveBeenCalled();
    // O clique na borda da caixa (a área de toque em volta do input) também não abre a linha
    await clicar($("[data-selecao-linha=a]")!.parentElement);
    expect(aoClicarLinha).not.toHaveBeenCalled();
    expect(marcados()).toEqual(["a"]);
  });

  it("com a seleção em massa (SelecaoMassaProvider) a TabelaPro pinta a linha do mesmo jeito", async () => {
    const { SelecaoMassaProvider, useSelecaoMassa } = await import("@/components/acoes-massa/selecao");
    const { TabelaPro } = await import("@/components/listagem/tabela-pro");
    function Caixa({ id }: { id: string }) {
      const { selecionados, alternar } = useSelecaoMassa();
      return createElement("input", { type: "checkbox", "data-massa": id, checked: selecionados.has(id), onChange: () => alternar(id) });
    }
    const ids = ["o1", "o2"];
    const linhas = ids.map((id) => ({ id, celulas: { sel: createElement(Caixa, { id }), nome: id } }));
    await montar(createElement(SelecaoMassaProvider, { entidade: "orcamentos", idsPagina: ids, total: 2, children:
      createElement(TabelaPro, { tela: "teste-massa", colunas: [{ id: "sel", titulo: "Sel", fixa: true, largura: 36 }, { id: "nome", titulo: "Nome", obrigatoria: true }], linhas } as any) }));
    expect($("tr[data-linha=o2]")!.getAttribute("aria-selected")).toBe("false");
    await clicar($("[data-massa=o2]"));
    expect($("tr[data-linha=o2]")!.hasAttribute("data-selecionada")).toBe(true);
    expect($("tr[data-linha=o2]")!.classList.contains("bg-primary-50")).toBe(true);
    expect($("tr[data-linha=o1]")!.hasAttribute("data-selecionada")).toBe(false);
  });

  it("Orçamentos: o painel lê a seleção em massa — sem marcados mostra o funil do período; marcados, só a soma deles (em aberto/aprovado/recusado/vencido)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-15T15:00:00.000Z"));
    try {
      const { SelecaoMassaProvider, useSelecaoMassa } = await import("@/components/acoes-massa/selecao");
      const { PainelTotaisOrcamentos } = await import("@/components/orcamento/painel-totais-orcamentos");
      function Caixa({ id }: { id: string }) {
        const { selecionados, alternar } = useSelecaoMassa();
        return createElement("input", { type: "checkbox", "data-massa": id, checked: selecionados.has(id), onChange: () => alternar(id) });
      }
      const itens = [
        { id: "o1", status: "ENVIADO", validadeEm: "2026-11-30T00:00:00.000Z", totalGeral: 100 },
        { id: "o2", status: "ENVIADO", validadeEm: "2026-11-01T00:00:00.000Z", totalGeral: 200 },
        { id: "o3", status: "APROVADO", validadeEm: null, totalGeral: 1000 },
        { id: "o4", status: "REPROVADO", validadeEm: null, totalGeral: 50 },
      ];
      const resumo = { EM_ABERTO: { v: 5000, q: 3 }, APROVADO: { v: 9000, q: 4 }, RECUSADO: { v: 100, q: 1 }, VENCIDO: { v: 700, q: 2 }, TOTAL: { v: 14800, q: 10 } };
      await montar(createElement(SelecaoMassaProvider, { entidade: "orcamentos", idsPagina: itens.map((i) => i.id), total: 10, children: [
        ...itens.map((i) => createElement(Caixa, { id: i.id, key: i.id })),
        createElement(PainelTotaisOrcamentos, { key: "p", itens, resumo, periodo: { tipo: "mes", mes: "2026-11", de: null, ate: null, rotulo: "Novembro de 2026" } }),
      ] }));
      const valor = (k: string) => txt($(`[data-painel-linha=${k}] [data-painel-valor]`));
      expect($("[data-painel-totais]")!.getAttribute("data-modo")).toBe("periodo");
      expect($("[data-espaco-barra]")).toBeNull();
      expect(txt($("[data-painel-total]"))).toBe("R$ 14.800,00");
      expect($$("[data-painel-linha]").map((l) => l.getAttribute("data-painel-linha"))).toEqual(["EM_ABERTO", "APROVADO", "RECUSADO", "VENCIDO"]);
      await clicar($("[data-massa=o2]"));
      await clicar($("[data-massa=o3]"));
      expect(txt($("[data-painel-titulo]"))).toBe("Total dos 2 orçamentos selecionados");
      expect(txt($("[data-painel-total]"))).toBe("R$ 1.200,00");
      expect([valor("EM_ABERTO"), valor("APROVADO"), valor("RECUSADO"), valor("VENCIDO")]).toEqual(["R$ 0,00", "R$ 1.000,00", "R$ 0,00", "R$ 200,00"]);
      expect($("[data-painel-linha=VENCIDO] [data-painel-valor]")!.className).toContain("text-atencao-texto");
      expect($("[data-espaco-barra]")).not.toBeNull(); // a barra de ações em massa está na tela: o painel rola acima dela
    } finally { vi.useRealTimers(); }
  });

  it("fora de qualquer provedor a TabelaPro não marca nada (sem aria-selected)", async () => {
    const { TabelaPro } = await import("@/components/listagem/tabela-pro");
    await montar(createElement(TabelaPro, { tela: "teste-solta", colunas: [{ id: "nome", titulo: "Nome", obrigatoria: true }], linhas: [{ id: "x", celulas: { nome: "x" } }] } as any));
    expect($("tr[data-linha=x]")!.hasAttribute("aria-selected")).toBe(false);
    expect($("tr[data-linha=x]")!.hasAttribute("data-selecionada")).toBe(false);
  });
});

describe("PainelTotais", () => {
  const periodo = {
    rotulo: "Novembro de 2026", subtitulo: "Novembro de 2026",
    total: { chave: "TOTAL", rotulo: "Total", v: 3600, q: 6 },
    linhas: [
      { chave: "VENCIDO", rotulo: "Em aberto (Vencido)", v: 800, q: 2, cor: "text-atrasado" },
      { chave: "A_VENCER", rotulo: "Em aberto (A vencer)", v: 1100, q: 2, dica: "Pelo saldo" },
      { chave: "PAGO", rotulo: "Pagos", v: 300, q: 1 },
    ],
  };
  const selecao = (n: number, naPagina = n) => ({
    n, naPagina, total: { chave: "TOTAL", rotulo: "Total", v: 1500, q: n },
    linhas: [
      { chave: "VENCIDO", rotulo: "Em aberto (Vencido)", v: 1200, q: 1, cor: "text-atrasado" },
      { chave: "A_VENCER", rotulo: "Em aberto (A vencer)", v: 300, q: 1 },
      { chave: "PAGO", rotulo: "Pagos", v: 0, q: 0 },
    ],
  });
  async function painel(props: Record<string, unknown> = {}) {
    const { PainelTotais } = await import("@/components/listagem/painel-totais");
    await montar(createElement(PainelTotais, { periodo, unidade: ["conta", "contas"], ...props } as any));
  }
  const quebra = () => $$("[data-painel-linha]").map((l) => [l.getAttribute("data-painel-linha"), txt($("[data-painel-valor]", l)), txt($("[data-painel-qtd]", l))]);

  it("sem seleção: 'Totais do período', o total em destaque e a quebra com R$, cor e quantidade; ⓘ fora de botão", async () => {
    await painel({ selecao: { n: 0, total: periodo.total, linhas: [] } });
    const p = $("[data-painel-totais]")!;
    expect(p.getAttribute("data-modo")).toBe("periodo");
    expect(txt($("[data-painel-titulo]"))).toBe("Totais do período");
    expect(txt($("[data-painel-subtitulo]"))).toBe("Novembro de 2026");
    expect(txt($("[data-painel-total]"))).toMatch(/^R\$\s?3\.600,00$/);
    // (txt() normaliza o espaço fixo do R$)
    expect(quebra()).toEqual([["VENCIDO", "R$ 800,00", "2 contas"], ["A_VENCER", "R$ 1.100,00", "2 contas"], ["PAGO", "R$ 300,00", "1 conta"]]);
    expect($("[data-painel-linha=VENCIDO] [data-painel-valor]")!.className).toContain("text-atrasado");
    expect($("[data-painel-linha=A_VENCER] [data-dica]")).not.toBeNull();
    expect($("[data-painel-linha=A_VENCER] [data-dica]")!.parentElement!.closest("button, a")).toBeNull();
  });

  it("com seleção: 'Total dos N selecionados' (singular/plural) e a quebra só do marcado; avisa quando parte está fora da página", async () => {
    await painel({ selecao: selecao(2) });
    expect($("[data-painel-totais]")!.getAttribute("data-modo")).toBe("selecao");
    expect(txt($("[data-painel-titulo]"))).toBe("Total dos 2 contas selecionadas");
    expect(txt($("[data-painel-subtitulo]"))).toBe("Só do que está marcado");
    expect(txt($("[data-painel-total]"))).toMatch(/^R\$\s?1\.500,00$/);
    expect(quebra().map(([k, , q]) => [k, q])).toEqual([["VENCIDO", "1 conta"], ["A_VENCER", "1 conta"], ["PAGO", "0 contas"]]);
    expect(txt($("[data-painel-linha=VENCIDO] [data-painel-valor]"))).toMatch(/^R\$\s?1\.200,00$/);
    await painel({ selecao: selecao(1), unidade: ["cobrança", "cobranças"] });
    expect(txt($("[data-painel-titulo]"))).toBe("Total dos 1 cobrança selecionada");
    await painel({ selecao: selecao(5, 2) });
    expect(txt($("[data-painel-subtitulo]"))).toBe("2 nesta página: a soma é só delas");
    await painel({ selecao: null });
    expect($("[data-painel-totais]")!.getAttribute("data-modo")).toBe("periodo");
  });

  it("a setinha recolhe e abre a quebra (aria-expanded), o total em destaque fica sempre", async () => {
    await painel();
    const alternar = () => $("[data-painel-alternar]")!;
    expect(alternar().getAttribute("aria-expanded")).toBe("true");
    expect($("[data-painel-quebra]")).not.toBeNull();
    await clicar(alternar());
    expect(alternar().getAttribute("aria-expanded")).toBe("false");
    expect($("[data-painel-quebra]")).toBeNull();
    expect($("[data-painel-total]")).not.toBeNull();
    await clicar(alternar());
    expect($("[data-painel-quebra]")).not.toBeNull();
    await painel({ abertoInicial: false });
    expect($("[data-painel-quebra]")).toBeNull();
  });
});
