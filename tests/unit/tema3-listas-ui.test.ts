// @vitest-environment happy-dom
/**
 * Tema 3 — seletores de equipe e de veículo escondem inativos; busca na lista de veículos.
 * A maior parte já existia (ver docs/tema3-listas.md): aqui fica a prova de cada seletor e as três
 * pontas fechadas — equipe inativada não some calada do seletor, "em manutenção" não é "inativo",
 * e a lista de veículos da equipe ganhou pesquisa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextRequest } from "next/server";
import { permissoesTotais } from "@/lib/permissoes";
import { sufixoStatusVeiculo, sugerirVeiculo } from "@/lib/veiculo-sugestao";
import { BUSCA_VEICULOS_A_PARTIR, filtrarVeiculos } from "@/components/forms/equipe-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => "/equipes", useSearchParams: () => new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }));

/* ───────── servidor: as listas que alimentam os seletores ───────── */
const consultas = vi.hoisted(() => ({ equipe: [] as any[], veiculo: [] as any[] }));
vi.mock("@/lib/permissoes-server", () => ({
  exigirAlgumaPermissao: async () => ({ erro: false, session: { user: { empresaId: "e1", id: "u1" } } }),
  exigirPermissao: async () => ({ erro: false, session: { user: { empresaId: "e1", id: "u1" } } }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    equipe: { findMany: async (q: any) => { consultas.equipe.push(q); return []; } },
    veiculo: { findMany: async (q: any) => { consultas.veiculo.push(q); return []; } },
  },
}));

describe("servidor: de onde vêm as opções", () => {
  beforeEach(() => { consultas.equipe = []; consultas.veiculo = []; });

  it("equipes do seletor da OS (?resumo=1): só ATIVAS, só da empresa, com integrantes ativos", async () => {
    const { GET } = await import("@/app/api/equipes/route");
    await GET(new NextRequest("http://localhost/api/equipes?resumo=1"));
    expect(consultas.equipe[0].where).toEqual({ empresaId: "e1", status: "ATIVA" });
    expect(consultas.equipe[0].select.membros.where).toEqual({ ativo: true });
  });

  it("veículos do seletor (?resumo=1) vêm com o status — quem escolhe filtra os ativos e mantém o já escolhido", async () => {
    const { GET } = await import("@/app/api/veiculos/route");
    await GET(new NextRequest("http://localhost/api/veiculos?resumo=1"));
    expect(consultas.veiculo[0].where).toEqual({ empresaId: "e1" });
    expect(consultas.veiculo[0].select.status).toBe(true);
  });
});

/* ───────── regras puras ───────── */
describe("regras puras", () => {
  it("rótulo do veículo que não está ativo: 'em manutenção' não é 'inativo' (antes os dois saíam como inativo)", () => {
    expect([sufixoStatusVeiculo("ATIVO"), sufixoStatusVeiculo("MANUTENCAO"), sufixoStatusVeiculo("INATIVO"), sufixoStatusVeiculo(null), sufixoStatusVeiculo(undefined)])
      .toEqual(["", " (em manutenção)", " (inativo)", "", ""]);
  });

  it("sugestão automática de veículo nunca propõe inativo nem em manutenção", () => {
    const frota = [
      { id: "v1", placa: "AAA1A11", modelo: "Fiorino", marca: "Fiat", status: "INATIVO", equipeId: "eq1" },
      { id: "v2", placa: "BBB2B22", modelo: "Saveiro", marca: "VW", status: "MANUTENCAO", equipeId: "eq1" },
    ] as any;
    expect(sugerirVeiculo({ responsavelId: "t1", equipeId: "eq1" }, frota, () => null).veiculoId).toBeNull();
    expect(sugerirVeiculo({ responsavelId: "t1", equipeId: "eq1" }, [...frota, { id: "v3", placa: "CCC3C33", modelo: "Strada", marca: "Fiat", status: "ATIVO", equipeId: "eq1" }], () => null).veiculoId).toBe("v3");
  });

  it("busca de veículos: por placa (com ou sem hífen) ou modelo, sem ligar para maiúsculas e acentos", () => {
    const v = [{ placa: "ABC-1D23", modelo: "Fiorino" }, { placa: "XYZ9K88", modelo: "Saveiro Robust" }, { placa: "QWE4R56", modelo: "Caminhão Baú" }];
    expect(filtrarVeiculos(v, "")).toEqual(v);
    expect(filtrarVeiculos(v, "  ")).toEqual(v);
    expect(filtrarVeiculos(v, "abc1d").map((x) => x.placa)).toEqual(["ABC-1D23"]);
    expect(filtrarVeiculos(v, "ABC-1").map((x) => x.placa)).toEqual(["ABC-1D23"]);
    expect(filtrarVeiculos(v, "saveiro").map((x) => x.placa)).toEqual(["XYZ9K88"]);
    expect(filtrarVeiculos(v, "caminhao bau").map((x) => x.placa)).toEqual(["QWE4R56"]);
    expect(filtrarVeiculos(v, "kombi")).toEqual([]);
  });
});

