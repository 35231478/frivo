// @vitest-environment happy-dom
/**
 * Leva 7B — a sugestão do pedido avulso num DOM de verdade (happy-dom), API simulada.
 *
 *  - a faixa aparece no pedido AVULSO novo, dizendo de onde veio (fornecedor e preço da última
 *    compra) e quanto falta para voltar ao mínimo;
 *  - clicar NÃO compra nada: coloca a linha no pedido, já editável — e o produto sugerido sai da
 *    faixa (não se sugere o que já está na lista);
 *  - histórico fino: o produto aparece como "compra nova", sem preço (Princípio 9: não chuta);
 *  - "Dispensar" tira a faixa e não volta;
 *  - sem permissão (403 na rota) a faixa simplesmente não aparece, e o pedido continua funcionando;
 *  - editar pedido, ou pedido de OS/orçamento, nem pede sugestão (a reposição é do avulso).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {} }) }));
const avisos = vi.hoisted(() => ({ lista: [] as [string, string][] }));
vi.mock("@/components/ui/avisos", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/avisos")>()),
  toast: (m: string, t = "sucesso") => { avisos.lista.push([m, t]); },
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const SUGESTOES = {
  itens: [
    { produtoId: "pGas", nome: "Gás R410A", unidade: "un", saldo: 1, estoqueMinimo: 4, faltam: 3, fornecedor: "Refrimais", valorUnitario: 980, vezes: 2 },
    { produtoId: "pCap", nome: "Capacitor 35uF", unidade: "pc", saldo: 0, estoqueMinimo: 10, faltam: 10, fornecedor: null, valorUnitario: null, vezes: 1 },
  ],
};
const PRODUTOS = [
  { id: "pGas", nome: "Gás R410A", unidade: "un", ativo: true },
  { id: "pCap", nome: "Capacitor 35uF", unidade: "pc", ativo: true },
];

beforeEach(() => {
  chamadas.length = 0; avisos.lista.length = 0;
  nav.push.mockClear(); nav.refresh.mockClear();
  respostas = {
    "/api/compras/sugestoes": { status: 200, corpo: SUGESTOES },
    "/api/compras/compradores": { status: 200, corpo: [{ id: "uA", nome: "Ana Souza" }] },
    "/api/cadastros/produtos": { status: 200, corpo: PRODUTOS },
    "/api/cadastros/fornecedores": { status: 200, corpo: [{ id: "f1", nome: "Refrimais", ativo: true }] },
    "/api/compras/ultima-compra": { status: 200, corpo: {} },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, metodo: String(init.method ?? "GET"), corpo: init.body ? JSON.parse(String(init.body)) : null });
    const r = Object.entries(respostas).find(([k]) => url.startsWith(k))?.[1] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

async function montar(props: Record<string, unknown> = { avulso: true }) {
  const { EditorPedido } = await import("@/components/compras/editor-pedido");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  const editor = createElement(EditorPedido, { onSalvo: vi.fn(), onCancelar: vi.fn(), ...props } as any);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: editor }));
  });
  await act(async () => {});
}

const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)];
const clicar = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const linhas = () => $$("[data-item-editor]");
const campo = (linha: Element, nome: string) => linha.querySelector(`[data-campo="${nome}"]`) as HTMLInputElement;

describe("a faixa de sugestões do pedido avulso", () => {
  it("diz o que o estoque sabe: quanto falta, de quem e por quanto foi a última compra", async () => {
    await montar();
    const faixa = $("[data-sugestoes-compra]")!;
    expect(faixa).not.toBeNull();
    expect(txt(faixa)).toContain("O estoque está no mínimo ou abaixo nestes produtos");

    const gas = $('[data-usar-sugestao-compra="pGas"]')!;
    expect(txt(gas)).toContain("Gás R410A");
    expect(txt(gas)).toContain("faltam 3 un");
    expect(txt(gas)).toContain("R$ 980,00");
    expect(gas.getAttribute("title")).toBe("Refrimais · 2 compras nos últimos 6 meses");
  });

  it("histórico fino: aparece como compra nova, sem preço (não chuta)", async () => {
    await montar();
    const cap = $('[data-usar-sugestao-compra="pCap"]')!;
    expect(txt(cap)).toContain("faltam 10 pc");
    expect(txt(cap)).toContain("compra nova");
    expect(txt(cap)).not.toContain("R$");
    expect(cap.getAttribute("title")).toBe("Sem compra registrada nos últimos 6 meses");
  });

  it("clicar coloca a linha no pedido (quantidade = o que falta, valor = o último preço) e segue editável", async () => {
    await montar();
    expect(linhas()).toHaveLength(1);
    await clicar($('[data-usar-sugestao-compra="pGas"]'));

    // aproveitou a linha em branco em vez de deixar sobrando
    expect(linhas()).toHaveLength(1);
    const linha = linhas()[0];
    expect(campo(linha, "descricao").value).toBe("Gás R410A");
    expect(campo(linha, "quantidade").value).toBe("3");
    expect(campo(linha, "unidade").value).toBe("un");
    expect(campo(linha, "valorEstimado").value).toBe("980,00");

    // nada foi comprado nem gravado: só o que a pessoa vai conferir
    expect(chamadas.some((c) => c.metodo === "POST")).toBe(false);

    // e o produto sai da faixa (não se sugere o que já está na lista)
    expect($('[data-usar-sugestao-compra="pGas"]')).toBeNull();
    expect($('[data-usar-sugestao-compra="pCap"]')).not.toBeNull();
  });

  it("o segundo produto entra como linha nova, sem apagar o primeiro", async () => {
    await montar();
    await clicar($('[data-usar-sugestao-compra="pGas"]'));
    await clicar($('[data-usar-sugestao-compra="pCap"]'));
    expect(linhas()).toHaveLength(2);
    expect(linhas().map((l) => campo(l, "descricao").value)).toEqual(["Gás R410A", "Capacitor 35uF"]);
    expect(linhas().map((l) => campo(l, "quantidade").value)).toEqual(["3", "10"]);
    // sem preço no histórico, o estimado fica em branco para a pessoa preencher
    expect(campo(linhas()[1], "valorEstimado").value).toBe("");
    expect($("[data-sugestoes-compra]")).toBeNull(); // acabaram as sugestões
  });

  it("“Dispensar” tira a faixa e ela não volta", async () => {
    await montar();
    await clicar($("[data-dispensar-sugestoes-compra]"));
    expect($("[data-sugestoes-compra]")).toBeNull();
    await act(async () => {});
    expect($("[data-sugestoes-compra]")).toBeNull();
  });
});

describe("a sugestão é um extra: nunca atrapalha o pedido", () => {
  it("403 na rota (sem Compras › gerenciar): faixa nenhuma, e o pedido continua funcionando", async () => {
    respostas["/api/compras/sugestoes"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await montar();
    expect($("[data-sugestoes-compra]")).toBeNull();
    expect($("[data-erro-pedido]")).toBeNull();
    expect($("[data-salvar-pedido]")).not.toBeNull();
  });

  it("erro de conexão também não aparece na tela do pedido", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/compras/sugestoes")) throw new Error("sem rede");
      return new Response(JSON.stringify(url.startsWith("/api/cadastros/produtos") ? PRODUTOS : []), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    await montar();
    expect($("[data-sugestoes-compra]")).toBeNull();
    expect($("[data-erro-pedido]")).toBeNull();
  });

  it("lista vazia (nada no mínimo): a tela não mostra faixa alguma", async () => {
    respostas["/api/compras/sugestoes"] = { status: 200, corpo: { itens: [] } };
    await montar();
    expect($("[data-sugestoes-compra]")).toBeNull();
  });
});

describe("a sugestão só onde faz sentido", () => {
  it("pedido de OS não pede sugestão de reposição", async () => {
    await montar({ ordemServicoId: "os1" });
    expect(chamadas.some((c) => c.url.startsWith("/api/compras/sugestoes"))).toBe(false);
    expect($("[data-sugestoes-compra]")).toBeNull();
  });

  it("editar um pedido existente também não", async () => {
    const pedido = {
      id: "ped1", numero: "PCI-1", status: "SOLICITADO", statusEm: new Date().toISOString(),
      origem: { tipo: "AVULSO" }, solicitante: { id: "uA", nome: "Ana Souza" }, comprador: null, fornecedor: null,
      prazoNecessario: null, motivo: "Reposição de estoque", observacao: null, podeEditar: true, podeEnviar: false,
      podeDesvincular: false, itens: [{ id: "i1", produtoId: "pGas", descricao: "Gás R410A", quantidade: 2, unidade: "un", valorEstimado: 900, valorReal: null, recebido: 0 }],
      notas: [], eventos: [],
    };
    await montar({ pedido });
    expect(chamadas.some((c) => c.url.startsWith("/api/compras/sugestoes"))).toBe(false);
    expect($("[data-sugestoes-compra]")).toBeNull();
  });
});
