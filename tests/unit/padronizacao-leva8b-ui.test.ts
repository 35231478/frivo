// @vitest-environment happy-dom
/**
 * Leva 8B — as ações da medição num DOM de verdade (happy-dom), API simulada.
 *
 *  - quem só VISUALIZA o financeiro vê a página do cliente, e mais nada: nem enviar, nem aprovar,
 *    nem registrar PC/NF/boleto/pagamento, nem cancelar;
 *  - com Financeiro › medições, cada passo do ciclo aparece no seu status;
 *  - toda ação confirma por toast, com a palavra certa (medição ou fatura);
 *  - o erro do servidor fica na tela, sem toast e sem atualizar;
 *  - cancelar pergunta antes e diz o que acontece com as contas a receber.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {} }) }));
const avisos = vi.hoisted(() => ({ lista: [] as [string, string][], confirmar: vi.fn(async (_o?: unknown) => true) }));
vi.mock("@/components/ui/avisos", async (orig) => ({
  ...(await orig<typeof import("@/components/ui/avisos")>()),
  toast: (m: string, t = "sucesso") => { avisos.lista.push([m, t]); },
  confirmar: avisos.confirmar,
}));

let root: Root;
let caixa: HTMLDivElement;
let resposta: { status: number; corpo: unknown };
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeEach(() => {
  chamadas.length = 0; avisos.lista.length = 0;
  avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  nav.refresh.mockClear();
  resposta = { status: 200, corpo: { ok: true } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, metodo: String(init.method ?? "GET"), corpo: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { "Content-Type": "application/json" } });
  }));
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

async function montar(permissoes: Permissoes, props: Record<string, unknown> = {}) {
  const { MedicaoAcoes } = await import("@/components/medicao/medicao-acoes");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  const acoes = createElement(MedicaoAcoes, {
    medicaoId: "m1", numero: "MED-2026-0042", tokenPublico: "tok", status: "AGUARDANDO_APROVACAO", ...props,
  } as any);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: acoes }));
  });
  await act(async () => {});
}

const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)];
const clicar = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); };
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const botoes = () => $$("[data-acoes-medicao] > *").map((e) => txt(e)).filter(Boolean);

const SO_VE = montarPermissoes({ financeiro: ["visualizar", "contasReceber"] });

describe("faturar só para quem pode", () => {
  it("quem só visualiza vê a página do cliente, e mais nada", async () => {
    await montar(SO_VE);
    expect($("[data-pagina-cliente]")).not.toBeNull();
    for (const marca of ["data-enviar-email", "data-aprovar-manual", "data-registrar-pagamento", "data-cancelar-medicao", "data-editar-medicao"]) {
      expect($(`[${marca}]`), marca).toBeNull();
    }
    expect(botoes()).toEqual(["Ver página do cliente"]);
  });

  it("com Financeiro › medições, o passo do status aparece", async () => {
    await montar(permissoesTotais());
    expect($("[data-aprovar-manual]")).not.toBeNull();
    expect($("[data-registrar-pagamento]")).not.toBeNull();
    expect($("[data-cancelar-medicao]")).not.toBeNull();
  });

  it("cada status mostra o seu passo (rascunho, PC, NF, boleto)", async () => {
    for (const [status, marca] of [
      ["RASCUNHO", "data-enviar-email"],
      ["AGUARDANDO_PC", "data-registrar-pc"],
      ["PC_RECEBIDO", "data-registrar-nf"],
      ["NF_EMITIDA", "data-registrar-boleto"],
    ] as const) {
      await montar(permissoesTotais(), { status });
      expect($(`[${marca}]`), status).not.toBeNull();
      act(() => root.unmount()); caixa.remove();
    }
    // e o rascunho não oferece "ver página do cliente" (ainda não há o que mostrar)
    await montar(permissoesTotais(), { status: "RASCUNHO" });
    expect($("[data-pagina-cliente]")).toBeNull();
  });

  it("medição paga ou cancelada não oferece mais ação de dinheiro", async () => {
    for (const status of ["PAGO", "CANCELADA"]) {
      await montar(permissoesTotais(), { status });
      expect($("[data-registrar-pagamento]"), status).toBeNull();
      expect($("[data-cancelar-medicao]"), status).toBeNull();
      act(() => root.unmount()); caixa.remove();
    }
    await montar(permissoesTotais(), { status: "PAGO" });
  });
});

describe("toda ação confirma por toast", () => {
  it("aprovação manual: toast com a palavra do documento", async () => {
    await montar(permissoesTotais());
    await clicar($("[data-aprovar-manual]"));
    expect(chamadas.at(-1)).toMatchObject({ url: "/api/medicoes/m1/acao", metodo: "POST", corpo: { acao: "APROVAR_MANUAL" } });
    expect(avisos.lista).toEqual([["Aprovação registrada: a medição seguiu no ciclo.", "sucesso"]]);
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("na fatura avulsa o toast diz fatura", async () => {
    await montar(permissoesTotais(), { avulsa: true, status: "NF_EMITIDA" });
    await clicar($("[data-registrar-boleto]"));
    const confirmar = [...document.querySelectorAll("button")].find((b) => txt(b).includes("Confirmar boleto"))!;
    await clicar(confirmar);
    expect(avisos.lista.at(-1)).toEqual(["Boleto registrado.", "sucesso"]);
    await montar(permissoesTotais(), { avulsa: true });
    await clicar($("[data-cancelar-medicao]"));
    expect(avisos.lista.at(-1)).toEqual(["Fatura cancelada.", "sucesso"]);
  });

  it("erro do servidor: fica na tela, sem toast e sem atualizar", async () => {
    await montar(permissoesTotais());
    resposta = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar($("[data-aprovar-manual]"));
    expect(txt($("[data-acoes-medicao]")?.parentElement ?? null)).toContain("Sem permissão para esta ação");
    expect(avisos.lista).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});

describe("cancelar pergunta antes", () => {
  it("a confirmação diz o que acontece com as contas a receber", async () => {
    await montar(permissoesTotais());
    await clicar($("[data-cancelar-medicao]"));
    const o = avisos.confirmar.mock.calls[0][0] as { mensagem: string; perigo?: boolean };
    expect(o.mensagem).toContain("MED-2026-0042");
    expect(o.mensagem).toContain("As contas a receber geradas voltam a previsto.");
    expect(o.perigo).toBe(true);
  });

  it("recusar a confirmação não chama o servidor", async () => {
    await montar(permissoesTotais());
    avisos.confirmar.mockImplementation(async () => false);
    await clicar($("[data-cancelar-medicao]"));
    expect(chamadas).toEqual([]);
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});