/* ───────── telas ───────── */
let root: Root; let caixa: HTMLDivElement;
let respostas: Record<string, unknown>;
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });
beforeEach(() => {
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const chave = Object.keys(respostas).find((k) => String(url).startsWith(k));
    return new Response(JSON.stringify(chave ? respostas[chave] : []), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
const $ = <T extends Element = HTMLElement>(s: string) => caixa.querySelector(s) as T | null;
const $$ = (s: string) => [...caixa.querySelectorAll(s)] as HTMLElement[];
const esperar = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 4)); }); };
const digitar = async (el: Element | null, v: string) => {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar(2);
};
async function montar(el: any) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}

describe("seletor de quem executa a OS (equipe + veículo)", () => {
  const TECNICOS = [{ id: "t1", nome: "João", competencias: [] }];
  const EQUIPES = [{ id: "eqA", nome: "Equipe Alfa", cor: "#0EA5E9", liderId: "t1", membroIds: ["t1"] }];
  const VEICULOS = [
    { id: "v1", placa: "AAA1A11", modelo: "Fiorino", marca: "Fiat", status: "ATIVO", equipeId: null },
    { id: "v2", placa: "BBB2B22", modelo: "Saveiro", marca: "VW", status: "INATIVO", equipeId: null },
    { id: "v3", placa: "CCC3C33", modelo: "Strada", marca: "Fiat", status: "MANUTENCAO", equipeId: null },
  ];
  async function montarSeletor(valor: any) {
    respostas["/api/tecnicos"] = TECNICOS; respostas["/api/equipes"] = EQUIPES; respostas["/api/veiculos"] = VEICULOS;
    const { SeletorExecucao, useOpcoesExecucao } = await import("@/components/os/seletor-execucao");
    function Tela() { const opcoes = useOpcoesExecucao(); return createElement(SeletorExecucao, { opcoes, tipoOsId: "", valor, onChange() {} } as any); }
    await montar(createElement(Tela));
  }
  const opcoesVeiculo = () => $$("[data-seletor-veiculo] option").map((o) => o.textContent);

  it("veículo: só os ATIVOS aparecem para escolher (inativo e em manutenção ficam de fora)", async () => {
    await montarSeletor({ tecnicoIds: ["t1"], responsavelId: "t1", equipeId: null, veiculoId: null });
    expect(opcoesVeiculo()).toEqual(["Sem veículo", "AAA1A11 — Fiat Fiorino"]);
  });

  it("veículo já escolhido que saiu de uso continua na lista, com o motivo certo — 'em manutenção' ou 'inativo'", async () => {
    await montarSeletor({ tecnicoIds: ["t1"], responsavelId: "t1", equipeId: null, veiculoId: "v3" });
    expect(opcoesVeiculo()).toEqual(["Sem veículo", "AAA1A11 — Fiat Fiorino", "CCC3C33 — Fiat Strada (em manutenção)"]);
    act(() => root.unmount()); caixa.remove();
    await montarSeletor({ tecnicoIds: ["t1"], responsavelId: "t1", equipeId: null, veiculoId: "v2" });
    expect(opcoesVeiculo()).toEqual(["Sem veículo", "AAA1A11 — Fiat Fiorino", "BBB2B22 — VW Saveiro (inativo)"]);
  });

  it("equipe ativa escolhida aparece normal; a lista só tem as ativas", async () => {
    await montarSeletor({ tecnicoIds: ["t1"], responsavelId: "t1", equipeId: "eqA", veiculoId: null });
    expect($("[data-equipe-escolhida]")!.textContent).toContain("Equipe Alfa");
    expect($("[data-equipe-inativada]")).toBeNull();
  });

  it("equipe da atividade foi INATIVADA depois: o seletor avisa (antes parecia que não havia equipe) e ela não volta como opção", async () => {
    await montarSeletor({ tecnicoIds: ["t1"], responsavelId: "t1", equipeId: "eqInativa", veiculoId: null });
    expect($("[data-equipe-inativada]")!.textContent).toBe("Equipe inativada (mantida nesta atividade)");
    expect($("[data-equipe-escolhida]")).toBeNull();
    await act(async () => { ($("[data-seletor-equipe] button") as HTMLButtonElement).click(); });
    await esperar(2);
    const opcoes = $$("[data-seletor-equipe] [role=option]").map((o) => o.textContent ?? "");
    expect(opcoes.some((o) => o.includes("Equipe Alfa"))).toBe(true);
    expect(opcoes.length).toBe(2); // "sem equipe" + a única ativa
  });

  it("sem nenhuma equipe ativa cadastrada, a equipe inativada da atividade ainda é avisada", async () => {
    respostas["/api/tecnicos"] = TECNICOS; respostas["/api/equipes"] = []; respostas["/api/veiculos"] = VEICULOS;
    const { SeletorExecucao, useOpcoesExecucao } = await import("@/components/os/seletor-execucao");
    function Tela() { const opcoes = useOpcoesExecucao(); return createElement(SeletorExecucao, { opcoes, tipoOsId: "", valor: { tecnicoIds: ["t1"], responsavelId: "t1", equipeId: "eqInativa", veiculoId: null }, onChange() {} } as any); }
    await montar(createElement(Tela));
    expect($("[data-equipe-inativada]")).not.toBeNull();
  });
});

