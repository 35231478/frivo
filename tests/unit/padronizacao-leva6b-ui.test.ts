// @vitest-environment happy-dom
/**
 * Leva 6B — a faixa de sugestões de item montada de verdade (DOM), e o que ela promete na tela:
 *  - sem cliente não pede nada e não aparece;
 *  - com histórico fino (a rota devolve vazio) não aparece — nunca inventa;
 *  - aparece separada por serviços e produtos, com o último preço e quantas vezes;
 *  - clicar adiciona a linha com aquele preço (e nada é preenchido sozinho);
 *  - o que já está na lista não se sugere de novo;
 *  - "Dispensar" some com a faixa;
 *  - a rota falhando (sem permissão, por exemplo) não atrapalha: a faixa só não aparece.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ItemSugerido } from "@/components/orcamento/sugestoes-itens";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let caixa: HTMLDivElement;
const chamadas: string[] = [];
let resposta: { ok: boolean; corpo: unknown } = { ok: true, corpo: { janelaMeses: 6, itens: [] } };

const ITENS: ItemSugerido[] = [
  { tipo: "SERVICO", catalogoId: "s1", descricao: "Limpeza de split", valorUnitario: 240, vezes: 3 },
  { tipo: "SERVICO", catalogoId: null, descricao: "Visita técnica", valorUnitario: 130, vezes: 2 },
  { tipo: "PRODUTO", catalogoId: "p1", descricao: "Filtro de ar", valorUnitario: 60, vezes: 2 },
];

beforeEach(() => {
  chamadas.length = 0;
  resposta = { ok: true, corpo: { janelaMeses: 6, itens: ITENS } };
  globalThis.fetch = vi.fn(async (u: any) => {
    chamadas.push(String(u));
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.ok ? 200 : 403, headers: { "Content-Type": "application/json" } });
  }) as any;
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); document.body.innerHTML = ""; });

const $ = (s: string) => caixa.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => [...caixa.querySelectorAll(s)] as HTMLElement[];
const clicar = async (el: Element) => {
  await act(async () => { (el as HTMLElement).click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

/** A tela de verdade em miniatura: a faixa alimentada pelo hook, somando linhas numa lista. */
async function montar(clienteId: string, excluirId?: string) {
  const { SugestoesItens, useSugestoesItens } = await import("@/components/orcamento/sugestoes-itens");
  function Tela() {
    const itens = useSugestoesItens(clienteId, excluirId);
    const [linhas, setLinhas] = useState<{ descricao: string; valorUnitario: number }[]>([]);
    return createElement("div", null,
      createElement(SugestoesItens, {
        tipo: "SERVICO", itens,
        jaNaLista: (s: ItemSugerido) => linhas.some((l) => l.descricao === s.descricao),
        onUsar: (s: ItemSugerido) => setLinhas((p) => [...p, { descricao: s.descricao, valorUnitario: s.valorUnitario }]),
      }),
      createElement(SugestoesItens, {
        tipo: "PRODUTO", itens,
        jaNaLista: (s: ItemSugerido) => linhas.some((l) => l.descricao === s.descricao),
        onUsar: (s: ItemSugerido) => setLinhas((p) => [...p, { descricao: s.descricao, valorUnitario: s.valorUnitario }]),
      }),
      createElement("ul", { "data-linhas": true }, linhas.map((l, i) =>
        createElement("li", { key: i, "data-linha": l.descricao }, `${l.descricao} ${l.valorUnitario}`))),
    );
  }
  await act(async () => root.render(createElement(Tela)));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("faixa de sugestões de item", () => {
  it("sem cliente escolhido não pergunta nada e não aparece", async () => {
    await montar("");
    expect(chamadas).toEqual([]);
    expect($("[data-sugestoes-itens]")).toBeNull();
  });

  it("pergunta pelo cliente e, com o orçamento aberto, manda excluir ele da conta", async () => {
    await montar("c1", "o9");
    expect(chamadas).toEqual(["/api/orcamentos/sugestoes?clienteId=c1&excluir=o9"]);
  });

  it("histórico fino: a rota devolve vazio e a faixa não aparece", async () => {
    resposta = { ok: true, corpo: { janelaMeses: 6, itens: [] } };
    await montar("c1");
    expect($$("[data-sugestoes-itens]")).toHaveLength(0);
  });

  it("a rota recusando (403) não atrapalha: a faixa só não aparece", async () => {
    resposta = { ok: false, corpo: { erro: "Sem permissão para esta ação" } };
    await montar("c1");
    expect($$("[data-sugestoes-itens]")).toHaveLength(0);
  });

  it("resposta estranha da rota (200 com 'itens' que não é lista) não quebra a tela", async () => {
    resposta = { ok: true, corpo: { janelaMeses: 6, itens: "nada disso" } };
    await montar("c1");
    expect($$("[data-sugestoes-itens]")).toHaveLength(0);
    expect($$("[data-linha]")).toHaveLength(0);
  });

  it("serviços e produtos em faixas separadas, com preço e quantas vezes", async () => {
    await montar("c1");
    const servicos = $('[data-sugestoes-itens="SERVICO"]')!;
    const produtos = $('[data-sugestoes-itens="PRODUTO"]')!;
    expect(servicos.textContent).toContain("Os serviços que mais entraram nos orçamentos deste cliente nos últimos 6 meses, com o último preço praticado:");
    expect(produtos.textContent).toContain("Os produtos que mais entraram");
    const chip = servicos.querySelector('[data-usar-sugestao-item="s1"]')!;
    expect(chip.textContent).toContain("Limpeza de split");
    expect(chip.textContent).toMatch(/240,00/);
    expect(chip.textContent).toContain("3×");
    expect(chip.getAttribute("title")).toBe("3 orçamentos nos últimos 6 meses");
    expect(produtos.querySelectorAll("[data-usar-sugestao-item]")).toHaveLength(1);
  });

  it("nada é preenchido sozinho: a linha só nasce no clique, com o último preço", async () => {
    await montar("c1");
    expect($$("[data-linha]")).toHaveLength(0);
    await clicar($('[data-usar-sugestao-item="s1"]')!);
    expect($$("[data-linha]").map((l) => l.textContent)).toEqual(["Limpeza de split 240"]);
  });

  it("o que já entrou na lista sai das sugestões", async () => {
    await montar("c1");
    await clicar($('[data-usar-sugestao-item="s1"]')!);
    expect($('[data-usar-sugestao-item="s1"]')).toBeNull();
    expect($('[data-usar-sugestao-item="Visita técnica"]')).toBeTruthy();
  });

  it("usar o último serviço da faixa some com ela (não sobra faixa vazia)", async () => {
    await montar("c1");
    await clicar($('[data-usar-sugestao-item="s1"]')!);
    await clicar($('[data-usar-sugestao-item="Visita técnica"]')!);
    expect($('[data-sugestoes-itens="SERVICO"]')).toBeNull();
    expect($('[data-sugestoes-itens="PRODUTO"]')).toBeTruthy();
  });

  it("'Dispensar' some com a faixa daquele grupo, e só dela", async () => {
    await montar("c1");
    await clicar($('[data-dispensar-sugestoes="SERVICO"]')!);
    expect($('[data-sugestoes-itens="SERVICO"]')).toBeNull();
    expect($('[data-sugestoes-itens="PRODUTO"]')).toBeTruthy();
    expect($$("[data-linha]")).toHaveLength(0);
  });
});
