// @vitest-environment happy-dom
/**
 * ERRO NO CAMPO — formulário de contrato (contrato-form), num DOM de verdade:
 *  - salvar sem o início da vigência marca o campo de data (aria-invalid + mensagem abaixo) e foca nele;
 *  - salvando de OUTRA aba: a aba "Contrato" ganha o ponto vermelho, abre sozinha e o campo recebe o foco;
 *  - o erro do servidor ({ erro, campos }) cai no campo certo: número repetido → Número do contrato;
 *  - o erro do servidor nos prazos de atendimento ("prazosAtendimento.0.x") abre "Escopo e locais" e mostra a mensagem lá;
 *  - corrigiu, o erro some (sem esperar o próximo salvar).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

const nav = vi.hoisted(() => ({ sp: new URLSearchParams(), push: [] as string[] }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.sp,
  usePathname: () => "/contratos/novo",
  useRouter: () => ({ push: (u: string) => nav.push.push(u), replace: () => {}, refresh: () => {} }),
}));

let rotas: Record<string, { status?: number; corpo: unknown }> = {};
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let root: Root; let caixa: HTMLDivElement;
beforeAll(async () => { await import("@/components/forms/contrato-form"); }, 120_000);
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 40)); }); };
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const visivel = (id: string) => !$(`[data-painel-contrato="${id}"]`)!.hasAttribute("hidden");
const salvar = () => [...caixa.querySelectorAll("button")].filter((b) => txt(b) === "Salvar").at(-1)!;
const mensagemDe = (el: Element) => txt(document.getElementById(el.getAttribute("aria-describedby")!.split(" ").find((id) => id.endsWith("-erro"))!));
async function clicar(el: Element | null) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await flush(); }
async function digitar(el: HTMLInputElement, valor: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await flush();
}
async function montar() {
  const { ContratoForm } = await import("@/components/forms/contrato-form");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(ContratoForm, {}) })); });
  await flush();
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  nav.sp = new URLSearchParams("clienteId=c1");
  chamadas.length = 0;
  rotas = {
    "GET /api/clientes": { corpo: [{ id: "c1", nome: "Hotel Mirante" }] },
    "GET /api/clientes/c1": { corpo: { id: "c1", nome: "Hotel Mirante" } },
    "GET /api/unidades?clienteId=c1": { corpo: [] },
    "GET /api/tecnicos?tipo=RESPONSAVEL_TECNICO": { corpo: [] },
    "GET /api/tipos-os": { corpo: [] },
    "GET /api/tecnicos": { corpo: [] },
  };
  globalThis.fetch = vi.fn(async (u: any, init?: RequestInit) => {
    const metodo = (init?.method ?? "GET").toUpperCase();
    const url = String(u);
    chamadas.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    const r = rotas[`${metodo} ${url}`];
    if (r === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as any;
});
afterEach(async () => { await act(async () => root?.unmount()); caixa?.remove(); });

const inicio = () => $<HTMLInputElement>('[data-campo-nome="dataInicio"] [data-input-data]')!;
const gravou = () => chamadas.some((c) => c.metodo === "POST" && c.url === "/api/contratos");

describe("contrato: erro no campo", () => {
  it("sem o início da vigência: a data fica marcada com a mensagem abaixo e recebe o foco", async () => {
    await montar();
    await clicar(salvar());
    expect(gravou()).toBe(false);
    expect(inicio().getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(inicio())).toBe("Data de início é obrigatória");
    expect(document.activeElement).toBe(inicio());
    expect(txt($('[data-aba-contrato="contrato"] [data-erro-aba]'))).toBe("1 erro");
    // a faixa repete o texto (um erro só) — sem o antigo "Verifique os campos obrigatórios na aba…"
    expect(txt($("[data-resumo-erros]"))).toBe("Data de início é obrigatória");
    expect(caixa.textContent).not.toContain("Verifique os campos obrigatórios");
  });

  it("salvando de outra aba: a aba Contrato abre sozinha e o campo recebe o foco; corrigir tira o erro", async () => {
    await montar();
    await clicar($('[data-aba-contrato="gestao"]'));
    expect(visivel("contrato")).toBe(false);
    await clicar(salvar());
    expect(visivel("contrato")).toBe(true);
    expect(document.activeElement).toBe(inicio());
    await digitar(inicio(), "01/02/2027");
    expect(inicio().getAttribute("aria-invalid")).toBeNull();
    expect($('[data-aba-contrato="contrato"] [data-erro-aba]')).toBeNull();
  });

  it("número repetido (servidor): cai no Número do contrato, com foco", async () => {
    rotas["POST /api/contratos"] = { status: 409, corpo: { erro: "Número de contrato já cadastrado", campos: { numero: "Número de contrato já cadastrado" } } };
    await montar();
    await digitar(inicio(), "01/02/2027");
    await clicar(salvar());
    expect(gravou()).toBe(true);
    const numero = $<HTMLInputElement>("input[name='numero']")!;
    expect(numero.getAttribute("aria-invalid")).toBe("true");
    expect(mensagemDe(numero)).toBe("Número de contrato já cadastrado");
    expect(document.activeElement).toBe(numero);
    await digitar(numero, "CT-77");
    expect(numero.getAttribute("aria-invalid")).toBeNull();
  });

  it("prazo de atendimento recusado (servidor, caminho do zod): abre Escopo e locais e mostra a mensagem lá", async () => {
    rotas["POST /api/contratos"] = { status: 400, corpo: { erro: "Dados inválidos", campos: { "prazosAtendimento.0.horas": "Informe as horas do prazo." } } };
    await montar();
    await digitar(inicio(), "01/02/2027");
    await clicar(salvar());
    expect(visivel("escopo")).toBe(true);
    expect($('[data-campo-nome="prazosAtendimento"]')!.hasAttribute("data-campo-com-erro")).toBe(true);
    expect(txt($('[data-campo-nome="prazosAtendimento"]'))).toContain("Informe as horas do prazo.");
    expect(txt($('[data-aba-contrato="escopo"] [data-erro-aba]'))).toBe("1 erro");
  });
});
