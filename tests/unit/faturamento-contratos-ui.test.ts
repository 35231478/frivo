// @vitest-environment happy-dom
/**
 * Tela "Faturamento de contratos" (componente real, num DOM de verdade). Prova:
 *  - cards do mês (contratos, concluídas, em andamento, precisam de você) com valor e quantidade;
 *  - planilha no desktop e cartões no celular com a etapa, a medição, a NF, o boleto e o erro;
 *  - sem execução: o que esperar ("Fatura no dia 20" / "Sem cobrança neste mês");
 *  - "Tentar de novo" só no que falhou/parou: chama a API, avisa o resultado e recarrega;
 *  - "Precisam de você" filtra pela URL; ⓘ fora de qualquer botão; mês a mês, sem período personalizado.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LinhaFaturamentoContrato, ResumoFaturamentoContratos } from "@/lib/faturamento/painel-contratos-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), sp: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh, push: () => {}, replace: nav.replace }),
  usePathname: () => "/financeiro/faturamento-contratos",
  useSearchParams: () => nav.sp,
}));
const avisos = vi.hoisted(() => ({ lista: [] as [string, string][] }));
vi.mock("@/components/ui/avisos", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/avisos")>()),
  toast: (m: string, t = "sucesso") => { avisos.lista.push([m, t]); },
}));

let root: Root;
let caixa: HTMLDivElement;
let respostaTentar: { status: number; corpo: any };
const posts: string[] = [];

const linha = (o: Partial<LinhaFaturamentoContrato> & { contratoId: string }): LinhaFaturamentoContrato => ({
  contratoNumero: `CT-${o.contratoId}`, cliente: `Cliente ${o.contratoId}`, valor: 1000, frequencia: "por mês", aprovacaoAutomatica: false,
  previsto: null, execucao: null, ...o,
});
const exec = (o: Record<string, unknown>) => ({
  id: "x", etapa: "MEDICAO", situacao: "PENDENTE", erro: null, tentativas: 0, atualizadoEm: "2026-11-20T11:23:00.000Z", medicao: null, nf: null, cobrancas: [], ...o,
});
const LINHAS: LinhaFaturamentoContrato[] = [
  linha({ contratoId: "a", aprovacaoAutomatica: true, execucao: exec({ id: "ea", etapa: "CONCLUIDA", situacao: "CONCLUIDA", medicao: { id: "m1", numero: "MED-2026-0007", status: "NF_EMITIDA", nfNumero: "123" }, nf: { numero: "123", situacao: "AUTORIZADA" }, cobrancas: [{ id: "cr1", numero: "CT-1/202611", boleto: "EMITIDO" }] }) as any }),
  linha({ contratoId: "b", valor: 900, frequencia: "a cada 3 meses", execucao: exec({ id: "eb", etapa: "APROVACAO", situacao: "AGUARDANDO", medicao: { id: "m2", numero: "MED-2026-0008", status: "AGUARDANDO_APROVACAO", nfNumero: null } }) as any }),
  linha({ contratoId: "c", execucao: exec({ id: "ec", etapa: "MEDICAO", situacao: "FALHA", tentativas: 3, erro: "banco fora do ar" }) as any }),
  linha({ contratoId: "d", previsto: "Fatura no dia 20" }),
  linha({ contratoId: "e", previsto: "Sem cobrança neste mês" }),
];
const RESUMO: ResumoFaturamentoContratos = { contratos: { q: 5, v: 4900 }, concluidas: { q: 1, v: 1000 }, andamento: { q: 1, v: 900 }, atencao: { q: 1, v: 1000 } };
const PERIODO = { tipo: "mes" as const, mes: "2026-11", de: null, ate: null, rotulo: "Novembro de 2026" };
const sp = (t: string) => t.replace(/ /g, " ");
const $ = <T extends Element = HTMLElement>(s: string) => caixa.querySelector(s) as T | null;
const $$ = (s: string) => [...caixa.querySelectorAll(s)];

beforeAll(async () => { await import("@/components/financeiro/faturamento-contratos-view"); }, 120_000);
beforeEach(() => {
  avisos.lista = []; posts.length = 0; nav.refresh.mockClear(); nav.replace.mockClear(); nav.sp = new URLSearchParams();
  respostaTentar = { status: 200, corpo: { ok: true, execucao: { situacao: "CONCLUIDA" } } };
  globalThis.fetch = vi.fn(async (u: any, init?: RequestInit) => {
    posts.push(`${init?.method ?? "GET"} ${String(u)}`);
    return new Response(JSON.stringify(respostaTentar.corpo), { status: respostaTentar.status, headers: { "Content-Type": "application/json" } });
  }) as any;
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); });

async function montar(soAtencao = false, linhas = LINHAS) {
  const { FaturamentoContratosView } = await import("@/components/financeiro/faturamento-contratos-view");
  await act(async () => root.render(createElement(FaturamentoContratosView, { periodo: PERIODO, linhas, resumo: RESUMO, soAtencao })));
}
const tr = (id: string) => $(`table [data-linha-contrato="${id}"]`)!;
const card = (id: string) => $(`li[data-linha-contrato="${id}"]`)!;

describe("Faturamento de contratos", () => {
  it("cards do mês e a planilha: etapa, medição, NF, boleto, erro; sem execução, o que esperar", async () => {
    await montar();
    expect(sp($('[data-card="contratos"]')!.textContent!)).toContain("R$ 4.900,005 contratos");
    expect(sp($('[data-card="concluidas"]')!.textContent!)).toContain("R$ 1.000,001 contrato");
    expect(sp($('[data-card="atencao"]')!.textContent!)).toContain("Precisam de você");
    expect($("[data-mes-rotulo]")!.textContent).toBe("Novembro de 2026");
    expect($("[data-alternar-periodo]")).toBeNull(); // por competência: só mês a mês

    expect(tr("a").querySelector("[data-situacao]")!.textContent).toBe("Concluída");
    expect(tr("a").querySelector("[data-medicao]")!.textContent).toBe("MED-2026-0007");
    expect(tr("a").querySelector("[data-medicao]")!.getAttribute("href")).toBe("/financeiro/medicoes/m1");
    expect([tr("a").querySelector("[data-nf]")!.textContent, tr("a").querySelector("[data-boleto]")!.textContent]).toEqual(["nº 123", "Emitido"]);
    // NF → a medição (onde ficam a nota e o PDF); boleto → a conta a receber aberta na gaveta
    expect(tr("a").querySelector("[data-nf] a")!.getAttribute("href")).toBe("/financeiro/medicoes/m1");
    expect(tr("a").querySelector("[data-boleto] a")!.getAttribute("href")).toBe("/financeiro/contas-receber?conta=cr1&periodo=todos");
    expect(tr("a").textContent).toContain("aprova sozinho");
    expect(tr("b").querySelector("[data-situacao]")!.textContent).toBe("Aprovação · Aguardando");
    expect(sp(tr("b").textContent!)).toContain("a cada 3 meses");
    expect(tr("b").querySelector("[data-valor]")!.textContent).toBe("900,00");
    expect([tr("b").querySelector("[data-nf]")!.textContent, tr("b").querySelector("[data-boleto]")!.textContent]).toEqual(["—", "—"]);
    expect(tr("c").querySelector("[data-situacao]")!.textContent).toBe("Medição · Falhou");
    expect(tr("c").querySelector("[data-erro]")!.textContent).toBe("banco fora do ar");
    expect(tr("d").querySelector("[data-previsto]")!.textContent).toBe("Fatura no dia 20");
    expect(tr("e").querySelector("[data-previsto]")!.textContent).toBe("Sem cobrança neste mês");
    // "Tentar de novo" só no que falhou/parou
    expect($$("table [data-tentar]").map((b) => b.getAttribute("data-tentar"))).toEqual(["ec"]);
    // Celular: os mesmos dados em cartões
    expect(card("c").textContent).toContain("banco fora do ar");
    expect(card("a").textContent).toContain("MED-2026-0007");
    expect(card("a").textContent).toContain("NF nº 123");
    expect(card("a").textContent).toContain("Boleto Emitido");
    expect(card("d").textContent).toContain("Fatura no dia 20");
    // ⓘ fora de qualquer botão/link
    for (const d of $$('button[aria-label^="Sobre"], button[aria-describedby]')) expect(d.parentElement!.closest("button, a")).toBeNull();
  });

  it("Tentar de novo: chama a API, avisa e recarrega; se ainda falha, mostra o erro; erro da API aparece", async () => {
    await montar();
    await act(async () => { tr("c").querySelector<HTMLButtonElement>("[data-tentar]")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(posts).toEqual(["POST /api/faturamento-contratos/ec/tentar"]);
    expect(avisos.lista).toEqual([["Pronto: a cobrança seguiu.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);

    respostaTentar = { status: 200, corpo: { ok: true, execucao: { situacao: "PENDENTE", erro: "banco fora do ar" } } };
    await act(async () => { card("c").querySelector<HTMLButtonElement>("[data-tentar]")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(avisos.lista[1]).toEqual(["banco fora do ar", "erro"]);

    respostaTentar = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await act(async () => { tr("c").querySelector<HTMLButtonElement>("[data-tentar]")!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(avisos.lista[2]).toEqual(["Sem permissão para esta ação", "erro"]);
    expect(nav.refresh).toHaveBeenCalledTimes(2); // erro da API não recarrega
  });

  it("“Precisam de você” filtra (pela URL) e o vazio explica; nenhum contrato automático: diz onde ligar", async () => {
    await montar();
    await act(async () => { $<HTMLButtonElement>('[data-card="atencao"]')!.click(); });
    expect(nav.replace.mock.calls.at(-1)![0]).toBe("/financeiro/faturamento-contratos?atencao=1");
    act(() => root.unmount());
    root = createRoot(caixa);
    await montar(true);
    expect($$("table [data-linha-contrato]").map((l) => l.getAttribute("data-linha-contrato"))).toEqual(["c"]);
    expect($('[data-card="atencao"]')!.getAttribute("aria-pressed")).toBe("true");
    act(() => root.unmount());
    root = createRoot(caixa);
    await montar(true, LINHAS.filter((l) => l.contratoId !== "c"));
    expect($("[data-lista-vazia]")!.textContent).toContain("Nada parado neste mês");
    act(() => root.unmount());
    root = createRoot(caixa);
    await montar(false, []);
    expect($("[data-lista-vazia]")!.textContent).toContain("Ligue “Faturamento automático” no contrato");
  });
});
