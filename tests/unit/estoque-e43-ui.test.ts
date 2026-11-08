// @vitest-environment happy-dom
/**
 * Estoque E4.3 — as telas num DOM de verdade, API simulada:
 *  - tela "Devolver material" da OS: o que há a devolver já vem marcado com a quantidade; confirmar manda os ids; a lista
 *    acompanha (devolvido, por quem · quando, "Material prestado contas"); "Desfazer" manda o DELETE; OS cancelada
 *    sinalizada; nada marcado = erro sem POST;
 *  - "Material da OS" (aba Materiais & Compras): devolvido X, por quem, "Material prestado contas", link "Devolver
 *    material" só com a permissão e só com algo a devolver; OS cancelada mostra "liberar reserva".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resumoSeparacao } from "@/lib/estoque/separacao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/estoque/devolucao/os1", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async (_o?: unknown) => true) }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast, confirmar: avisos.confirmar }));

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const OS = { id: "os1", numero: "OS-2026-9264", chamadoNumero: null, status: "CONCLUIDA", descricao: "Instalação de split", previsaoConclusao: null, cliente: "Hospital", unidade: null };
const M = (id: string, produtoId: string, descricao: string, unidade: string, quantidade: number, sep: number, cons: number, extra: Record<string, unknown> = {}): any => {
  const sobra = Math.max(0, sep - cons);
  return {
    id, produtoId, descricao, unidade, quantidade, quantidadeSeparada: sep, quantidadeConsumida: cons, quantidadeDevolvida: 0, consumoInformado: true, estadoSeparacao: "CONSUMIDO",
    osItemId: "i1", item: "Instalação split", kitNome: null, comportamento: "INCLUSO_NO_SERVICO", falta: 0, situacao: "consumido",
    separadoEm: "2026-11-07T12:00:00.000Z", separadoPor: "Zé", consumidoEm: "2026-11-07T15:00:00.000Z", consumidoPor: "Carlos", pendenteDevolucao: sobra, aDevolver: sobra,
    devolvidoEm: null, devolvidoPor: null, saldo: 10, situacaoSaldo: "ok", ...extra,
  };
};
const devolvido = (m: any, por = "Zé do Almoxarifado") => ({ ...m, estadoSeparacao: "DEVOLVIDO", situacao: "devolvido", quantidadeDevolvida: m.aDevolver, pendenteDevolucao: 0, aDevolver: 0, devolvidoEm: "2026-11-08T09:00:00.000Z", devolvidoPor: por });
const INICIAIS = [M("mTubo", "tubo", "Tubo de cobre 1/4", "m", 5, 5, 3), M("mCap", "cap", "Capacitor 35uF", "un", 1, 1, 1), M("mGas", "gas", "Gás R410A", "kg", 2, 2, 1.5)];
let atuais: any[] = INICIAIS;

beforeEach(() => {
  chamadas.length = 0; atuais = INICIAIS; avisos.toast.mockClear(); avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo, corpo });
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/api/ordens/os1/devolucao" && metodo === "POST") {
      atuais = atuais.map((m) => (corpo.materiais.includes(m.id) ? devolvido(m) : m));
      return json({ separacao: { os: OS, materiais: atuais, resumo: resumoSeparacao(atuais) }, avisos: [], movimentos: corpo.materiais.length });
    }
    if (url === "/api/ordens/os1/devolucao" && metodo === "DELETE") {
      atuais = atuais.map((m) => (m.id === corpo.id ? { ...m, estadoSeparacao: "CONSUMIDO", situacao: "consumido", pendenteDevolucao: m.quantidadeDevolvida, aDevolver: m.quantidadeDevolvida, quantidadeDevolvida: 0, devolvidoEm: null, devolvidoPor: null } : m));
      return json({ separacao: { os: OS, materiais: atuais, resumo: resumoSeparacao(atuais) }, avisos: [], movimentos: 1 });
    }
    return json({ erro: `não mapeado: ${url}` }, 404);
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const txt = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function montar(el: ReactElement) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}
const remontar = async (el: ReactElement) => { await act(async () => { root.unmount(); }); caixa.remove(); await montar(el); };
// Cartões (celular) e lista (desktop) estão os dois no DOM: os seletores miram a lista
const linha = (id: string) => $(`[data-lista-devolucao] [data-material-dev="${id}"]`)!;
const posts = () => chamadas.filter((c) => c.metodo === "POST").map((c) => c.corpo);

describe("E4.3 — tela de devolução da OS", () => {
  it("o que há a devolver vem marcado com a quantidade; confirmar manda os ids; a lista acompanha (devolvido, por quem, prestado contas); Desfazer manda o DELETE", async () => {
    const { DevolucaoOs } = await import("@/components/estoque/devolucao-os");
    await montar(createElement(DevolucaoOs, { inicial: { os: OS, materiais: INICIAIS, resumo: resumoSeparacao(INICIAIS) } as any }));
    expect($("[data-devolucao-os]")!.getAttribute("data-a-devolver-total")).toBe("2");
    expect(txt($("[data-resumo-devolucao]"))).toBe("2 sobras a devolver");
    expect($$("[data-lista-devolucao] [data-material-dev]").map((l) => [l.getAttribute("data-a-devolver"), txt(l.querySelector("[data-qtd-devolver]")), (l.querySelector("[data-marcar]") as HTMLInputElement | null)?.checked ?? null]))
      .toEqual([["2", "Devolver 2 m", true], [null, "", null], ["0.5", "Devolver 0,5 kg", true]]);
    // Desmarca o gás: só o tubo vai
    await clicar(linha("mGas").querySelector("[data-marcar]"));
    await clicar($('[data-acao="confirmar-devolucao"]'));
    expect(posts()).toEqual([{ materiais: ["mTubo"] }]);
    expect(avisos.toast).toHaveBeenCalledWith("1 material devolvido ao estoque", "sucesso");
    expect(linha("mTubo").getAttribute("data-situacao-material")).toBe("devolvido");
    expect(txt(linha("mTubo").querySelector("[data-devolvido]"))).toBe("Devolvido 2 m");
    expect(txt(linha("mTubo").querySelector("[data-devolvido-por]"))).toMatch(/^por Zé do Almoxarifado · /);
    expect(linha("mTubo").querySelector('[data-acao="desfazer-devolucao"]')).toBeTruthy();
    expect(txt($("[data-resumo-devolucao]"))).toBe("1 sobra a devolver");
    expect($("[data-prestado]")).toBeNull();
    // O gás continua marcado para a próxima; devolve e fica tudo prestado contas
    expect((linha("mGas").querySelector("[data-marcar]") as HTMLInputElement).checked).toBe(true);
    await clicar($('[data-acao="confirmar-devolucao"]'));
    expect(posts().at(-1)).toEqual({ materiais: ["mGas"] });
    expect(txt($("[data-prestado]"))).toBe("Material prestado contas");
    expect($('[data-acao="confirmar-devolucao"]')).toBeNull();
    expect(txt(document.body)).toContain("Nada a devolver nesta OS.");
    // Desfazer o tubo: confirma (perigo) e manda o DELETE; volta a consumido com a sobra pendente
    await clicar(linha("mTubo").querySelector('[data-acao="desfazer-devolucao"]'));
    expect(avisos.confirmar.mock.calls.at(-1)![0]).toMatchObject({ titulo: "Desfazer devolução", perigo: true });
    expect(chamadas.at(-1)).toMatchObject({ metodo: "DELETE", url: "/api/ordens/os1/devolucao", corpo: { id: "mTubo" } });
    expect(linha("mTubo").getAttribute("data-situacao-material")).toBe("consumido");
    expect(linha("mTubo").getAttribute("data-a-devolver")).toBe("2");
    expect($("[data-prestado]")).toBeNull();
  });

  it("nada marcado = erro sem POST; OS cancelada sinalizada com o reservado a devolver", async () => {
    const { DevolucaoOs } = await import("@/components/estoque/devolucao-os");
    await montar(createElement(DevolucaoOs, { inicial: { os: OS, materiais: INICIAIS, resumo: resumoSeparacao(INICIAIS) } as any }));
    await clicar(linha("mTubo").querySelector("[data-marcar]"));
    await clicar(linha("mGas").querySelector("[data-marcar]"));
    await clicar($('[data-acao="confirmar-devolucao"]'));
    expect(posts()).toEqual([]);
    expect(txt($("[role='alert']"))).toBe("Marque ao menos um material para devolver.");
    const reservado = [M("mFita", "fita", "Fita", "un", 3, 3, 0, { estadoSeparacao: "SEPARADO", situacao: "separado", consumoInformado: false, consumidoEm: null, consumidoPor: null, pendenteDevolucao: 0, aDevolver: 3 })];
    const osCancelada = { ...OS, status: "CANCELADA" };
    await remontar(createElement(DevolucaoOs, { inicial: { os: osCancelada, materiais: reservado, resumo: resumoSeparacao(reservado, true) } as any }));
    expect(txt($("[data-os-cancelada]"))).toBe("OS cancelada · liberar reserva");
    expect($("[data-resumo-devolucao]")).toBeNull();
    expect(txt(linha("mFita").querySelector("[data-qtd-devolver]"))).toBe("Devolver 3 un");
    expect((linha("mFita").querySelector("[data-marcar]") as HTMLInputElement).checked).toBe(true);
  });
});

describe("E4.3 — 'Material da OS' na central", () => {
  const ITENS = [{ id: "i1", descricao: "Instalação split", materiais: [
    { id: "mTubo", produtoId: "tubo", descricao: "Tubo de cobre 1/4", unidade: "m", quantidade: "5", quantidadeSeparada: "5", quantidadeConsumida: "3", quantidadeDevolvida: "2", estadoSeparacao: "DEVOLVIDO", separadoEm: "2026-11-07T12:00:00.000Z", separadoPor: { nome: "Zé" }, consumidoEm: "2026-11-07T15:00:00.000Z", consumidoPor: { nome: "Carlos" }, devolvidoEm: "2026-11-08T09:00:00.000Z", devolvidoPor: { nome: "Zé do Almoxarifado" }, kitNome: null },
    { id: "mCap", produtoId: "cap", descricao: "Capacitor 35uF", unidade: "un", quantidade: "1", quantidadeSeparada: "1", quantidadeConsumida: "1", quantidadeDevolvida: "0", estadoSeparacao: "CONSUMIDO", separadoEm: "2026-11-07T12:00:00.000Z", separadoPor: { nome: "Zé" }, consumidoEm: "2026-11-07T15:00:00.000Z", consumidoPor: { nome: "Carlos" }, devolvidoEm: null, devolvidoPor: null, kitNome: null },
  ] }];
  it("devolvido X por quem; 'Material prestado contas'; com sobra: 'sobra a devolver' + link 'Devolver material' só para quem separa; OS cancelada: 'liberar reserva'", async () => {
    const { OsSeparacao, materiaisDaOs } = await import("@/components/os/os-separacao");
    const materiais = materiaisDaOs(ITENS);
    expect(materiais[0]).toMatchObject({ quantidadeDevolvida: 2, consumoInformado: true, devolvidoPor: "Zé do Almoxarifado" });
    await montar(createElement(OsSeparacao, { osId: "os1", materiais, resumo: resumoSeparacao(materiais), podeSeparar: true, podeConsumir: true }));
    expect($("[data-os-separacao]")!.getAttribute("data-prestacao-pendente")).toBeNull();
    expect(txt($("[data-prestado]"))).toBe("Material prestado contas");
    expect($("[data-flag-prestacao]")).toBeNull();
    expect($('[data-acao="ir-devolver"]')).toBeNull();
    const tubo = $('[data-material-estado="mTubo"]')!;
    expect(tubo.getAttribute("data-situacao-material")).toBe("devolvido");
    expect(txt(tubo.querySelector("[data-devolvido]"))).toBe("Devolvido 2 m");
    expect(txt(tubo.querySelector("[data-devolvido-por]"))).toMatch(/^por Zé do Almoxarifado · /);
    expect(tubo.querySelector("[data-sobra]")).toBeNull();
    // Com a sobra ainda pendente: pílula + link para quem separa; sem a permissão, sem link
    const comSobra = materiais.map((m) => (m.id === "mTubo" ? { ...m, estadoSeparacao: "CONSUMIDO" as const, quantidadeDevolvida: 0, devolvidoEm: null, devolvidoPor: null } : m));
    await remontar(createElement(OsSeparacao, { osId: "os1", materiais: comSobra, resumo: resumoSeparacao(comSobra), podeSeparar: true, podeConsumir: true }));
    expect(txt($("[data-pendentes-devolucao]"))).toBe("1 sobra a devolver");
    expect($("[data-prestado]")).toBeNull();
    expect(txt($("[data-flag-prestacao]"))).toBe("Prestação de contas pendente");
    expect($<HTMLAnchorElement>('[data-acao="ir-devolver"]')!.getAttribute("href")).toBe("/estoque/devolucao/os1");
    expect(txt($('[data-material-estado="mTubo"] [data-sobra]'))).toBe("Pend. devolução 2 m");
    await remontar(createElement(OsSeparacao, { osId: "os1", materiais: comSobra, resumo: resumoSeparacao(comSobra), podeSeparar: false, podeConsumir: true }));
    expect($('[data-acao="ir-devolver"]')).toBeNull();
    // OS cancelada com material só reservado: "liberar reserva", sem consumo a informar, sem "Separar material"
    const reservado = [{ ...comSobra[0], estadoSeparacao: "SEPARADO" as const, quantidadeConsumida: 0, consumoInformado: false, consumidoEm: null, consumidoPor: null }];
    await remontar(createElement(OsSeparacao, { osId: "os1", materiais: reservado, resumo: resumoSeparacao(reservado, true), podeSeparar: true, podeConsumir: true, cancelada: true }));
    expect(txt($("[data-pendentes-devolucao]"))).toBe("OS cancelada · liberar reserva");
    expect($("[data-consumo-pendente-pill]")).toBeNull();
    expect($('[data-acao="informar-consumo"]')).toBeNull();
    expect($('[data-acao="ir-separar"]')).toBeNull();
    expect($('[data-acao="ir-devolver"]')).toBeTruthy();
    expect(txt($('[data-material-estado="mTubo"] [data-sobra]'))).toBe("Reservado · devolver 5 m");
  });
});
