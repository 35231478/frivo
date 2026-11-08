// @vitest-environment happy-dom
/**
 * Estoque E4.1 — as telas num DOM de verdade, API simulada:
 *  - tela de separação da OS: necessário / separado / disponível, "separar agora" já vem com o que falta, saldo que não
 *    cobre fica vermelho (aviso, não trava), confirmar manda o ALVO (separado + agora) e atualiza a tela; separar mais
 *    do que falta é barrado na tela; "Desfazer" manda alvo 0;
 *  - estado na OS (aba Materiais & Compras): situação da separação, "Prestação de contas pendente", por quem/quando,
 *    link "Separar material" só para quem tem a permissão; OS sem material.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resumoSeparacao } from "@/lib/estoque/separacao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/estoque/separacao/os1", useSearchParams: () => new URLSearchParams(),
}));
const avisos = vi.hoisted(() => ({ toast: vi.fn(), confirmar: vi.fn(async (_o?: unknown) => true) }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: avisos.toast, confirmar: avisos.confirmar }));

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const M = (id: string, produtoId: string, descricao: string, unidade: string, quantidade: number, quantidadeSeparada: number, saldo: number | null, extra: Record<string, unknown> = {}): any => {
  const estadoSeparacao = quantidadeSeparada > 0 ? "SEPARADO" : null;
  const falta = produtoId ? Math.max(0, quantidade - quantidadeSeparada) : 0;
  const situacao = !produtoId ? "sem-produto" : quantidadeSeparada <= 0 ? "pendente" : quantidadeSeparada < quantidade ? "parcial" : "separado";
  return { id, produtoId: produtoId || null, descricao, unidade, quantidade, quantidadeSeparada, estadoSeparacao, osItemId: "i1", item: "Instalação split", kitNome: null, comportamento: "INCLUSO_NO_SERVICO", falta, situacao, separadoEm: quantidadeSeparada > 0 ? "2026-11-07T12:00:00.000Z" : null, separadoPor: quantidadeSeparada > 0 ? "Zé do Almoxarifado" : null, saldo, situacaoSaldo: saldo == null ? null : saldo < 0 ? "negativo" : "ok", ...extra };
};
const OS = { id: "os1", numero: "OS-2026-9264", chamadoNumero: null, status: "ABERTA", descricao: "Instalação de split", previsaoConclusao: "2026-12-01T12:00:00.000Z", cliente: "Hospital", unidade: null };
const resumoDe = (ms: any[]) => resumoSeparacao(ms);
const INICIAL: any = { os: OS, materiais: [M("mTubo", "tubo", "Tubo de cobre 1/4", "m", 5, 0, 10), M("mCap", "cap", "Capacitor 35uF", "un", 1, 0, 0), M("mFiltro", "filtro", "Filtro secador", "un", 2, 1, 3)], resumo: null as any };
INICIAL.resumo = resumoDe(INICIAL.materiais);

beforeEach(() => {
  chamadas.length = 0; avisos.toast.mockClear(); avisos.confirmar.mockClear(); avisos.confirmar.mockImplementation(async () => true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo, corpo });
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/api/ordens/os1/separacao" && metodo === "POST") {
      // O servidor "aplica" os alvos e devolve a tela nova
      const alvo = new Map<string, number>(corpo.materiais.map((m: any) => [m.id, m.quantidade]));
      const materiais = (INICIAL.materiais as any[]).map((m) => alvo.has(m.id) ? M(m.id, m.produtoId!, m.descricao, m.unidade, m.quantidade, alvo.get(m.id)!, m.saldo! - (alvo.get(m.id)! - m.quantidadeSeparada)) : m);
      const avisosServidor = materiais.filter((m: any) => m.saldo < 0 && alvo.has(m.id)).map((m: any) => `${m.descricao}: Atenção: o saldo ficou negativo (${m.saldo} ${m.unidade}).`);
      return json({ separacao: { os: OS, materiais, resumo: resumoDe(materiais) }, avisos: avisosServidor, movimentos: alvo.size });
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
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function montar(el: React.ReactElement) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}
// A tabela (desktop) e os cartões (celular) estão os dois no DOM: os seletores miram a tabela
const linha = (id: string) => $(`[data-tabela-separacao] [data-material-sep="${id}"]`)!;
const alvo = (id: string) => linha(id).querySelector<HTMLInputElement>("[data-alvo]");
const posts = () => chamadas.filter((c) => c.metodo === "POST").map((c) => c.corpo);

describe("E4.1 — tela de separação da OS", () => {
  it("mostra necessário / separado / disponível; 'separar agora' já vem com o que falta; saldo que não cobre fica vermelho e avisa (sem travar); confirmar manda o alvo e atualiza", async () => {
    const { SeparacaoOs } = await import("@/components/estoque/separacao-os");
    await montar(createElement(SeparacaoOs, { inicial: INICIAL }));
    expect(txt($("[data-resumo-separacao]"))).toBe("Separação parcial · 3 de 3 a separar");
    expect($("[data-separacao-os]")!.getAttribute("data-situacao-separacao")).toBe("parcial");
    expect(txt($("[data-link-os]"))).toBe("OS-2026-9264");
    expect($$("[data-tabela-separacao] [data-material-sep]").map((l) => [l.getAttribute("data-situacao-material"), txt(l.querySelector("[data-necessario]")), txt(l.querySelector("[data-separado]")), txt(l.querySelector("[data-saldo]"))]))
      .toEqual([["pendente", "5 m", "0", "10"], ["pendente", "1 un", "0", "0"], ["parcial", "2 un", "1", "3"]]);
    expect(alvo("mTubo")!.value).toBe("5");
    expect(alvo("mCap")!.value).toBe("1");
    expect(alvo("mFiltro")!.value).toBe("1"); // o que falta (2 − 1)
    // Capacitor: saldo 0 não cobre 1 → vermelho + aviso; não trava
    expect(txt(linha("mCap").querySelector("[data-falta-saldo]"))).toBe("Sem saldo disponível (0 un): faltam 1 un.");
    expect(linha("mCap").querySelector("[data-saldo]")!.className).toContain("text-atrasado");
    expect(linha("mTubo").querySelector("[data-falta-saldo]")).toBeNull();
    // Quem já separou aparece
    expect(txt(linha("mFiltro").querySelector("[data-separado-por]"))).toMatch(/^por Zé do Almoxarifado · /);
    expect(linha("mFiltro").querySelector('[data-acao="desfazer-separacao"]')).toBeTruthy();
    expect(linha("mTubo").querySelector('[data-acao="desfazer-separacao"]')).toBeNull();
    // Tubo: separa só 3 (faltou); digitar com vírgula também vale
    await digitar(alvo("mTubo"), "3");
    expect(txt(linha("mTubo").querySelector("[data-falta-saldo]"))).toBe("");
    await digitar(alvo("mTubo"), "12");
    expect(txt(linha("mTubo").querySelector("[data-falta-saldo]"))).toBe("Saldo disponível (10 m) não cobre: faltam 2 m.");
    await digitar(alvo("mTubo"), "2,5");
    await clicar($('[data-acao="confirmar-separacao"]'));
    // Saldo do capacitor não cobre → confirmação (não trava), e o POST leva o ALVO: tubo 2,5; cap 1; filtro 1+1 = 2
    expect(avisos.confirmar).toHaveBeenCalledTimes(1);
    expect(avisos.confirmar.mock.calls[0][0]).toMatchObject({ titulo: "Saldo não cobre", confirmarTexto: "Separar mesmo assim" });
    expect(posts()).toEqual([{ materiais: [{ id: "mTubo", quantidade: 2.5 }, { id: "mCap", quantidade: 1 }, { id: "mFiltro", quantidade: 2 }] }]);
    // A tela acompanha a resposta: separados, parcial no tubo, aviso do servidor no toast
    expect($$("[data-tabela-separacao] [data-material-sep]").map((l) => [l.getAttribute("data-situacao-material"), txt(l.querySelector("[data-separado]"))])).toEqual([["parcial", "2,5"], ["separado", "1"], ["separado", "2"]]);
    expect(txt($("[data-resumo-separacao]"))).toBe("Separação parcial · 1 de 3 a separar");
    expect(avisos.toast).toHaveBeenCalledWith(expect.stringMatching(/3 materiais separados\. Capacitor 35uF: Atenção: o saldo ficou negativo/), "info");
    expect(alvo("mTubo")!.value).toBe("2,5"); // o que ainda falta
    expect(alvo("mCap")).toBeNull();
  });

  it("não deixa separar mais do que falta (erro na tela, sem POST); 'Desfazer' confirma e manda alvo 0; sem o que separar, o botão some; OS sem material", async () => {
    const { SeparacaoOs } = await import("@/components/estoque/separacao-os");
    await montar(createElement(SeparacaoOs, { inicial: INICIAL }));
    await digitar(alvo("mFiltro"), "3");
    await clicar($('[data-acao="confirmar-separacao"]'));
    expect(posts()).toEqual([]);
    expect(txt($("[role='alert']"))).toBe("Filtro secador: dá para separar no máximo o que falta (1 un).");
    // Em branco em um e 0 no outro: só os que têm quantidade entram
    await digitar(alvo("mFiltro"), "0");
    await digitar(alvo("mCap"), "0");
    await digitar(alvo("mTubo"), "5");
    await clicar($('[data-acao="confirmar-separacao"]'));
    expect(posts()).toEqual([{ materiais: [{ id: "mTubo", quantidade: 5 }] }]);
    expect(avisos.confirmar).not.toHaveBeenCalled(); // saldo 10 cobre 5
    // Desfazer o filtro: confirma (perigo) e manda 0
    avisos.confirmar.mockImplementationOnce(async () => false);
    await clicar(linha("mFiltro").querySelector('[data-acao="desfazer-separacao"]'));
    expect(posts()).toHaveLength(1);
    await clicar(linha("mFiltro").querySelector('[data-acao="desfazer-separacao"]'));
    expect(avisos.confirmar.mock.calls.at(-1)![0]).toMatchObject({ titulo: "Desfazer separação", perigo: true });
    expect(posts().at(-1)).toEqual({ materiais: [{ id: "mFiltro", quantidade: 0 }] });
    expect(linha("mFiltro").getAttribute("data-situacao-material")).toBe("pendente");
    expect(avisos.toast).toHaveBeenLastCalledWith("Separação de Filtro secador desfeita");
    // Tudo separado: o botão some
    const tudo: any = { os: OS, materiais: [M("mTubo", "tubo", "Tubo", "m", 5, 5, 5)], resumo: null as any }; tudo.resumo = resumoDe(tudo.materiais);
    await act(async () => { root.unmount(); });
    await montar(createElement(SeparacaoOs, { inicial: tudo }));
    expect($('[data-acao="confirmar-separacao"]')).toBeNull();
    expect(txt($("[data-resumo-separacao]"))).toBe("Tudo separado");
    expect(txt(document.body)).toContain("Tudo separado para esta OS.");
    // OS sem material
    await act(async () => { root.unmount(); });
    await montar(createElement(SeparacaoOs, { inicial: { os: OS, materiais: [], resumo: resumoDe([]) } as any }));
    expect($("[data-lista-vazia]")).toBeTruthy();
    expect(txt($("[data-resumo-separacao]"))).toBe("Sem material");
  });
});

describe("E4.1 — estado da separação na OS", () => {
  const ITENS = [
    { id: "i1", descricao: "Instalação split", materiais: [
      { id: "mTubo", produtoId: "tubo", descricao: "Tubo de cobre 1/4", unidade: "m", quantidade: "5", quantidadeSeparada: "5", estadoSeparacao: "SEPARADO", separadoEm: "2026-11-07T12:00:00.000Z", separadoPor: { nome: "Zé do Almoxarifado" }, kitNome: "Kit instalação" },
      { id: "mCap", produtoId: "cap", descricao: "Capacitor 35uF", unidade: "un", quantidade: "1", quantidadeSeparada: "0", estadoSeparacao: null, separadoEm: null, separadoPor: null, kitNome: null },
      { id: "mZero", produtoId: "fita", descricao: "Fita (não usada)", unidade: "un", quantidade: "0", quantidadeSeparada: "0", estadoSeparacao: null },
    ] },
    { id: "i2", descricao: "Capacitor 35uF", materiais: [] },
  ];
  it("parcial + prestação de contas pendente; por quem/quando; link 'Separar material' só com a permissão; material 'não usado' não aparece; OS sem material", async () => {
    const { OsSeparacao, materiaisDaOs } = await import("@/components/os/os-separacao");
    const { resumoSeparacao } = await import("@/lib/estoque/separacao");
    const materiais = materiaisDaOs(ITENS);
    expect(materiais.map((m) => [m.id, m.quantidade, m.quantidadeSeparada, m.estadoSeparacao, m.item])).toEqual([["mTubo", 5, 5, "SEPARADO", "Instalação split"], ["mCap", 1, 0, null, "Instalação split"]]);
    const resumo = resumoSeparacao(materiais);
    await montar(createElement(OsSeparacao, { osId: "os1", materiais, resumo, podeSeparar: true }));
    const sec = $("[data-os-separacao]")!;
    expect(sec.getAttribute("data-situacao-separacao")).toBe("parcial");
    expect(sec.getAttribute("data-prestacao-pendente")).toBe("true");
    expect(txt($("[data-resumo-separacao]"))).toBe("Separação parcial · 1 de 2 a separar");
    expect(txt($("[data-flag-prestacao]"))).toBe("Prestação de contas pendente");
    expect($$("[data-material-estado]").map((l) => [l.getAttribute("data-situacao-material"), txt(l.querySelector("[data-separado-de]")), txt(l.querySelector("[data-separado-por]"))]))
      .toEqual([["separado", "Separado 5 de 5 m", expect.stringMatching(/^por Zé do Almoxarifado · /)], ["pendente", "Separado 0 de 1 un", ""]]);
    expect(txt($$("[data-material-estado]")[0])).toContain("Kit Kit instalação");
    const link = $<HTMLAnchorElement>('[data-acao="ir-separar"]')!;
    expect(txt(link)).toBe("Separar material");
    expect(link.getAttribute("href")).toBe("/estoque/separacao/os1");
    // A dica fica fora do link (Princípio 7)
    expect(link.querySelector("button")).toBeNull();
    // Sem a permissão: sem o link; o estado continua visível
    await act(async () => { root.unmount(); });
    await montar(createElement(OsSeparacao, { osId: "os1", materiais, resumo, podeSeparar: false }));
    expect($('[data-acao="ir-separar"]')).toBeNull();
    expect($("[data-flag-prestacao]")).toBeTruthy();
    // Tudo separado: "Ver separação"; nada pendente de prestação quando consumido
    await act(async () => { root.unmount(); });
    const consumidos = materiais.map((m) => ({ ...m, quantidadeSeparada: m.quantidade, quantidadeConsumida: m.quantidade, estadoSeparacao: "CONSUMIDO" as const }));
    await montar(createElement(OsSeparacao, { osId: "os1", materiais: consumidos, resumo: resumoSeparacao(consumidos), podeSeparar: true }));
    expect(txt($("[data-resumo-separacao]"))).toBe("Tudo separado");
    expect($("[data-flag-prestacao]")).toBeNull();
    expect(txt($('[data-acao="ir-separar"]'))).toBe("Ver separação");
    // OS sem material
    await act(async () => { root.unmount(); });
    await montar(createElement(OsSeparacao, { osId: "os1", materiais: [], resumo: resumoSeparacao([]), podeSeparar: true }));
    expect($("[data-sem-materiais]")).toBeTruthy();
    expect($('[data-acao="ir-separar"]')).toBeNull();
  });
});
