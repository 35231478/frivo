// @vitest-environment happy-dom
/**
 * SOLICITAÇÕES ABRINDO SOZINHAS — o vigia na tela, com o relógio parado:
 *  - a primeira conferência só estabelece a linha de base (o que já estava pendente não é "novo");
 *  - a cada 60s confere o contador; chegou chamado novo e a pessoa está ociosa → o painel abre sozinho;
 *  - NÃO abre se: a pessoa mexeu há menos de 20s, há diálogo aberto, há filtro ativo, há arrasto, a gaveta já
 *    está aberta, ou a aba está em segundo plano (aí nem consulta);
 *  - abrir não rouba o foco; o mesmo chamado não reabre; abrir à mão marca como visto;
 *  - sem a permissão da gaveta, o vigia nem existe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { CHAVE_ULTIMO_VISTO, INTERVALO_VIGIA_MS, MARCO_ZERO, OCIOSO_MS } from "@/lib/solicitacoes-vigia";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 30_000 });
const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: nav.replace, back: () => {} }),
  usePathname: () => "/calendario", useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));

let root: Root, caixa: HTMLDivElement;
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;

/* ── o servidor de mentira ── */
const T0 = "2026-11-25T12:00:00.000Z", T1 = "2026-11-25T12:05:00.000Z", T2 = "2026-11-25T12:09:00.000Z";
const servidor = { total: 1, maisRecenteEm: T0 as string | null };
const chamadas: string[] = [];
let visibilidade: DocumentVisibilityState = "visible";

const json = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  // Só o que o vigia usa: setInterval e o relógio. O setTimeout fica REAL — o act() do React depende dele
  // para fechar, e falsificá-lo pendura a montagem.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-11-25T13:00:00.000Z"));
  chamadas.length = 0;
  servidor.total = 1; servidor.maisRecenteEm = T0;
  visibilidade = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidade });
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    chamadas.push(u);
    if (u.startsWith("/api/solicitacoes/contador")) return json({ total: servidor.total, maisRecenteEm: servidor.maisRecenteEm });
    if (u.startsWith("/api/solicitacoes")) return json([{ id: "s1", numero: "CH-1", canal: "Portal do cliente", prioridade: "NORMAL", descricao: "Parou de gelar", criadoEm: servidor.maisRecenteEm, cliente: "Hospital", endereco: null, equipamento: null, contato: null, fotos: 0 }]);
    return json({});
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });

