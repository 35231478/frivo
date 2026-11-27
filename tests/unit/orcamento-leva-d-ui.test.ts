// @vitest-environment happy-dom
/**
 * Orçamento, leva D (revista no "Orçamento E — Material × Peça") — a opção do documento do cliente, num DOM de
 * verdade (API simulada):
 *  - tela do orçamento: só "Mostrar materiais ao cliente", LIGADO por padrão (o botão de valores saiu); mudar grava
 *    (PUT) e recarrega o documento; erro do servidor volta o switch e avisa; sem Orçamentos › editar ou aprovado: travado;
 *  - o documento: materiais recuados DENTRO do serviço, SEM valor nem custo (nem em registro antigo com "valores"
 *    ligado); o número da OS como link público;
 *  - Configurações › Orçamentos: o padrão da empresa (ligado) vai no PUT, sem o campo antigo.
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
  await montar(createElement(OpcoesDocumento, { orcamentoId: "o1", inicial: { mostrarMateriais: true }, podeEditar: true, travado: null, ...props }));
}
const clicar = async (onde: string) => { await act(async () => { sw(onde).click(); }); await esperar(); };

describe("Documento do cliente — a opção na tela do orçamento", () => {
  it("só a opção de materiais (o botão de valores saiu); desligar grava, avisa e recarrega o documento", async () => {
    await opcoes();
    expect(ligado("[data-opcao-mostrar-materiais]")).toBe(true);
    expect($("[data-opcao-mostrar-valores]")).toBeNull();
    expect(document.querySelectorAll("[data-opcoes-documento] [role=switch]")).toHaveLength(1);
    expect($("[data-opcoes-documento]")!.textContent).not.toMatch(/valores? dos/i);
    await clicar("[data-opcao-mostrar-materiais]");
    expect(puts).toEqual([{ url: "/api/orcamentos/o1/opcoes-documento", corpo: { mostrarMateriais: false } }]);
    expect(avisos.toast).toHaveBeenCalledWith("Documento do cliente atualizado.");
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(ligado("[data-opcao-mostrar-materiais]")).toBe(false);
    await clicar("[data-opcao-mostrar-materiais]");
    expect(puts[1].corpo).toEqual({ mostrarMateriais: true });
  });

  it("orçamento antigo gravado desligado aparece desligado", async () => {
    await opcoes({ inicial: { mostrarMateriais: false } });
    expect(ligado("[data-opcao-mostrar-materiais]")).toBe(false);
  });

  it("erro do servidor: o switch volta e a mensagem aparece; nada recarrega", async () => {
    resposta = { status: 409, corpo: { erro: "Orçamento aprovado: o documento fica como o cliente aprovou." } };
    await opcoes();
    await clicar("[data-opcao-mostrar-materiais]");
    expect(ligado("[data-opcao-mostrar-materiais]")).toBe(true);
    expect(avisos.toast).toHaveBeenCalledWith("Orçamento aprovado: o documento fica como o cliente aprovou.", "erro");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("aprovado/cancelado ou sem permissão de editar: travado, com o motivo, sem PUT", async () => {
    await opcoes({ travado: "Orçamento aprovado: o documento fica como o cliente aprovou.", inicial: { mostrarMateriais: true } });
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
    const d = await html({ mostrarMateriais: false });
    expect(d.querySelector("[data-materiais-servico]")).toBeNull();
    expect(t(d.querySelector("[data-linha-item]"))).toContain("Limpeza de split");
  });

  it("padrão (nada gravado) = ligado: a lista de materiais aparece dentro do serviço", async () => {
    const d = await html({});
    expect([...d.querySelectorAll("[data-linha-item] [data-materiais-servico] [data-material-documento]")].map(t)).toEqual(["Filtro G4 · 2 un"]);
  });

  it("materiais: dentro da linha do serviço (mesma célula), só os materiais, SEM valor nem custo", async () => {
    const d = await html({ mostrarMateriais: true });
    const bloco = d.querySelector("[data-linha-item] [data-materiais-servico]");
    expect(bloco).toBeTruthy();
    expect([...bloco!.querySelectorAll("[data-material-documento]")].map(t)).toEqual(["Filtro G4 · 2 un"]);
    expect(t(bloco)).not.toMatch(/R\$|89,90|179,80|38,50/);
    expect(d.innerHTML).not.toMatch(/data-valor-material|38,50|38\.5|custo/i);
  });

  it("registro antigo com 'valores dos materiais' ligado: o valor não aparece mais", async () => {
    for (const versao of ["cliente", "interna"] as const) {
      const d = await html({ mostrarMateriais: true, mostrarValoresMateriais: true, issAliquota: 5, totalGeral: 462 }, versao);
      expect(d.querySelector("[data-materiais-servico]")).toBeTruthy();
      expect(t(d.querySelector("[data-materiais-servico]"))).not.toMatch(/R\$/);
    }
  });

  it("materiais só dentro de SERVIÇOS: uma linha de produto nunca ganha o bloco, mesmo que venha com materiais", async () => {
    const d = await html({ mostrarMateriais: true,
      produtos: [{ descricao: "Capacitor", quantidade: 1, valorUnitario: 30, valorTotal: 30, materiais: BASE.servicos[0].materiais }], totalProdutos: 30, totalGeral: 470 });
    expect(d.querySelectorAll("[data-materiais-servico]")).toHaveLength(1);
    expect(d.querySelector("[data-grupo-documento='produtos'] [data-materiais-servico]")).toBeNull();
  });

  it("os três iguais: a versão interna mostra o mesmo bloco", async () => {
    const cliente = await html({ mostrarMateriais: true });
    const interna = await html({ mostrarMateriais: true }, "interna");
    expect(t(interna.querySelector("[data-materiais-servico]"))).toBe(t(cliente.querySelector("[data-materiais-servico]")));
  });

  it("OS: com a versão do cliente é link público (nova aba); sem ela, texto", async () => {
    const d = await html({ mostrarMateriais: false });
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

  it("padrão ligado; só a opção de materiais (o botão de valores saiu); vai no PUT", async () => {
    await tela();
    expect(ligado("[data-padrao-mostrar-materiais]")).toBe(true);
    expect($("[data-padrao-mostrar-valores]")).toBeNull();
    await salvar();
    expect(puts[0].corpo).toMatchObject({ orcamentoMostrarMateriais: true });
    expect(puts[0].corpo).not.toHaveProperty("orcamentoMostrarValoresMateriais");
  });

  it("desligar vai no PUT; empresa antiga com o padrão desligado aparece desligada", async () => {
    await tela({ orcamentoMostrarMateriais: false });
    expect(ligado("[data-padrao-mostrar-materiais]")).toBe(false);
    await clicar("[data-padrao-mostrar-materiais]");
    await clicar("[data-padrao-mostrar-materiais]");
    await salvar();
    expect(puts[0].corpo).toMatchObject({ orcamentoMostrarMateriais: false });
  });

  it("sem Configurações › gerenciar: só leitura", async () => {
    await tela({ orcamentoMostrarMateriais: true }, false);
    expect(sw("[data-padrao-mostrar-materiais]").disabled).toBe(true);
    expect($("[data-salvar-padroes-orcamento]")).toBeNull();
  });
});
