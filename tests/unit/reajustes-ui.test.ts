// @vitest-environment happy-dom
/**
 * Tela "Reajustes a aplicar" (componente real, num DOM de verdade). Prova:
 *  - cards (para aplicar / adiados / vêm chegando) com o aumento por mês somado e a quantidade;
 *  - planilha no desktop e cartões no celular: aniversário, %, de → para, situação;
 *  - "Aplicar" pergunta antes (com o texto da sugestão) e manda o valor que a pessoa viu; cancelar não chama nada;
 *  - "Adiar 30 dias" só no pendente; "Dispensar" abre o modal com motivo; erro da API vira aviso e não recarrega;
 *  - "vem chegando" não tem botão (só "Aplica a partir de"); ⓘ fora de botão; vazio explica onde ligar.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LinhaReajuste } from "@/lib/contratos/reajuste-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh, push: () => {}, replace: () => {} }),
  usePathname: () => "/contratos/reajustes",
  useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ lista: [] as [string, string][], perguntas: [] as string[], responder: true }));
vi.mock("@/components/ui/avisos", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/avisos")>()),
  toast: (m: string, t = "sucesso") => { avisos.lista.push([m, t]); },
  confirmar: async (o: { mensagem: string }) => { avisos.perguntas.push(o.mensagem); return avisos.responder; },
}));

let root: Root;
let caixa: HTMLDivElement;
let resposta: { status: number; corpo: any };
const chamadas: { url: string; corpo: any }[] = [];

const linha = (o: Partial<LinhaReajuste> & { contratoId: string }): LinhaReajuste => ({
  numero: `CT-${o.contratoId}`, cliente: `Cliente ${o.contratoId}`, situacao: "PENDENTE", aniversario: { ano: 2026, mes: 11 },
  percentual: 5, valorAtual: 1000, valorNovo: 1050, adiadoAte: null, ...o,
});
const LINHAS = [
  linha({ contratoId: "a" }),
  linha({ contratoId: "b", percentual: 4.5, valorAtual: 2000, valorNovo: 2090 }),
  linha({ contratoId: "c", situacao: "ADIADO", adiadoAte: "2026-12-15", valorAtual: 800, valorNovo: 840 }),
  linha({ contratoId: "d", situacao: "EM_BREVE", aniversario: { ano: 2026, mes: 12 }, percentual: 3, valorAtual: 1500, valorNovo: 1545 }),
];
const $ = (s: string) => caixa.querySelector(s) as HTMLElement | null;
const sp = (t: string) => t.replace(/ /g, " ");
const tr = (id: string) => $(`table [data-linha-reajuste="${id}"]`)!;
const card = (id: string) => $(`li[data-linha-reajuste="${id}"]`)!;
const clicar = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeAll(async () => { await import("@/components/contratos/reajustes-view"); }, 120_000);
beforeEach(() => {
  avisos.lista = []; avisos.perguntas = []; avisos.responder = true; chamadas.length = 0; nav.refresh.mockClear();
  resposta = { status: 200, corpo: { ok: true, texto: "Reajuste de 5% aplicado: R$ 1.000,00 → R$ 1.050,00." } };
  globalThis.fetch = vi.fn(async (u: any, init?: RequestInit) => {
    chamadas.push({ url: String(u), corpo: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }) as any;
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); document.body.innerHTML = ""; });

async function montar(linhas = LINHAS) {
  const { ReajustesView } = await import("@/components/contratos/reajustes-view");
  await act(async () => root.render(createElement(ReajustesView, { linhas })));
}

describe("Reajustes a aplicar", () => {
  it("cards com o aumento por mês; planilha e cartões com aniversário, %, de → para e situação; ⓘ fora de botão", async () => {
    await montar();
    expect(sp($('[data-card="pendentes"]')!.textContent!)).toContain("R$ 140,002 contratos"); // 50 + 90
    expect(sp($('[data-card="adiados"]')!.textContent!)).toContain("R$ 40,001 contrato");
    expect(sp($('[data-card="em-breve"]')!.textContent!)).toContain("R$ 45,001 contrato");
    expect([tr("b").querySelector("[data-aniversario]")!.textContent, tr("b").querySelector("[data-percentual]")!.textContent,
      tr("b").querySelector("[data-valor-atual]")!.textContent, tr("b").querySelector("[data-valor-novo]")!.textContent]).toEqual(["nov/2026", "4,5%", "2.000,00", "2.090,00"]);
    expect(tr("a").querySelector("[data-situacao]")!.textContent).toBe("Para aplicar");
    expect(tr("c").textContent).toContain("Adiado");
    expect(tr("c").textContent).toContain("até 15/12/2026");
    expect(tr("a").querySelector("a")!.getAttribute("href")).toBe("/contratos/a");
    expect(sp(card("b").querySelector("[data-de-para]")!.textContent!)).toBe("R$ 2.000,00 → R$ 2.090,00 · 4,5%");
    // Vem chegando: sem botões
    expect(tr("d").querySelector("button")).toBeNull();
    expect(tr("d").textContent).toContain("Aplica a partir de dez/2026");
    // Adiado: aplica ou dispensa, sem "Adiar" de novo
    expect([!!tr("c").querySelector("[data-aplicar]"), !!tr("c").querySelector("[data-adiar]"), !!tr("c").querySelector("[data-dispensar]")]).toEqual([true, false, true]);
    for (const d of caixa.querySelectorAll('button[aria-label*="Reajustes"], [data-card] button[aria-label]')) expect(d.parentElement!.closest("button, a")).toBeNull();
  });

  it("Aplicar: pergunta com o texto da sugestão e manda o ano e o valor que a pessoa viu; cancelar não chama nada", async () => {
    await montar();
    avisos.responder = false;
    await clicar(tr("a").querySelector("[data-aplicar]")!);
    expect(chamadas).toHaveLength(0);
    avisos.responder = true;
    await clicar(tr("a").querySelector("[data-aplicar]")!);
    expect(sp(avisos.perguntas[1])).toMatch(/^Contrato CT-a faz aniversário em nov\/2026 — aplicar reajuste de 5% \(R\$ 1\.000,00 → R\$ 1\.050,00\)\? O valor novo vale para as cobranças previstas daqui pra frente/);
    expect(chamadas).toEqual([{ url: "/api/contratos/a/reajuste", corpo: { ano: 2026, acao: "APLICAR", valorEsperado: 1000 } }]);
    expect(sp(avisos.lista[0][0])).toBe("Reajuste de 5% aplicado: R$ 1.000,00 → R$ 1.050,00.");
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("Adiar 30 dias; erro da API vira aviso (sem recarregar)", async () => {
    await montar();
    resposta = { status: 409, corpo: { erro: "Este reajuste já foi decidido por outra pessoa. Atualize a tela." } };
    await clicar(tr("b").querySelector("[data-adiar]")!);
    expect(chamadas[0]).toEqual({ url: "/api/contratos/b/reajuste", corpo: { ano: 2026, acao: "ADIAR", dias: 30 } });
    expect(avisos.lista).toEqual([["Este reajuste já foi decidido por outra pessoa. Atualize a tela.", "erro"]]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("Dispensar: modal com motivo; confirma e manda o motivo", async () => {
    await montar();
    resposta = { status: 200, corpo: { ok: true } };
    await clicar(card("a").querySelector("[data-dispensar]")!);
    const modal = document.querySelector("[data-modal-dispensar]")!;
    expect(sp(modal.textContent!)).toContain("O contrato CT-a fica em R$ 1.000,00 até o aniversário de 2027.");
    const campo = document.getElementById("motivo-dispensa") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(campo, "cliente negociou manter");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clicar(document.querySelector("[data-confirmar-dispensa]")!);
    expect(chamadas).toEqual([{ url: "/api/contratos/a/reajuste", corpo: { ano: 2026, acao: "DISPENSAR", motivo: "cliente negociou manter" } }]);
    expect(avisos.lista[0]).toEqual(["Reajuste de 2026 dispensado.", "sucesso"]);
    expect(document.querySelector("[data-modal-dispensar]")).toBeNull();
  });

  it("vazio: explica onde ligar", async () => {
    await montar([]);
    expect($("[data-lista-vazia]")!.textContent).toContain("Ligue “Reajuste anual” no contrato (aba Gestão), com percentual fixo.");
  });
});
