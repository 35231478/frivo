// @vitest-environment happy-dom
/**
 * Prazos da OS — PR 5: a tela do relatório de cumprimento de prazos num DOM de verdade (happy-dom):
 *  - os TRÊS ESTADOS na tabela, cada um com a sua palavra e a sua cor, e o "sem registro" num estado
 *    próprio — nunca somado ao descumprido e FORA do percentual dos quadros;
 *  - a LEGENDA curta das três palavras, dita na tela, com a nota de por que o "sem registro" fica de
 *    fora (é ela que o gestor usa para cobrar o uso do "Cheguei");
 *  - os filtros no padrão da casa: período pela abertura (‹ ›, todo o período) e cliente/contrato na
 *    URL, sem perder o resto;
 *  - a PERMISSÃO: sem Relatórios › Exportar o botão do PDF não existe (não aparece desabilitado);
 *  - o celular: os cartões no lugar da tabela, com os mesmos estados;
 *  - o vazio: diz quantas OS do período não tinham prazo nenhum.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import {
  NOTA_SEM_REGISTRO, percentualCumprimento, resumoCumprimento, textoPercentual,
  type EstadoCumprimento, type LinhaCumprimento,
} from "@/lib/prazos/cumprimento";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: () => {}, replace: nav.replace, back: () => {} }),
  usePathname: () => "/ordens/cumprimento", useSearchParams: () => new URLSearchParams(nav.qs),
}));

let root: Root | null = null;
let caixa: HTMLDivElement;

beforeAll(async () => { await import("@/components/prazos/cumprimento-client"); }, 120_000);
beforeEach(() => {
  nav.replace.mockClear(); nav.qs = "";
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T18:00:00.000Z"));
});
afterEach(() => { act(() => root?.unmount()); root = null; caixa?.remove(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el, "elemento a clicar").not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const ultimaUrl = () => String(nav.replace.mock.calls.at(-1)?.[0] ?? "");

const NOV = { tipo: "mes", mes: "2026-11", de: null, ate: null, rotulo: "Novembro de 2026" } as const;
const OPCOES = {
  clientes: [{ value: "c1", label: "Hospital Santa Luzia" }, { value: "c2", label: "Padaria do Bairro" }],
  contratos: [{ value: "ct1", label: "CT-2026/001" }],
};

/** Uma linha do relatório, só com o que o caso precisa dizer */
const linha = (
  numero: string,
  estados: [EstadoCumprimento | null, EstadoCumprimento | null, EstadoCumprimento | null],
  extra: Partial<LinhaCumprimento> = {},
): LinhaCumprimento => ({
  id: `os-${numero}`, numero, clienteNome: "Hospital Santa Luzia", contratoNumero: "CT-2026/001",
  abertura: new Date("2026-11-05T12:00:00.000Z"), status: "CONCLUIDA",
  comparecer: estados[0], resolver: estados[1], execucao: estados[2], justificativa: null, ...extra,
});

/** Os três estados na mesma tela: um cumprido, um descumprido e um sem registro */
const LINHAS: LinhaCumprimento[] = [
  linha("CH-101", ["CUMPRIDO", "CUMPRIDO", "CUMPRIDO"]),
  linha("CH-102", ["DESCUMPRIDO", "DESCUMPRIDO", "DESCUMPRIDO"], { justificativa: "FALTA_DE_PECA" }),
  linha("CH-103", ["SEM_REGISTRO", "CUMPRIDO", null], { clienteNome: "Padaria do Bairro", contratoNumero: null }),
];

