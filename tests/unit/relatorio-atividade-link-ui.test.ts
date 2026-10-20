// @vitest-environment happy-dom
/**
 * Segurança — telas internas montam o link do relatório de atividade JÁ COM O TOKEN (DOM real,
 * happy-dom, API simulada):
 *  - aba Relatórios da OS: "Ver relatório" e "Copiar link" usam o link com o token vindo da API;
 *  - "Novo link" (só com OS › editar): pede confirmação, chama a rota e troca o link na tela;
 *    cancelar não chama nada; erro da API aparece;
 *  - histórico do equipamento: o link "Relatório" é o do servidor (com o token), nunca só o id.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesVazias, type Permissoes } from "@/lib/permissoes";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const T1 = "Ab3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1eF3hJ5kL7nP9r";
const T2 = "Zz8yX6wV4uT2sR0qP8oN6mL4kJ2iH0gF8eD6cB4aZ2x";
const NOVO = "Nn1oO2pP3qQ4rR5sS6tT7uU8vV9wW0xX1yY2zZ3aA4b";
const link = (id: string, t: string) => `/relatorio/atividade/${id}?t=${t}`;

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string }[] = [];

beforeAll(async () => {
  await Promise.all([import("@/components/os/os-relatorios"), import("@/components/equipamentos/equipamento-perfil"), import("@/components/providers/permissoes-provider")]);
}, 120_000);

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  chamadas.length = 0;
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, metodo: String(init.method ?? "GET") });
    const r = Object.entries(respostas).find(([k]) => url.startsWith(k))?.[1] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function montar(el: any) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const $ = (sel: string) => caixa.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const comOrdens = (...acoes: string[]) => { const p = permissoesVazias(); (p as any).ordens = Object.fromEntries(acoes.map((a) => [a, true])); return p; };

const ATIVIDADE = (id: string, titulo: string, t: string) => ({
  id, titulo, status: "CONCLUIDA", criadoEm: "2026-10-20T13:00:00.000Z", duracaoMin: 60, tipoOsNome: null, tipoOsCor: null,
  tecnicoNome: "Bruno", resumo: "", fotos: 0, respostas: 2, linkRelatorio: link(id, t),
});

async function abaRelatorios(permissoes: Permissoes) {
  respostas["/api/ordens/os1/relatorios"] = { status: 200, corpo: {
    relatorios: [],
    resumo: { statusOs: "CONCLUIDA", totalAtividades: 2, totalTecnicos: 1, totalFotos: 0, totalEquipamentos: 1, periodoInicio: null, periodoFim: null,
      atividades: [ATIVIDADE("a1", "Limpeza do split", T1), ATIVIDADE("a2", "Troca de filtro", T2)] },
  } };
  const { OsRelatorios } = await import("@/components/os/os-relatorios");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(OsRelatorios, { osId: "os1" }) }));
}

describe("aba Relatórios da OS", () => {
  it("'Ver relatório' abre o link com o token (nunca só o id)", async () => {
    await abaRelatorios(comOrdens("visualizar"));
    expect($$("[data-ver-relatorio]").map((a) => a.getAttribute("href"))).toEqual([link("a1", T1), link("a2", T2)]);
    expect($$('a[href^="/relatorio/atividade/"]').every((a) => /\?t=[A-Za-z0-9_-]{43}$/.test(a.getAttribute("href")!))).toBe(true);
    expect($$("[data-ver-relatorio]").every((a) => a.getAttribute("rel")?.includes("noreferrer"))).toBe(true);
  });

  it("'Copiar link' copia o endereço completo, com o token", async () => {
    const escrever = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
    await abaRelatorios(comOrdens("visualizar"));
    await clicar($('[data-acoes-relatorio="a2"] [data-copiar-link]'));
    expect(escrever).toHaveBeenCalledWith(`${window.location.origin}${link("a2", T2)}`);
    expect($('[data-acoes-relatorio="a2"] [data-copiar-link]')!.textContent).toContain("Link copiado");
  });

  it("'Novo link' só aparece com OS › editar", async () => {
    await abaRelatorios(comOrdens("visualizar", "concluir"));
    expect($("[data-novo-link]")).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await abaRelatorios(comOrdens("visualizar", "editar"));
    expect($$("[data-novo-link]")).toHaveLength(2);
  });

  it("'Novo link': confirma, chama a rota da atividade e troca o link na tela (o antigo some)", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    await abaRelatorios(comOrdens("visualizar", "editar"));
    respostas["/api/ordens/os1/atividades/a1/link-relatorio"] = { status: 200, corpo: { link: link("a1", NOVO) } };
    await clicar($('[data-acoes-relatorio="a1"] [data-novo-link]'));
    expect(confirmar.mock.calls[0][0]).toMatch(/O link atual para de abrir/);
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([{ url: "/api/ordens/os1/atividades/a1/link-relatorio", metodo: "POST" }]);
    expect($('[data-acoes-relatorio="a1"] [data-ver-relatorio]')!.getAttribute("href")).toBe(link("a1", NOVO));
    expect($('[data-acoes-relatorio="a2"] [data-ver-relatorio]')!.getAttribute("href")).toBe(link("a2", T2)); // a outra não muda
    expect($('[data-acoes-relatorio="a1"] [role="status"]')!.textContent).toBe("Novo link gerado. O anterior não abre mais.");
    expect(caixa.innerHTML).not.toContain(T1);
  });

  it("'Novo link' cancelado não chama nada; erro da API aparece e o link fica o mesmo", async () => {
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    await abaRelatorios(comOrdens("visualizar", "editar"));
    await clicar($('[data-acoes-relatorio="a1"] [data-novo-link]'));
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);
    confirmar.mockReturnValue(true);
    respostas["/api/ordens/os1/atividades/a1/link-relatorio"] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await clicar($('[data-acoes-relatorio="a1"] [data-novo-link]'));
    expect($('[data-acoes-relatorio="a1"] [role="status"]')!.textContent).toBe("Sem permissão para esta ação");
    expect($('[data-acoes-relatorio="a1"] [data-ver-relatorio]')!.getAttribute("href")).toBe(link("a1", T1));
  });
});

describe("histórico do equipamento", () => {
  it("o link 'Relatório' é o do servidor, com o token", async () => {
    const { EquipamentoPerfil } = await import("@/components/equipamentos/equipamento-perfil");
    const evento = (chave: string, status: string, linkRelatorio: string | null) => ({
      chave, data: "2026-10-20T13:00:00.000Z", titulo: "Limpeza", tipoServico: null, tecnico: "Bruno", status, origemStatus: "ATIVIDADE" as const,
      equipamentoFeito: true, resumo: null, os: { id: "os1", numero: "OS-1", status: "CONCLUIDA" }, atividadeId: chave.slice(3), linkRelatorio, formularios: [],
    });
    await montar(createElement(EquipamentoPerfil, {
      equipamento: { id: "eq1", nome: null, marca: "Daikin", modelo: "FTX", ativo: true, unidade: { id: "un1", nome: "Loja 12", cliente: { id: "c1", nome: "Shopping Norte", nomeFantasia: null } }, qrcode: null, tipoEquipamento: null },
      tipoNome: "Split", historico: [], abaInicial: "atendimentos",
      indicadores: { ultimoAtendimento: null, proxima: null, totalAtendimentos: 1 },
      linhaDoTempo: [evento("at-a1", "CONCLUIDA", link("a1", T1)), evento("at-a2", "AGENDADA", link("a2", T2))],
    } as any));
    expect($$("[data-link-relatorio]").map((a) => a.getAttribute("href"))).toEqual([link("a1", T1)]); // só a concluída
  });
});
