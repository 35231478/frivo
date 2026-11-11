// @vitest-environment happy-dom
/**
 * Tema 4 — card "Equipamentos" da aba Relatórios & Anexos conta os ATENDIDOS na OS (regra pura e a
 * tela). A prova com banco de verdade — o card bate com o relatório e o relatório só leva fotos da
 * execução — está em os-fotos-anexos-pg.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";
import { contarEquipamentosAtendidos } from "@/lib/relatorio-os/dados";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const v = (id: string, feito: boolean) => ({ feito, equipamento: { id } });
const a = (status: string, ...equipamentos: ReturnType<typeof v>[]) => ({ status, equipamentos });

describe("contarEquipamentosAtendidos (a mesma regra do relatório)", () => {
  it("conta só os marcados como atendidos — vinculado e não atendido fica de fora", () => {
    expect(contarEquipamentosAtendidos([a("EM_ANDAMENTO", v("eqA", true), v("eqB", false), v("eqC", false))])).toBe(1);
    expect(contarEquipamentosAtendidos([a("AGENDADA", v("eqA", false))])).toBe(0);
    expect(contarEquipamentosAtendidos([])).toBe(0);
  });

  it("equipamento atendido em duas atividades conta UMA vez (equipamento distinto, não vínculo)", () => {
    expect(contarEquipamentosAtendidos([a("CONCLUIDA", v("eqA", true), v("eqB", true)), a("CONCLUIDA", v("eqA", true))])).toBe(2);
  });

  it("atividade CANCELADA não atendeu ninguém", () => {
    expect(contarEquipamentosAtendidos([a("CANCELADA", v("eqA", true)), a("CONCLUIDA", v("eqB", true))])).toBe(1);
    expect(contarEquipamentosAtendidos([a("CANCELADA", v("eqA", true))])).toBe(0);
  });

  it("OS antiga concluída sem nenhum equipamento vinculado: o principal era o atendido; com vínculo, vale o vínculo", () => {
    expect(contarEquipamentosAtendidos([a("CONCLUIDA")], "eqPrincipal", true)).toBe(1);
    expect(contarEquipamentosAtendidos([a("CONCLUIDA")], "eqPrincipal", false)).toBe(0); // OS ainda aberta: ninguém atendido
    expect(contarEquipamentosAtendidos([a("CONCLUIDA", v("eqA", false))], "eqPrincipal", true)).toBe(0); // tem vínculo: não é o caso antigo
    expect(contarEquipamentosAtendidos([a("CONCLUIDA")], null, true)).toBe(0);
  });
});

describe("aba Relatórios & Anexos da OS", () => {
  let root: Root; let caixa: HTMLDivElement;
  afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

  it("o card diz 'Equipamentos atendidos' e mostra o número que a API manda (os atendidos, não os da unidade)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      relatorios: [],
      resumo: { statusOs: "EM_EXECUCAO", totalAtividades: 1, totalTecnicos: 1, totalFotos: 4, totalEquipamentos: 2, periodoInicio: null, periodoFim: null, atividades: [] },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const { OsRelatorios } = await import("@/components/os/os-relatorios");
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    caixa = document.createElement("div"); document.body.appendChild(caixa);
    root = createRoot(caixa);
    await act(async () => { root.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), children: createElement(OsRelatorios, { osId: "os1" }) })); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); });
    const texto = caixa.textContent ?? "";
    expect(texto).toContain("Equipamentos atendidos");
    const card = [...caixa.querySelectorAll("div")].find((d) => d.children.length <= 3 && d.textContent?.includes("Equipamentos atendidos") && /\d/.test(d.textContent ?? ""))!;
    expect(card.textContent).toMatch(/2/);
  });
});