async function montar(props: Record<string, unknown> = {}) {
  const { ListaUrl } = await import("@/components/listagem/lista-url");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { CumprimentoClient } = await import("@/components/prazos/cumprimento-client");
  const linhas = (props.linhas as LinhaCumprimento[]) ?? LINHAS;
  const permissoes = (props.permissoes as Permissoes) ?? permissoesTotais();
  if (root) { act(() => root!.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  const tela = createElement(CumprimentoClient, {
    periodo: NOV, resumo: resumoCumprimento(linhas), linhas, semPrazo: 0, opcoes: OPCOES,
    podeExportar: true, urlPdf: "/api/relatorios/cumprimento-prazos?mes=2026-11",
    ...props,
  } as any);
  await act(async () => {
    root!.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children:
      createElement(ListaUrl, { chave: "cumprimento-prazos", qAtual: "", children: tela }) } as any));
  });
  await esperar();
}

/* ═════════ os três estados ═════════ */
describe("A tela do relatório: os três estados", () => {
  it("cada linha mostra o estado de cada prazo em PALAVRA, com o 'sem registro' num estado próprio", async () => {
    await montar();
    expect($$("[data-linha-cumprimento]").map((l) => l.getAttribute("data-linha-cumprimento"))).toEqual(["CH-101", "CH-102", "CH-103"]);
    const estados = (numero: string) => $$(`[data-linha-cumprimento='${numero}'] [data-estado]`).map((e) => [e.getAttribute("data-estado"), txt(e)]);
    expect(estados("CH-101")).toEqual([["CUMPRIDO", "Cumprido"], ["CUMPRIDO", "Cumprido"], ["CUMPRIDO", "Cumprido"]]);
    expect(estados("CH-102")).toEqual([["DESCUMPRIDO", "Descumprido"], ["DESCUMPRIDO", "Descumprido"], ["DESCUMPRIDO", "Descumprido"]]);
    // o "sem registro" não vira "descumprido", e o prazo que não existe fica num traço
    expect(estados("CH-103")).toEqual([["SEM_REGISTRO", "Sem registro"], ["CUMPRIDO", "Cumprido"]]);
    expect(txt($("[data-linha-cumprimento='CH-103']"))).toContain("—");
  });

  it("a cor reforça a palavra: verde no cumprido, vermelho no descumprido, neutro no sem registro", async () => {
    await montar();
    const classe = (estado: string) => $(`[data-estado='${estado}']`)!.className;
    expect(classe("CUMPRIDO")).toContain("pill-ok");
    expect(classe("DESCUMPRIDO")).toContain("pill-atrasado");
    expect(classe("SEM_REGISTRO")).toContain("pill-previsto"); // nunca a cor de atraso
    expect(classe("SEM_REGISTRO")).not.toContain("pill-atrasado");
  });

  it("os quadros do período: o percentual geral e um por prazo — com o 'sem registro' dito à parte, fora da conta", async () => {
    await montar();
    const quadros = $$("[data-quadro-prazo]").map((q) => [
      q.getAttribute("data-quadro-prazo"), txt(q.querySelector("[data-percentual]")), txt(q.querySelector("[data-detalhe]")),
    ]);
    // comparecer: 1 de 2 medidos (1 sem registro FORA); resolver: 2 de 3; execução: 1 de 2
    expect(quadros).toEqual([
      ["geral", "57%", "4 de 7 prazos cumpridos · 1 sem registro, fora da conta"],
      ["comparecer", "50%", "1 de 2 prazos cumpridos · 1 sem registro, fora da conta"],
      ["resolver", "67%", "2 de 3 prazos cumpridos"],
      ["execucao", "50%", "1 de 2 prazos cumpridos"],
    ]);
    // a conta da tela é a da lib: 4/7 = 57%. Se o "sem registro" contasse como descumprido, seriam 4/8 = 50%
    expect(percentualCumprimento(resumoCumprimento(LINHAS).geral)).toBe(57);
    expect(Math.round((4 / 8) * 100)).toBe(50); // o número que a tela NÃO mostra
  });

  it("só casos sem registro: nada foi medido, então a tela mostra '—' e não 0%", async () => {
    const linhas = [linha("CH-201", ["SEM_REGISTRO", "SEM_REGISTRO", null]), linha("CH-202", ["SEM_REGISTRO", "SEM_REGISTRO", null])];
    await montar({ linhas });
    expect(txt($("[data-quadro-prazo='geral'] [data-percentual]"))).toBe("—");
    expect(txt($("[data-quadro-prazo='geral'] [data-detalhe]"))).toBe("nenhum prazo medido · 4 sem registro, fora da conta");
    expect(txt($("[data-resumo-cumprimento]"))).not.toContain("0%");
    expect(textoPercentual(resumoCumprimento(linhas).geral)).toBe("—");
  });

  it("a legenda curta explica as três palavras e por que o 'sem registro' fica fora do percentual", async () => {
    await montar();
    expect($$("[data-legenda]").map((l) => l.getAttribute("data-legenda"))).toEqual(["CUMPRIDO", "DESCUMPRIDO", "SEM_REGISTRO"]);
    expect(txt($("[data-legenda='CUMPRIDO']"))).toBe("CumpridoO prazo foi medido e atendido.");
    expect(txt($("[data-legenda='SEM_REGISTRO']"))).toContain("Fica fora do percentual");
    expect(txt($("[data-legenda='SEM_REGISTRO']"))).toContain("Cheguei");
    expect(txt($("[data-nota-sem-registro]"))).toBe(NOTA_SEM_REGISTRO);
  });

  it("o atraso justificado aparece como nota na linha, sem mudar o estado nem a conta", async () => {
    await montar();
    expect(txt($("[data-linha-cumprimento='CH-102'] [data-atraso-justificado]"))).toBe("Justificado");
    expect($("[data-linha-cumprimento='CH-101'] [data-atraso-justificado]")).toBeNull();
    // a linha justificada continua descumprida
    expect($$("[data-linha-cumprimento='CH-102'] [data-estado='DESCUMPRIDO']")).toHaveLength(3);
  });

  it("o contador diz quantos chamados e quantas OS do período não tinham prazo nenhum", async () => {
    await montar({ semPrazo: 4 });
    expect(txt($("[data-contador]"))).toBe("3 chamados · 4 sem prazo a relatar");
    await montar({ linhas: [LINHAS[0]], semPrazo: 0 });
    expect(txt($("[data-contador]"))).toBe("1 chamado");
  });

  it("período sem nada a relatar: diz o motivo, sem tabela e sem percentual inventado", async () => {
    await montar({ linhas: [], semPrazo: 7 });
    expect($("[data-tabela-cumprimento]")).toBeNull();
    expect(txt($("[data-lista-vazia]"))).toContain("Nenhum prazo a relatar no período");
    expect(txt($("[data-lista-vazia]"))).toContain("As 7 OS abertas no período ainda não têm prazo decidido: sem prazo definido, ou com o prazo ainda correndo.");
    await montar({ linhas: [], semPrazo: 1 });
    expect(txt($("[data-lista-vazia]"))).toContain("A OS aberta no período ainda não tem prazo decidido");
    await montar({ linhas: [], semPrazo: 0 });
    expect(txt($("[data-lista-vazia]"))).toContain("Nenhuma OS ou chamado foi aberto neste período.");
    expect(txt($("[data-quadro-prazo='geral'] [data-percentual]"))).toBe("—");
  });
});

