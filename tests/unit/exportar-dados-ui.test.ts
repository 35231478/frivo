// @vitest-environment happy-dom
/**
 * "Exportar dados" — a tela, num DOM de verdade:
 *  - "Baixar tudo" e as três partes são links de download para a rota (o navegador recebe o .zip em streaming);
 *  - as últimas exportações: quando, quem, parte, linhas e a situação (concluída, gerando, não concluída);
 *  - ao clicar, a tela avisa que está gerando e confere a trilha até a exportação NOVA aparecer concluída (aviso
 *    de sucesso) ou não concluída (aviso de erro); a antiga que já estava na lista não engana;
 *  - lista vazia; botões com área de toque de 44 px.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn() }));

let root: Root;
let caixa: HTMLDivElement;
let historico: any[];
const pedidos: string[] = [];

beforeAll(async () => {
  await import("@/components/ui/avisos");
  await import("@/components/config/exportar-dados-client");
}, 120_000);
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
  pedidos.length = 0;
  historico = [];
  (globalThis as any).fetch = vi.fn(async (url: string) => {
    pedidos.push(String(url));
    return new Response(JSON.stringify({ exportacoes: historico }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.useRealTimers(); });

const linha = (id: string, extra: Partial<any> = {}) => ({
  id, usuarioNome: "Ana (fictícia)", parte: "tudo", criadoEm: "2026-11-27T14:00:00.000Z", concluidaEm: "2026-11-27T14:00:05.000Z",
  arquivos: 20, linhas: 1234, erro: null, ...extra,
});

async function montar(inicial: any[]) {
  const { ExportarDadosClient } = await import("@/components/config/exportar-dados-client");
  await act(async () => { root.render(createElement(ExportarDadosClient, { inicial })); });
}
const $ = (s: string) => caixa.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => [...caixa.querySelectorAll(s)] as HTMLElement[];
async function passar(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

describe("Exportar dados — tela", () => {
  it("os links de download: tudo e as três partes", async () => {
    await montar([]);
    const links = $$("a[data-exportar]");
    expect(links.map((a) => [a.dataset.exportar, a.getAttribute("href"), a.hasAttribute("download")])).toEqual([
      ["tudo", "/api/configuracoes/exportar-dados/baixar", true],
      ["cadastros", "/api/configuracoes/exportar-dados/baixar?parte=cadastros", true],
      ["operacao", "/api/configuracoes/exportar-dados/baixar?parte=operacao", true],
      ["financeiro", "/api/configuracoes/exportar-dados/baixar?parte=financeiro", true],
    ]);
    expect(links.map((a) => a.textContent?.trim())).toEqual(["Baixar tudo (.zip)", "Cadastros", "Operação", "Financeiro"]);
    for (const a of links) expect(a.className).toContain("min-h-[44px]");
    expect($("[data-exportar-vazio]")?.textContent).toBe("Nenhuma exportação ainda.");
  });

  it("as últimas exportações com a situação de cada uma", async () => {
    await montar([
      linha("a"),
      linha("b", { parte: "financeiro", concluidaEm: null, linhas: null, criadoEm: "2026-11-27T14:58:00.000Z" }),
      linha("c", { parte: "operacao", concluidaEm: null, erro: "Download interrompido antes do fim.", linhas: null }),
      linha("d", { concluidaEm: null, linhas: null, criadoEm: "2026-11-27T13:00:00.000Z" }),
    ]);
    const itens = $$("[data-exportacao]");
    expect(itens.map((li) => li.querySelector("[data-situacao-exportacao]")?.textContent)).toEqual(["Concluída", "Gerando", "Não concluída", "Não concluída"]);
    expect(itens[0].textContent).toContain("Ana (fictícia)");
    expect(itens[0].textContent).toContain("Tudo · 1.234 linhas");
    expect(itens[1].textContent).toContain("Financeiro");
    expect(itens[1].textContent).not.toContain("linhas");
  });

  it("clicar: avisa que está gerando e confere a trilha até a NOVA concluir", async () => {
    const { toast } = await import("@/components/ui/avisos");
    (toast as any).mockClear();
    await montar([linha("velha")]);
    historico = [linha("velha")];
    const a = $('a[data-exportar="cadastros"]')!;
    // O navegador cuidaria do download; aqui só o clique
    a.addEventListener("click", (e) => e.preventDefault());
    await act(async () => { a.click(); });
    expect($("[data-exportar-estado]")?.textContent).toBe("Gerando a parte Cadastros: o download começa em instantes.");

    // Ainda sem a nova: a velha (concluída) não encerra o acompanhamento
    await passar(4000);
    expect(pedidos.filter((u) => u === "/api/configuracoes/exportar-dados")).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
    expect($("[data-exportar-estado]")?.textContent).toContain("Gerando");

    historico = [linha("nova", { parte: "cadastros", concluidaEm: null, linhas: null, criadoEm: "2026-11-27T15:00:01.000Z" }), linha("velha")];
    await passar(4000);
    expect(toast).not.toHaveBeenCalled();
    expect($$("[data-exportacao]")).toHaveLength(2);

    historico = [linha("nova", { parte: "cadastros", criadoEm: "2026-11-27T15:00:01.000Z" }), linha("velha")];
    await passar(4000);
    expect(toast).toHaveBeenCalledWith("Exportação concluída. O arquivo está na pasta de downloads.");
    expect($("[data-exportar-estado]")?.textContent).toBe("");
    // Parou de conferir
    const n = pedidos.length;
    await passar(20_000);
    expect(pedidos.length).toBe(n);
  });

  it("a nova não concluiu: aviso de erro com o motivo gravado", async () => {
    const { toast } = await import("@/components/ui/avisos");
    (toast as any).mockClear();
    await montar([]);
    const a = $('a[data-exportar="tudo"]')!;
    a.addEventListener("click", (e) => e.preventDefault());
    await act(async () => { a.click(); });
    expect($("[data-exportar-estado]")?.textContent).toBe("Gerando o pacote: o download começa em instantes.");
    historico = [linha("x", { concluidaEm: null, erro: "Download interrompido antes do fim." })];
    await passar(4000);
    expect(toast).toHaveBeenCalledWith("Download interrompido antes do fim.", "erro");
  });

  it("sem resposta por mais de 6 minutos: para de conferir, sem aviso falso", async () => {
    const { toast } = await import("@/components/ui/avisos");
    (toast as any).mockClear();
    await montar([]);
    const a = $('a[data-exportar="financeiro"]')!;
    a.addEventListener("click", (e) => e.preventDefault());
    await act(async () => { a.click(); });
    await passar(6 * 60_000 + 8000);
    expect($("[data-exportar-estado]")?.textContent).toBe("");
    const n = pedidos.length;
    await passar(20_000);
    expect(pedidos.length).toBe(n);
    expect(toast).not.toHaveBeenCalled();
  });
});
