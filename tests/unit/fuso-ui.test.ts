// @vitest-environment happy-dom
/**
 * Fuso de Brasília na TELA, com o "navegador" em NOVA YORK (UTC-4/-5, idioma qualquer):
 *  - o campo de data e hora (InputDataHora) mostra e grava a hora de BRASÍLIA em dd/mm/aaaa hh:mm,
 *    no lugar do datetime-local nativo (mm/dd/yyyy e fuso do aparelho);
 *  - editar uma atividade mostra 14:00 para a visita das 14h de Brasília e manda o instante certo;
 *  - o cartão da atividade mostra a hora de Brasília.
 */
process.env.TZ = "America/New_York";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, { status: number; corpo: unknown }> = {};

beforeAll(async () => {
  await Promise.all([import("@/components/ui/input-data-hora"), import("@/components/os/os-atividades"), import("@/components/providers/permissoes-provider")]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    const k = Object.keys(respostas).find((x) => x === `${metodo} ${url}`);
    const r = k ? respostas[k] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
async function montar(el: any) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };

describe("InputDataHora (navegador em Nova York)", () => {
  it("o 'navegador' está mesmo em Nova York", () => {
    expect(new Date("2026-10-30T17:00:00Z").getHours()).toBe(13);
  });

  it("digitar 30/10/2026 14:30 grava o instante das 14h30 de BRASÍLIA (17h30 UTC); hora padrão 08:00", async () => {
    const emitidos: string[] = [];
    const { InputDataHora } = await import("@/components/ui/input-data-hora");
    function Caso() {
      const [v, setV] = useState("");
      return createElement(InputDataHora, { value: v, onChange: (iso: string) => { emitidos.push(iso); setV(iso); }, "aria-label": "Agendar para" });
    }
    await montar(createElement(Caso));
    const dia = $<HTMLInputElement>("input[aria-label='Agendar para — data']")!;
    const hora = $<HTMLInputElement>("input[aria-label='Agendar para — hora']")!;
    expect(dia.placeholder).toBe("dd/mm/aaaa");
    expect(hora.placeholder).toBe("hh:mm");
    await digitar(dia, "30102026");
    expect(dia.value).toBe("30/10/2026");
    expect(hora.value).toBe("08:00");
    expect(emitidos.at(-1)).toBe("2026-10-30T11:00:00.000Z");
    await digitar(hora, "1430");
    expect(hora.value).toBe("14:30");
    expect(emitidos.at(-1)).toBe("2026-10-30T17:30:00.000Z");
    // hora impossível: marca e não grava nada novo
    const antes = emitidos.length;
    await digitar(hora, "2560");
    expect(hora.getAttribute("aria-invalid")).toBe("true");
    expect(emitidos.length).toBe(antes);
    // apagar a data limpa o valor
    await digitar(dia, "");
    expect(emitidos.at(-1)).toBe("");
  });

  it("valor vindo de fora mostra a hora de Brasília (não a do aparelho)", async () => {
    const { InputDataHora } = await import("@/components/ui/input-data-hora");
    await montar(createElement(InputDataHora, { value: "2026-10-31T01:15:00.000Z", onChange: () => {}, "aria-label": "Quando" }));
    expect($<HTMLInputElement>("input[aria-label='Quando — data']")!.value).toBe("30/10/2026"); // 22h15 de 30/10 em Brasília
    expect($<HTMLInputElement>("input[aria-label='Quando — hora']")!.value).toBe("22:15");
  });
});

describe("atividade da OS (navegador em Nova York)", () => {
  const atividade = {
    id: "a1", titulo: "Preventiva", status: "AGENDADA", dataAgendada: "2026-10-30T17:00:00.000Z", prazo: null, duracaoMin: 60, observacao: null, resumo: null,
    tipoOs: null, tipoOsId: null, tecnicoId: "t1", tecnico: { id: "t1", nome: "João" }, equipe: null, tecnicosEquipe: [{ tecnico: { id: "t1", nome: "João" } }], veiculo: null, equipamentos: [],
  };

  it("o cartão mostra 14:00 (Brasília) e a edição manda o instante certo", async () => {
    respostas["PUT /api/ordens/os1/atividades/a1"] = { status: 200, corpo: { dataAgendada: "2026-10-30T18:00:00.000Z" } };
    const { OsAtividades } = await import("@/components/os/os-atividades");
    await montar(createElement(OsAtividades, { osId: "os1", atividades: [atividade] }));
    expect(caixa.textContent).toContain("30/10/2026 às 14:00");
    const cab = [...caixa.querySelectorAll("button")].find((b) => b.textContent?.includes("Preventiva"));
    await clicar(cab);
    await clicar($("button[title='Editar atividade']"));
    expect($<HTMLInputElement>("input[aria-label='Data/hora agendada — data']")!.value).toBe("30/10/2026");
    const hora = $<HTMLInputElement>("input[aria-label='Data/hora agendada — hora']")!;
    expect(hora.value).toBe("14:00");
    await digitar(hora, "1500");
    await clicar([...caixa.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Salvar"));
    const put = chamadas.find((c) => c.metodo === "PUT");
    expect(put?.corpo.dataAgendada).toBe("2026-10-30T18:00:00.000Z"); // 15h de Brasília
  });
});