/* ═════════ filtros no padrão da casa ═════════ */
describe("Os filtros: período pela abertura, cliente e contrato", () => {
  it("o período é o da casa, rotulado pela ABERTURA, com ‹ ›, todo o período e ⓘ", async () => {
    await montar();
    expect(txt($("[data-periodo]"))).toContain("Abertura");
    expect(txt($("[data-mes-rotulo]"))).toBe("Novembro de 2026");
    expect($("[data-periodo] [data-dica]")).not.toBeNull();
    // a tela não tem o que pesquisar: nem campo, nem rótulo solto de busca
    expect($("[data-busca-caixa]")).toBeNull();
    expect(txt($("[data-barra-filtros]"))).not.toContain("Pesquisar");
    await clicar($("[data-mes-anterior]"));
    expect(ultimaUrl()).toBe("/ordens/cumprimento?mes=2026-10");
    await clicar($("[data-periodo-menu]"));
    await clicar($("[data-todo-periodo]"));
    expect(ultimaUrl()).toBe("/ordens/cumprimento?periodo=todos");
  });

  it("cliente e contrato entram na URL sem derrubar o período (e o avançado fica atrás do botão de filtros)", async () => {
    nav.qs = "mes=2026-10";
    await montar();
    // progressive disclosure: cliente e contrato não poluem a barra; vêm do menu "Mais filtros"
    expect($("select[aria-label='Cliente']")).toBeNull();
    await clicar($("[data-mais-filtros]"));
    expect($$("[data-filtro-opcao]").map((o) => o.getAttribute("data-filtro-opcao"))).toEqual(["clienteId", "contratoId"]);
    await clicar($("[data-filtro-opcao='clienteId']"));
    const cliente = $("select[aria-label='Cliente']");
    expect(cliente, "seletor de cliente").not.toBeNull();
    await act(async () => {
      (cliente as HTMLSelectElement).value = "c1";
      cliente!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperar();
    expect(ultimaUrl()).toContain("mes=2026-10");
    expect(ultimaUrl()).toContain("clienteId=c1");
  });
});

/* ═════════ permissão ═════════ */
describe("A permissão do PDF", () => {
  it("com Relatórios › Exportar, o botão do PDF aponta para a rota com os mesmos parâmetros da tela", async () => {
    await montar({ permissoes: montarPermissoes({ relatorios: ["visualizar", "exportar"] }) });
    const botao = $("[data-baixar-pdf]");
    expect(txt(botao)).toBe("PDF do cliente");
    expect(botao!.getAttribute("href")).toBe("/api/relatorios/cumprimento-prazos?mes=2026-11");
  });

  it("sem a permissão, o botão NÃO existe — nem desabilitado (a tela não muda de outra forma)", async () => {
    await montar({ permissoes: montarPermissoes({ relatorios: ["visualizar"] }) });
    expect($("[data-baixar-pdf]")).toBeNull();
    // e o relatório continua todo lá: quem só vê, vê tudo
    expect($$("[data-linha-cumprimento]")).toHaveLength(3);
    expect(txt($("[data-quadro-prazo='geral'] [data-percentual]"))).toBe("57%");
    expect($("[data-legenda-cumprimento]")).not.toBeNull();
  });

  it("o servidor negando (podeExportar=false) também esconde o botão, mesmo com a permissão no provedor", async () => {
    await montar({ podeExportar: false });
    expect($("[data-baixar-pdf]")).toBeNull();
  });
});

/* ═════════ celular ═════════ */
describe("No celular", () => {
  it("os cartões trazem o número, o cliente e os mesmos estados, prazo a prazo", async () => {
    await montar();
    expect($$("[data-cartao-cumprimento]").map((c) => c.getAttribute("data-cartao-cumprimento"))).toEqual(["CH-101", "CH-102", "CH-103"]);
    const cartao = $("[data-cartao-cumprimento='CH-103']")!;
    expect(txt(cartao)).toContain("Padaria do Bairro");
    expect(txt(cartao)).toContain("05/11/2026");
    expect([...cartao.querySelectorAll("[data-estado]")].map((e) => [e.getAttribute("data-estado"), txt(e)]))
      .toEqual([["SEM_REGISTRO", "Sem registro"], ["CUMPRIDO", "Cumprido"]]);
    // o prazo que não existe não ocupa espaço no celular
    expect(txt(cartao)).not.toContain("Prazo de execução");
    expect(txt($("[data-cartao-cumprimento='CH-101']"))).toContain("Prazo de execução");
  });
});
