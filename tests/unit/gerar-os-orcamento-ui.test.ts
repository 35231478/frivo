// @vitest-environment happy-dom
/**
 * "Gerar OS" no orçamento aprovado — o componente num DOM de verdade:
 *  - sem OS e com permissão de criar OS: texto curto + ⓘ e o botão; sem permissão, nada;
 *  - o modal diz quantos itens vão, pede quem executa (obrigatório, sem chamar o servidor) e a data;
 *  - gerar: POST com a execução, toast de sucesso e vai para a OS; já existia: toast informativo e
 *    vai para a existente; erro do servidor fica no modal (sem navegar);
 *  - com OS: mostra qual (gerada × vinculada) e "Abrir OS" só para quem vê OS — nunca o botão de gerar.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos/orc1", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast }));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => { await import("@/components/orcamento/gerar-os"); }, 120_000);
beforeEach(() => {
  chamadas.length = 0;
  nav.push.mockClear();
  avisos.toast.mockClear();
  respostas = {
    "GET /api/tecnicos": { status: 200, corpo: [{ id: "t1", nome: "João Silva", competencias: [] }] },
    "GET /api/equipes": { status: 200, corpo: [{ id: "eq1", nome: "Alfa", cor: null, liderId: "t1", membroIds: ["t1"] }] },
    "GET /api/veiculos": { status: 200, corpo: [] },
    "POST /api/orcamentos/orc1/gerar-os": { status: 201, corpo: { os: { id: "osNova", numero: "OS-2026-0042" }, jaExistia: false } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(props: Record<string, unknown> = {}) {
  const { GerarOs } = await import("@/components/orcamento/gerar-os");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(GerarOs, { orcamentoId: "orc1", codigo: "ORC-0007", itens: 3, os: null, podeCriar: true, podeVer: true, ...props } as any));
  });
  await esperar();
}
// O modal pode ir para o <body>: procura no documento todo
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const posts = () => chamadas.filter((c) => c.metodo === "POST");
async function abrirEEscolherEquipe() {
  await clicar($("[data-gerar-os]"));
  await clicar($("[data-seletor-equipe] button"));
  await clicar($('[data-opcao-equipe="eq1"]'));
}

describe("orçamento aprovado sem OS", () => {
  it("texto curto com ⓘ e o botão Gerar OS; nada é buscado antes de abrir", async () => {
    await montar();
    expect(txt($("[data-gerar-os]"))).toBe("Gerar OS");
    const linha = $("[data-gerar-os]")!.parentElement!;
    expect(txt(linha.querySelector("p"))).toContain("Orçamento aprovado, ainda sem OS.");
    expect(linha.querySelector("[data-dica]")).not.toBeNull();
    // Responsivo: largura total no celular, automático a partir de sm
    expect($("[data-gerar-os]")!.className).toMatch(/(^|\s)w-full(\s|$)/);
    expect($("[data-gerar-os]")!.className).toContain("sm:w-auto");
    expect($("[data-modal-gerar-os]")).toBeNull();
    expect(chamadas).toEqual([]);
  });

  it("sem permissão de criar OS: o botão não aparece", async () => {
    await montar({ podeCriar: false });
    expect($("[data-gerar-os]")).toBeNull();
    expect(txt(caixa)).toBe("");
  });

  it("o modal diz quantos itens vão (singular/plural) e carrega quem pode executar", async () => {
    await montar();
    await clicar($("[data-gerar-os]"));
    const modal = $("[data-modal-gerar-os]")!;
    expect(txt(modal)).toContain("3 itens serão copiados para a OS.");
    expect(modal.querySelector("[data-seletor-execucao]")).not.toBeNull();
    expect(chamadas.map((c) => c.url)).toEqual(expect.arrayContaining(["/api/tecnicos", "/api/equipes?resumo=1"]));
    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
    await montar({ itens: 1 });
    await clicar($("[data-gerar-os]"));
    expect(txt($("[data-modal-gerar-os]"))).toContain("1 item será copiado para a OS.");
  });

  it("sem quem executa: avisa no modal e não chama o servidor", async () => {
    await montar();
    await clicar($("[data-gerar-os]"));
    await clicar($("[data-confirmar-gerar-os]"));
    expect(posts()).toEqual([]);
    expect(txt($("[data-erro-gerar-os]"))).toBeTruthy();
    expect($("[data-erro-executor]")).not.toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("gerar: POST com a execução, toast de sucesso e vai para a OS criada", async () => {
    await montar();
    await abrirEEscolherEquipe();
    await clicar($("[data-confirmar-gerar-os]"));
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toBe("/api/orcamentos/orc1/gerar-os");
    expect(posts()[0].corpo.execucao).toMatchObject({ equipeId: "eq1", tecnicoIds: ["t1"], dataAgendada: null });
    expect(avisos.toast).toHaveBeenCalledWith("OS OS-2026-0042 gerada.", "sucesso");
    expect(nav.push).toHaveBeenCalledWith("/ordens/osNova");
  });

  it("já existia (outro clique/aba): toast informativo e vai para a OS existente", async () => {
    respostas["POST /api/orcamentos/orc1/gerar-os"] = { status: 200, corpo: { os: { id: "osVelha", numero: "OS-2026-0010" }, jaExistia: true } };
    await montar();
    await abrirEEscolherEquipe();
    await clicar($("[data-confirmar-gerar-os]"));
    expect(avisos.toast).toHaveBeenCalledWith("Este orçamento já tem a OS OS-2026-0010.", "info");
    expect(nav.push).toHaveBeenCalledWith("/ordens/osVelha");
  });

  it("erro do servidor fica no modal e não navega", async () => {
    respostas["POST /api/orcamentos/orc1/gerar-os"] = { status: 409, corpo: { erro: "Disponível apenas para orçamento aprovado." } };
    await montar();
    await abrirEEscolherEquipe();
    await clicar($("[data-confirmar-gerar-os]"));
    expect(txt($("[data-erro-gerar-os]"))).toBe("Disponível apenas para orçamento aprovado.");
    expect($("[data-modal-gerar-os]")).not.toBeNull();
    expect(avisos.toast).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("orçamento que já tem OS", () => {
  it("gerada: mostra a OS e 'Abrir OS'; nunca o botão de gerar", async () => {
    await montar({ os: { id: "os9", numero: "OS-2026-0009", gerada: true } });
    expect(txt($("[data-os-do-orcamento]"))).toContain("OS gerada a partir deste orçamento: OS-2026-0009");
    expect($<HTMLAnchorElement>("[data-abrir-os]")!.getAttribute("href")).toBe("/ordens/os9");
    expect($("[data-gerar-os]")).toBeNull();
  });

  it("vinculada (criada de dentro da OS): diz que está vinculado; sem ver OS, sem o link", async () => {
    await montar({ os: { id: "os9", numero: "OS-2026-0009", gerada: false }, podeVer: false });
    expect(txt($("[data-os-do-orcamento]"))).toContain("Orçamento vinculado à OS OS-2026-0009");
    expect($("[data-abrir-os]")).toBeNull();
    expect($("[data-gerar-os]")).toBeNull();
  });
});