async function montar(permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { SolicitacoesGaveta } = await import("@/components/calendario/solicitacoes-gaveta");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(SolicitacoesGaveta, { totalInicial: 1, children: createElement("div", { "data-calendario": "" }, "calendário") }) }));
  });
  await rodar(0);
}
/** Anda o relógio e deixa as promessas do fetch assentarem */
async function rodar(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
const contagens = () => chamadas.filter((u) => u.startsWith("/api/solicitacoes/contador")).length;
const painel = () => $("[data-gaveta]");
const mexer = () => { window.dispatchEvent(new Event("pointermove")); };
/** Ocioso: ninguém mexe; o relógio anda um ciclo inteiro */
const umCiclo = () => rodar(INTERVALO_VIGIA_MS);

describe("Solicitações — o vigia abre o painel sozinho quando chega chamado novo e a pessoa está ociosa", () => {
  it("a primeira conferência é só a linha de base: o que já estava pendente não abre nada", async () => {
    await montar();
    expect(contagens(), "conferiu ao montar").toBe(1);
    expect(painel()).toBeNull();
    expect(window.localStorage.getItem(CHAVE_ULTIMO_VISTO), "o mais recente virou o último visto").toBe(T0);
  });

  it("começou com a caixa VAZIA: a linha de base é o marco zero e o PRIMEIRO chamado a cair abre", async () => {
    // o bug que o navegador real achou: sem pendência não havia data para guardar, o primeiro chamado
    // virava a própria linha de base e o painel nunca abria
    servidor.total = 0; servidor.maisRecenteEm = null;
    await montar();
    expect(window.localStorage.getItem(CHAVE_ULTIMO_VISTO), "marco zero").toBe(MARCO_ZERO);
    await umCiclo();
    expect(painel(), "ainda vazia: nada abre").toBeNull();
    servidor.total = 1; servidor.maisRecenteEm = T1;
    await umCiclo();
    expect(painel(), "o primeiro chamado é novo: abre").toBeTruthy();
  });

  it("um ciclo sem chamado novo, mesmo ociosa: nada abre", async () => {
    await montar();
    await umCiclo();
    expect(contagens()).toBe(2);
    expect(painel()).toBeNull();
  });

  it("chegou chamado NOVO e a pessoa está ociosa: o painel abre, sem roubar o foco, e marca como visto", async () => {
    await montar();
    const campo = document.createElement("input");
    document.body.appendChild(campo); campo.focus();
    servidor.total = 2; servidor.maisRecenteEm = T1;
    await umCiclo();
    expect(painel(), "abriu sozinho").toBeTruthy();
    expect(document.activeElement, "o foco ficou onde estava").toBe(campo);
    expect(window.localStorage.getItem(CHAVE_ULTIMO_VISTO)).toBe(T1);
    expect(chamadas.some((u) => u === "/api/solicitacoes"), "aberta, carrega a lista").toBe(true);
  });

  it("o mesmo chamado não reabre: fechou, outro ciclo igual, continua fechado", async () => {
    await montar();
    servidor.total = 2; servidor.maisRecenteEm = T1;
    await umCiclo();
    expect(painel()).toBeTruthy();
    await act(async () => { (painel()!.querySelector('button[title="Fechar solicitações"]') as HTMLElement).click(); });
    await rodar(0);
    expect(painel()).toBeNull();
    await umCiclo();
    expect(painel(), "T1 já foi visto").toBeNull();
    servidor.maisRecenteEm = T2;
    await umCiclo();
    expect(painel(), "T2 é novo: abre de novo").toBeTruthy();
  });

  it("a pessoa mexeu há menos de 20s: não abre; parou, abre no ciclo seguinte", async () => {
    await montar();
    servidor.total = 2; servidor.maisRecenteEm = T1;
    await rodar(INTERVALO_VIGIA_MS - 5_000);
    mexer();
    await rodar(5_000); // o ciclo bate 5s depois do toque
    expect(contagens()).toBe(2);
    expect(painel(), "mexeu há 5s: não interrompe").toBeNull();
    await umCiclo(); // 60s sem mexer
    expect(painel()).toBeTruthy();
  });

  it("há um diálogo aberto (uma OS, um modal): não abre", async () => {
    await montar();
    const dialogo = document.createElement("div"); dialogo.setAttribute("role", "dialog"); document.body.appendChild(dialogo);
    servidor.total = 2; servidor.maisRecenteEm = T1;
    await umCiclo();
    expect(painel()).toBeNull();
    dialogo.remove();
    await umCiclo();
    expect(painel(), "fechou o diálogo: abre no ciclo seguinte").toBeTruthy();
  });

  it("há filtro ativo no calendário: não abre", async () => {
    await montar();
    const faixa = document.createElement("div"); faixa.setAttribute("data-filtros-ativos", "1"); document.body.appendChild(faixa);
    servidor.total = 2; servidor.maisRecenteEm = T1;
    await umCiclo();
    expect(painel()).toBeNull();
    faixa.setAttribute("data-filtros-ativos", "0");
    await umCiclo();
    expect(painel()).toBeTruthy();
  });

  it("há um arrasto em curso: não abre", async () => {
    await montar();
    const grade = document.createElement("div"); grade.setAttribute("data-arrastando", ""); document.body.appendChild(grade);
    servidor.total = 2; servidor.maisRecenteEm = T1;
    await umCiclo();
    expect(painel()).toBeNull();
  });

  it("a aba está em segundo plano: nem consulta; ao voltar, confere na hora", async () => {
    await montar();
    visibilidade = "hidden";
    servidor.total = 2; servidor.maisRecenteEm = T1;
    await umCiclo();
    expect(contagens(), "nenhuma consulta com a aba escondida").toBe(1);
    visibilidade = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await rodar(0);
    expect(contagens()).toBe(2);
    expect(painel(), "voltou ociosa (o relógio andou 60s sem toque): abre").toBeTruthy();
  });

  it("a bolha da aba acompanha o contador mesmo sem abrir", async () => {
    await montar();
    servidor.total = 4; servidor.maisRecenteEm = T0; // nada novo, mas o total mudou
    await umCiclo();
    expect(painel()).toBeNull();
    expect($("[data-gaveta-contador]")!.textContent).toContain("4");
  });

  it("abrir à mão marca os chamados como vistos", async () => {
    await montar();
    servidor.total = 2; servidor.maisRecenteEm = T1;
    await act(async () => { $("[data-gaveta-aba]")!.click(); });
    await rodar(0);
    expect(painel()).toBeTruthy();
    expect(window.localStorage.getItem(CHAVE_ULTIMO_VISTO)).toBe(T1);
  });

  it("sem a permissão da gaveta o vigia nem existe: nenhuma consulta", async () => {
    await montar(montarPermissoes({ ordens: ["visualizar"] }));
    await umCiclo();
    expect(contagens()).toBe(0);
    expect($("[data-gaveta-aba]")).toBeNull();
  });
});
