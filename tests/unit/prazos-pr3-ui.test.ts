// @vitest-environment happy-dom
/**
 * Prazos da OS — PR 3, as telas num DOM de verdade (happy-dom), API simulada:
 *  - FICHA do colaborador (painel): a seção "Atrasos do mês" lista as atividades concluídas depois do
 *    prazo — "Conta" ou "Justificado" com o motivo —, com o número abrindo a OS (é onde se
 *    justifica); mês sem atraso diz isso; mês fechado antes de a lista existir não mostra a seção;
 *  - APP do técnico: os atrasos DELE, sem link para o painel; sem atraso, a seção não aparece;
 *  - na OS: quem justifica é avisado quando o atraso é de um mês do desempenho JÁ FECHADO (no cartão
 *    e na gaveta); quem não justifica não vê o aviso.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";
import { resumoDosAtrasos, textoDoAtraso } from "@/components/desempenho/atrasos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/desempenho", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ href, children, ...resto }: any) => React.createElement("a", { href, ...resto }, children) };
});

let root: Root; let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;

beforeEach(() => {
  respostas = {};
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-20T15:00:00Z") });
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const r = respostas[`${init?.method ?? "GET"} ${String(entrada)}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { desmontar(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

function desmontar() {
  if (root) act(() => root.unmount());
  caixa?.remove();
  root = undefined as unknown as Root;
}
const $ = <T extends Element = HTMLElement>(s: string) => (document.body.querySelector(s) as T | null);
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const clicar = async (el: Element | null) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function montar(elemento: React.ReactElement) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(elemento); });
  await esperar();
}
const responder = (chave: string, corpo: unknown, status = 200) => { respostas[chave] = { status, corpo }; };

const MES = "2026-11";
const regra = { vigenteDesde: MES, pesoPrazo: 50, pesoRelatorio: 0, pesoAvaliacao: 50, exigirFotoAntesDepois: false, penalidadeRetorno: 5, penalidadeReclamacao: 5, metaMinima: 70, faixas: [{ nome: "Ouro", minimo: 90, valor: 350 }] };
const ATRASOS = [
  { atividadeId: "a1", ordemServicoId: "os7", numeroOs: "OS-107", prazo: "2026-11-06", concluidaEm: "2026-11-09", dias: 3, justificado: "CLIENTE_AUSENTE" },
  { atividadeId: "a2", ordemServicoId: "os8", numeroOs: "CH-77", prazo: "2026-11-10", concluidaEm: "2026-11-11", dias: 1, justificado: null },
  { atividadeId: "a3", ordemServicoId: "os9", numeroOs: "OS-109", prazo: "2026-11-12", concluidaEm: "2026-11-14", dias: 2, justificado: "MOTIVO_DE_OUTRA_VERSAO" },
];
const ficha = (atrasos: unknown, x: Record<string, unknown> = {}) => ({
  competencia: MES, tecnico: { id: "t1", nome: "Ana Dias" }, perfil: { id: "p1", nome: "Preventiva", tipo: "TECNICO" }, regra, participantes: 2,
  linha: {
    tecnicoId: "t1", nome: "Ana Dias", posicao: 1, escore: 75, base: 75, desconto: 0, atingiuMeta: true, faixa: null, bonus: 0,
    composicao: [{ metrica: "prazo", peso: 50, valor: 50, pontos: 25, detalhe: "1 de 2 atividades · 2 atrasos justificados fora da conta" }],
    penalidades: { retornos: 0, reclamacoes: 0, pontosRetorno: 0, pontosReclamacao: 0 }, desempate: { mediaAvaliacao: 5, penalidades: 0, noPrazo: 1 },
    ...(atrasos === undefined ? {} : { atrasos }),
  },
  penalidades: [], premiacoes: [], fechamento: null, premiosGanhos: [], ...x,
});

describe("os textos dos atrasos", () => {
  it("'Prazo dd/mm/aaaa · concluída N dias depois' (singular e plural) e o resumo de quantos contam", () => {
    expect(textoDoAtraso({ prazo: "2026-11-06", concluidaEm: "2026-11-09", dias: 3 })).toBe("Prazo 06/11/2026 · concluída em 09/11/2026 (3 dias depois)");
    expect(textoDoAtraso({ prazo: "2026-12-31", concluidaEm: "2027-01-01", dias: 1 })).toBe("Prazo 31/12/2026 · concluída em 01/01/2027 (1 dia depois)");
    expect(resumoDosAtrasos([{ justificado: null }, { justificado: "CLIMA" }, { justificado: null }])).toBe("2 contam · 1 justificado");
    expect(resumoDosAtrasos([{ justificado: null }])).toBe("1 conta");
    expect(resumoDosAtrasos([{ justificado: "CLIMA" }, { justificado: "OUTRO" }])).toBe("2 justificados");
    expect(resumoDosAtrasos([])).toBe("");
  });
});

describe("Ficha do colaborador: Atrasos do mês", () => {
  async function abrir(atrasos: unknown) {
    responder(`GET /api/desempenho/colaboradores/t1?mes=${MES}`, ficha(atrasos));
    const { FichaDesempenho } = await import("@/components/desempenho/ficha-client");
    await montar(createElement(FichaDesempenho, { tecnicoId: "t1", mesInicial: MES, mesAtual: MES }));
  }

  it("lista cada atraso: o dia, a OS (abre a OS), o prazo e os dias, 'Conta' ou 'Justificado' com o motivo", async () => {
    await abrir(ATRASOS);
    const secao = $("[data-atrasos-ficha]")!;
    expect(texto(secao.querySelector("h2"))).toContain("Atrasos do mês");
    expect(texto($("[data-resumo-atrasos]"))).toBe("1 conta · 2 justificados");
    expect($$("[data-atraso]").map((li) => li.getAttribute("data-atraso"))).toEqual(["justificado", "conta", "justificado"]);
    // O número como ele é (sem "OS OS-107"); no painel, abre a OS
    expect($$("[data-atraso-os]").map((a) => `${a.tagName} ${texto(a)} ${a.getAttribute("href")}`)).toEqual(["A OS-107 /ordens/os7", "A CH-77 /ordens/os8", "A OS-109 /ordens/os9"]);
    expect($$("[data-atraso-texto]").map((t) => texto(t))).toEqual([
      "Prazo 06/11/2026 · concluída em 09/11/2026 (3 dias depois)", "Prazo 10/11/2026 · concluída em 11/11/2026 (1 dia depois)", "Prazo 12/11/2026 · concluída em 14/11/2026 (2 dias depois)",
    ]);
    // O motivo pelo rótulo da lista; um motivo que esta versão não conhece aparece como veio (nunca some)
    expect($$("[data-atraso]").map((li) => texto(li.querySelector("[data-atraso-motivo]")))).toEqual(["Motivo: Cliente ausente", "", "Motivo: MOTIVO_DE_OUTRA_VERSAO"]);
    expect($$("[data-atraso]").map((li) => texto(li.lastElementChild))).toEqual(["Justificado", "Conta", "Justificado"]);
    // A composição já diz quantos ficaram fora da conta
    expect(texto($("[data-tabela-composicao] [data-metrica-detalhe], [data-composicao] [data-metrica-detalhe]"))).toBe("1 de 2 atividades · 2 atrasos justificados fora da conta");
    // A instrução fica no ⓘ do título
    expect($$("[data-dica]").map((d) => d.getAttribute("aria-label")).filter(Boolean)).toContain("Ajuda: Atrasos do mês");
  });

  it("mês sem atraso: a seção diz isso (sem resumo, sem lista)", async () => {
    await abrir([]);
    expect(texto($("[data-atrasos-ficha]"))).toContain("Nenhuma atividade concluída com atraso em 11/2026.");
    expect($("[data-resumo-atrasos]")).toBeNull();
    expect($("[data-lista-atrasos]")).toBeNull();
  });

  it("mês fechado antes de a lista existir (linha sem 'atrasos'): a seção não aparece — e o resto da ficha abre normal", async () => {
    await abrir(undefined);
    expect($("[data-atrasos-ficha]")).toBeNull();
    expect(texto($("[data-ficha-escore]"))).toBe("75,0%");
    expect($("[data-penalidades-ficha]")).not.toBeNull();
  });
});

describe("App do técnico: os atrasos dele", () => {
  async function abrir(atrasos: unknown) {
    responder(`GET /api/tecnico/desempenho?mes=${MES}`, { participa: true, ficha: ficha(atrasos) });
    const { DesempenhoTecnico } = await import("@/components/tecnico/desempenho");
    await montar(createElement(DesempenhoTecnico));
  }

  it("mostra os atrasos do mês com o motivo — sem link para o painel (o técnico não entra lá)", async () => {
    await abrir(ATRASOS.slice(0, 2));
    const secao = $("[data-meus-atrasos]")!;
    expect(texto(secao.querySelector("h2"))).toBe("Atrasos do mês");
    expect(texto(secao)).toContain("O atraso que o escritório justificou fica fora da conta.");
    expect($$("[data-atraso-os]").map((a) => `${a.tagName} ${texto(a)}`)).toEqual(["SPAN OS-107", "SPAN CH-77"]);
    expect(secao.querySelector("a")).toBeNull();
    expect($$("[data-atraso]").map((li) => `${li.getAttribute("data-atraso")}: ${texto(li.querySelector("[data-atraso-motivo]"))}`)).toEqual(["justificado: Motivo: Cliente ausente", "conta: "]);
    expect(texto($('[data-minha-composicao] [data-metrica="prazo"] [data-metrica-detalhe]'))).toBe("1 de 2 atividades · 2 atrasos justificados fora da conta · peso 50%");
  });

  it("sem atraso (ou mês antigo sem a lista): a seção não aparece", async () => {
    await abrir([]);
    expect($("[data-meus-atrasos]")).toBeNull();
    expect($("[data-minha-composicao]")).not.toBeNull();
    desmontar();
    await abrir(undefined);
    expect($("[data-meus-atrasos]")).toBeNull();
    expect($("[data-meu-escore]")).not.toBeNull();
  });
});

describe("Na OS: aviso de mês do desempenho já fechado", () => {
  const GESTOR = montarPermissoes({ ordens: ["visualizar", "editar"], desempenho: ["visualizar", "revisar"] });
  const OPERADOR = montarPermissoes({ ordens: ["visualizar", "criar", "editar", "concluir", "excluir"], desempenho: ["visualizar"] });
  const os = (x: Record<string, unknown> = {}) => ({
    id: "os1", numero: "OS-2026-0301", chamadoNumero: null, status: "CONCLUIDA", prazoExecucao: "2026-10-15T00:00:00.000Z", previsaoConclusao: null,
    dataConclusao: "2026-10-20T15:00:00.000Z", atividades: [], atrasoJustificadoMotivo: null, atrasoJustificadoObs: null, atrasoJustificadoEm: null, atrasoJustificadoPor: null, ...x,
  });
  const JUSTIFICADA = { atrasoJustificadoMotivo: "CLIENTE_AUSENTE", atrasoJustificadoObs: null, atrasoJustificadoEm: "2026-11-17T14:00:00.000Z", atrasoJustificadoPor: { id: "u1", nome: "Gabi Gestora" } };
  const AVISO = "O desempenho de 10/2026 já está fechado: a justificativa não muda o escore desse mês. Para ela valer, reabra o mês em Desempenho › Fechamento.";

  async function abrir(dados: any, permissoes: Permissoes = GESTOR) {
    const [{ AtrasoJustificado }, { PermissoesProvider }, { Avisos }] = await Promise.all([
      import("@/components/os/central/atraso-justificado"), import("@/components/providers/permissoes-provider"), import("@/components/ui/avisos"),
    ]);
    await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: [
      createElement(Avisos, { key: "avisos" }), createElement(AtrasoJustificado, { key: "tela", os: dados, onAtualizado: () => {} }),
    ] }));
  }

  it("antes de justificar: o aviso aparece na gaveta, para o gestor decidir sabendo", async () => {
    await abrir(os({ mesesFechadosDoAtraso: ["2026-10"] }));
    expect($("[data-aviso-mes-fechado]")).toBeNull(); // ainda não abriu a gaveta
    await clicar($("[data-justificar-atraso]"));
    expect(texto($("[data-gaveta-atraso] [data-aviso-mes-fechado]"))).toBe(AVISO);
  });

  it("já justificada: o aviso fica no cartão, junto de Alterar e Desfazer", async () => {
    await abrir(os({ ...JUSTIFICADA, mesesFechadosDoAtraso: ["2026-10"] }));
    expect(texto($('[data-atraso-justificado="sim"] [data-aviso-mes-fechado]'))).toBe(AVISO);
    expect($("[data-alterar-atraso]")).not.toBeNull();
  });

  it("mês aberto (ou a página não mandou nada): nenhum aviso", async () => {
    await abrir(os({ ...JUSTIFICADA, mesesFechadosDoAtraso: [] }));
    expect($("[data-aviso-mes-fechado]")).toBeNull();
    desmontar();
    await abrir(os());
    await clicar($("[data-justificar-atraso]"));
    expect($("[data-gaveta-atraso]")).not.toBeNull();
    expect($("[data-aviso-mes-fechado]")).toBeNull();
  });

  it("quem não justifica lê a justificativa, mas não vê o aviso (não é ele quem decide)", async () => {
    await abrir(os({ ...JUSTIFICADA, mesesFechadosDoAtraso: ["2026-10"] }), OPERADOR);
    expect(texto($("[data-motivo-atraso]"))).toBe("Cliente ausente");
    expect($("[data-aviso-mes-fechado]")).toBeNull();
    expect($("[data-alterar-atraso]")).toBeNull();
  });
});
