// @vitest-environment happy-dom
/**
 * Orçamento, leva D — as opções do documento do cliente, num DOM de verdade (API simulada):
 *  - tela do orçamento: "Mostrar materiais ao cliente" e "Mostrar valores…" desligados por padrão; valores travado
 *    enquanto materiais está desligado; ligar grava (PUT) e recarrega o documento; desligar materiais desliga valores;
 *    erro do servidor volta o switch e avisa; sem Orçamentos › editar ou aprovado: travado, com o motivo;
 *  - o documento: materiais recuados DENTRO do serviço, com/sem valores; o número da OS como link público;
 *  - Configurações › Orçamentos: o padrão da empresa (valores só com materiais) vai no PUT.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos/o1", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast }));

let root: Root;
let caixa: HTMLDivElement;
let resposta: { status: number; corpo: any };
const puts: { url: string; corpo: any }[] = [];

beforeEach(() => {
  puts.length = 0; avisos.toast.mockClear(); nav.refresh.mockClear();
  resposta = { status: 200, corpo: { ok: true } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    if (init.method === "PUT") puts.push({ url, corpo });
    return new Response(JSON.stringify(resposta.status === 200 ? { ...resposta.corpo, ...corpo } : resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const sw = (onde: string) => $(`${onde} [role=switch]`) as HTMLButtonElement;
const ligado = (onde: string) => sw(onde).getAttribute("aria-checked") === "true";
async function montar(el: any) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}
async function opcoes(props: Partial<{ inicial: any; podeEditar: boolean; travado: string | null }> = {}) {
  const { OpcoesDocumento } = await import("@/components/orcamento/opcoes-documento");
  await montar(createElement(OpcoesDocumento, { orcamentoId: "o1", inicial: { mostrarMateriais: false, mostrarValoresMateriais: false }, podeEditar: true, travado: null, ...props }));
}
const clicar = async (onde: string) => { await act(async () => { sw(onde).click(); }); await esperar(); };

describe("Documento do cliente — as duas opções na tela do orçamento", () => {
  it("padrão desligado; valores travado até ligar materiais; ligar grava, avisa e recarrega o documento", async () => {
    await opcoes();
    expect(ligado("[data-opcao-mostrar-materiais]")).toBe(false);
    expect(ligado("[data-opcao-mostrar-valores]")).toBe(false);
    expect(sw("[data-opcao-mostrar-valores]").disabled).toBe(true);
    expect($("[data-opcao-mostrar-valores]")!.textContent).toContain("Ligue “Mostrar materiais” primeiro.");
    await clicar("[data-opcao-mostrar-materiais]");
    expect(puts).toEqual([{ url: "/api/orcamentos/o1/opcoes-documento", corpo: { mostrarMateriais: true, mostrarValoresMateriais: false } }]);
    expect(avisos.toast).toHaveBeenCalledWith("Documento do cliente atualizado.");
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(sw("[data-opcao-mostrar-valores]").disabled).toBe(false);
    await clicar("[data-opcao-mostrar-valores]");
    expect(puts[1].corpo).toEqual({ mostrarMateriais: true, mostrarValoresMateriais: true });
    expect(ligado("[data-opcao-mostrar-valores]")).toBe(true);
  });

  it("desligar materiais desliga valores junto (um PUT só, coerente)", async () => {
    await opcoes({ inicial: { mostrarMateriais: true, mostrarValoresMateriais: true } });
    expect(ligado("[data-opcao-mostrar-valores]")).toBe(true);
    await clicar("[data-opcao-mostrar-materiais]");
    expect(puts).toEqual([{ url: "/api/orcamentos/o1/opcoes-documento", corpo: { mostrarMateriais: false, mostrarValoresMateriais: false } }]);
    expect(ligado("[data-opcao-mostrar-valores]")).toBe(false);
  });

  it("valores gravado sem materiais (dado antigo/incoerente) aparece desligado", async () => {
    await opcoes({ inicial: { mostrarMateriais: false, mostrarValoresMateriais: true } });
    expect(ligado("[data-opcao-mostrar-valores]")).toBe(false);
  });

  it("erro do servidor: o switch volta e a mensagem aparece; nada recarrega", async () => {
    resposta = { status: 409, corpo: { erro: "Orçamento aprovado: o documento fica como o cliente aprovou." } };
    await opcoes();
    await clicar("[data-opcao-mostrar-materiais]");
    expect(ligado("[data-opcao-mostrar-materiais]")).toBe(false);
    expect(avisos.toast).toHaveBeenCalledWith("Orçamento aprovado: o documento fica como o cliente aprovou.", "erro");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("aprovado/cancelado ou sem permissão de editar: travado, com o motivo, sem PUT", async () => {
    await opcoes({ travado: "Orçamento aprovado: o documento fica como o cliente aprovou.", inicial: { mostrarMateriais: true, mostrarValoresMateriais: false } });
    expect(sw("[data-opcao-mostrar-materiais]").disabled).toBe(true);
    expect($("[data-opcoes-travadas]")!.textContent).toContain("Orçamento aprovado");
    await clicar("[data-opcao-mostrar-materiais]");
    expect(puts).toHaveLength(0);
    act(() => root.unmount()); caixa.remove();
    await opcoes({ podeEditar: false });
    expect(sw("[data-opcao-mostrar-materiais]").disabled).toBe(true);
    expect($("[data-opcoes-travadas]")!.textContent).toContain("Só quem edita orçamentos");
  });
});

describe("O documento — materiais dentro do serviço e a OS como link", () => {
  const BASE = {
    codigo: "ORC-216", nome: "Climatização", status: "ENVIADO", criadoEm: "2026-11-26T12:00:00Z", empresaId: "e1",
    totalServicos: 440, totalProdutos: 0, totalGeral: 440,
    servicos: [{
      descricao: "Limpeza de split", quantidade: 2, valorUnitario: 220, valorTotal: 440,
      materiais: [
        { descricao: "Filtro G4", unidade: "un", quantidade: 2, valorVendaUnit: 89.9, comportamento: "INCLUSO_NO_SERVICO", ordem: 0, custoUnit: 38.5 },
        { descricao: "Capacitor (à parte)", unidade: "un", quantidade: 1, valorVendaUnit: 30, comportamento: "VENDA_A_PARTE", ordem: 1 },
      ],
    }],
    produtos: [],
    ordensServico: [
      { ordemServico: { numero: "OS-8901", criadoEm: "2026-11-01", empresaId: "e1", relatorios: [{ tokenPublico: "5ff6ddb2-d03c-4865-b40a-1d433ddcc5d0", escopo: "GERAL", empresaId: "e1" }] } },
      { ordemServico: { numero: "OS-8902", criadoEm: "2026-11-02", empresaId: "e1", relatorios: [] } },
    ],
  };
  const EMPRESA = { nome: "Clima Total", cnpj: "12345678000190" };
  const CLIENTE = { nome: "Hospital", cpfCnpj: "22101333000111" };
  async function html(extra: Record<string, unknown>, versao: "cliente" | "interna" = "cliente") {
    const { OrcamentoDocumento } = await import("@/components/orcamento/orcamento-documento");
    const d = document.createElement("div");
    d.innerHTML = renderToStaticMarkup(createElement(OrcamentoDocumento as any, { orcamento: { ...BASE, ...extra }, empresa: EMPRESA, cliente: CLIENTE, versao }));
    return d;
  }
  const t = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

  it("desligado: só a linha do serviço", async () => {
    const d = await html({});
    expect(d.querySelector("[data-materiais-servico]")).toBeNull();
    expect(t(d.querySelector("[data-linha-item]"))).toContain("Limpeza de split");
  });

  it("materiais: dentro da linha do serviço (mesma célula), só os inclusos, sem preço", async () => {
    const d = await html({ mostrarMateriais: true });
    const bloco = d.querySelector("[data-linha-item] [data-materiais-servico]");
    expect(bloco).toBeTruthy();
    expect([...bloco!.querySelectorAll("[data-material-documento]")].map(t)).toEqual(["Filtro G4 · 2 un"]);
    expect(bloco!.querySelector("[data-valor-material]")).toBeNull();
  });

  it("com valores: preço de venda unitário e total; custo nunca", async () => {
    const d = await html({ mostrarMateriais: true, mostrarValoresMateriais: true });
    expect(t(d.querySelector("[data-valor-material]"))).toBe("R$ 89,90/un · R$ 179,80");
    expect(d.innerHTML).not.toMatch(/38,50|38\.5|custo/i);
  });

  it("ISS 5% (versão do cliente): os materiais vêm na mesma base do serviço e a soma exibida bate", async () => {
    const d = await html({ mostrarMateriais: true, mostrarValoresMateriais: true, issAliquota: 5, totalGeral: 462,
      servicos: [{ ...BASE.servicos[0], materiais: [...BASE.servicos[0].materiais, { descricao: "Fita", unidade: "rl", quantidade: 2, valorVendaUnit: 12.5, comportamento: "INCLUSO_NO_SERVICO", ordem: 2 }] }] });
    // o serviço: 440 → 462 (ISS embutido, fator 1,05)
    expect(t(d.querySelector("[data-linha-item] [data-total-item]"))).toBe("462,00");
    const valores = [...d.querySelectorAll("[data-valor-material]")].map(t);
    expect(valores).toEqual(["R$ 94,40/un · R$ 188,79", "R$ 13,13/rl · R$ 26,25"]);
    const reais = (x: string) => Number(x.split("· R$ ")[1].replace(/\./g, "").replace(",", "."));
    // a soma do que o cliente lê = Σ preço × qtd × 1,05 (179,80 + 25,00 = 204,80 → 215,04)
    expect(Math.round(valores.map(reais).reduce((a, b) => a + b, 0) * 100) / 100).toBe(215.04);
    // a versão interna (ISS em linha própria) mostra o preço cadastrado
    const interna = await html({ mostrarMateriais: true, mostrarValoresMateriais: true, issAliquota: 5, totalGeral: 462 }, "interna");
    expect(t(interna.querySelector("[data-valor-material]"))).toBe("R$ 89,90/un · R$ 179,80");
  });

  it("valores sem materiais: nada (a regra vale no documento, não só na tela)", async () => {
    const d = await html({ mostrarMateriais: false, mostrarValoresMateriais: true });
    expect(d.querySelector("[data-materiais-servico]")).toBeNull();
  });

  it("os três iguais: a versão interna mostra o mesmo bloco", async () => {
    const d = await html({ mostrarMateriais: true, mostrarValoresMateriais: true }, "interna");
    expect(t(d.querySelector("[data-valor-material]"))).toBe("R$ 89,90/un · R$ 179,80");
  });

  it("OS: com a versão do cliente é link público (nova aba); sem ela, texto", async () => {
    const d = await html({});
    const links = [...d.querySelectorAll("[data-os-documento] a")] as HTMLAnchorElement[];
    expect(links.map((a) => [a.textContent, a.getAttribute("href"), a.getAttribute("target")])).toEqual([["OS-8901", "/relatorio/os/5ff6ddb2-d03c-4865-b40a-1d433ddcc5d0", "_blank"]]);
    expect(t(d.querySelector("[data-os-documento] dd"))).toBe("OS-8901, OS-8902");
  });
});

describe("Configurações › Orçamentos — o padrão da empresa", () => {
  const INICIAL = { orcamentoValidadeDias: 10, orcamentoGarantiaServico: null, orcamentoGarantiaPecas: null, orcamentoNaoIncluso: null, orcamentoNormas: [] };
  async function tela(inicial: Record<string, unknown> = {}, podeEditar = true) {
    const { OrcamentoPadroesClient } = await import("@/components/config/orcamento-padroes-client");
    await montar(createElement(OrcamentoPadroesClient, { inicial: { ...INICIAL, ...inicial } as any, podeEditar }));
  }
  const salvar = async () => { await act(async () => { $("[data-salvar-padroes-orcamento]")!.click(); }); await esperar(); };

  it("valores travado até ligar materiais; os dois vão no PUT", async () => {
    await tela();
    expect(sw("[data-padrao-mostrar-valores]").disabled).toBe(true);
    await clicar("[data-padrao-mostrar-materiais]");
    await clicar("[data-padrao-mostrar-valores]");
    await salvar();
    expect(puts[0].corpo).toMatchObject({ orcamentoMostrarMateriais: true, orcamentoMostrarValoresMateriais: true });
  });

  it("desligar materiais desliga valores", async () => {
    await tela({ orcamentoMostrarMateriais: true, orcamentoMostrarValoresMateriais: true });
    expect(ligado("[data-padrao-mostrar-valores]")).toBe(true);
    await clicar("[data-padrao-mostrar-materiais]");
    expect(ligado("[data-padrao-mostrar-valores]")).toBe(false);
    await salvar();
    expect(puts[0].corpo).toMatchObject({ orcamentoMostrarMateriais: false, orcamentoMostrarValoresMateriais: false });
  });

  it("sem Configurações › gerenciar: só leitura", async () => {
    await tela({ orcamentoMostrarMateriais: true }, false);
    expect(sw("[data-padrao-mostrar-materiais]").disabled).toBe(true);
    expect($("[data-salvar-padroes-orcamento]")).toBeNull();
  });
});