describe("cadastro da equipe › veículos da equipe", () => {
  const frota = (n: number, extra: any[] = []) => [
    ...Array.from({ length: n }, (_, i) => ({ id: `v${i + 1}`, placa: `AAA${i + 1}A${String(i).padStart(2, "0")}`, modelo: i % 2 ? "Saveiro" : "Fiorino", status: "ATIVO", equipe: null })),
    ...extra,
  ];
  const placas = () => $$("[data-veiculos-equipe] label").map((l) => l.textContent ?? "");
  async function montarForm(veiculos: any[], initialData?: any) {
    respostas["/api/tecnicos"] = []; respostas["/api/veiculos"] = veiculos;
    const { EquipeForm } = await import("@/components/forms/equipe-form");
    await montar(createElement(EquipeForm, { initialData }));
  }

  it("veículo INATIVO não aparece para vincular; o que já era da equipe continua, marcado como inativo; em manutenção aparece", async () => {
    await montarForm(frota(2, [
      { id: "vInativo", placa: "ZZZ0Z00", modelo: "Kombi", status: "INATIVO", equipe: null },
      { id: "vDaEquipe", placa: "YYY9Y99", modelo: "Strada", status: "INATIVO", equipe: { id: "eq1", nome: "Alfa" } },
      { id: "vOficina", placa: "XXX8X88", modelo: "Doblò", status: "MANUTENCAO", equipe: null },
    ]), { id: "eq1", nome: "Alfa", status: "ATIVA", veiculos: [{ id: "vDaEquipe" }], membros: [] });
    const lista = placas().join(" | ");
    expect(lista).not.toContain("ZZZ0Z00");
    expect(lista).toContain("YYY9Y99 — Strada (inativo)");
    expect(lista).toContain("XXX8X88");
  });

  it(`frota pequena (até ${BUSCA_VEICULOS_A_PARTIR}) não ganha campo de pesquisa — sem poluir`, async () => {
    await montarForm(frota(BUSCA_VEICULOS_A_PARTIR));
    expect(placas().length).toBe(BUSCA_VEICULOS_A_PARTIR);
    expect($("[data-busca-veiculos-equipe]")).toBeNull();
  });

  it("frota grande: pesquisa por placa ou modelo filtra a lista; os marcados seguem contados; sem resultado diz o que procurou", async () => {
    await montarForm(frota(9), { id: "eq1", nome: "Alfa", status: "ATIVA", veiculos: [{ id: "v2" }, { id: "v5" }], membros: [] });
    expect(placas().length).toBe(9);
    expect($("[data-veiculos-marcados]")!.textContent).toBe("2 marcados");
    await digitar($("[data-busca-veiculos-equipe]"), "saveiro");
    expect(placas().length).toBe(4);
    expect(placas().every((p) => p.includes("Saveiro"))).toBe(true);
    expect($("[data-veiculos-marcados]")!.textContent).toBe("2 marcados"); // o filtro não desmarca ninguém
    await digitar($("[data-busca-veiculos-equipe]"), "aaa3a");
    expect(placas().length).toBe(1);
    await digitar($("[data-busca-veiculos-equipe]"), "kombi");
    expect(placas()).toEqual([]);
    expect($("[data-veiculos-sem-resultado]")!.textContent).toBe("Nenhum veículo com “kombi”.");
    await digitar($("[data-busca-veiculos-equipe]"), "");
    expect(placas().length).toBe(9);
    expect($$("[data-veiculos-equipe] input:checked").length).toBe(2);
  });
});
