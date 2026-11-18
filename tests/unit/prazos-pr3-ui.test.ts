// @vitest-environment happy-dom
/**
 * Prazos da OS — PR 3, as telas num DOM de verdade (happy-dom), API simulada:
 *  - FICHA do colaborador (painel): a seção "Atrasos justificados" mostra a OS, o prazo, o motivo, a
 *    explicação e quem justificou — o atraso não some, fica visível e rotulado; o número abre a OS.
 *    Os atrasos que contam ficam numa seção à parte (é por ela que a gestão chega à OS para
 *    justificar). Mês sem justificativa diz isso; mês fechado antes de a lista existir não mostra nada;
 *  - APP do técnico: os atrasos DELE, com o motivo — sem link para o painel; sem atraso, nada aparece;
 *  - na OS: quem justifica é avisado quando o atraso é de um mês do desempenho JÁ FECHADO (no cartão
 *    e na gaveta); quem não justifica não vê o aviso.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";
import { separarAtrasos, textoDeQuemJustificou, textoDoAtraso } from "@/components/desempenho/atrasos";

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
  { atividadeId: "a1", ordemServicoId: "os7", numeroOs: "OS-107", prazo: "2026-11-06", concluidaEm: "2026-11-09", dias: 3, justificado: "CLIENTE_AUSENTE",
    explicacao: "Portaria fechada; o responsável não atendeu.", justificadoPor: "Gabi Gestora", justificadoEm: "2026-11-10T14:00:00.000Z" },
  { atividadeId: "a2", ordemServicoId: "os8", numeroOs: "CH-77", prazo: "2026-11-10", concluidaEm: "2026-11-11", dias: 1, justificado: null },
  { atividadeId: "a3", ordemServicoId: "os9", numeroOs: "OS-109", prazo: "2026-11-12", concluidaEm: "2026-11-14", dias: 2, justificado: "MOTIVO_DE_OUTRA_VERSAO", explicacao: null, justificadoPor: null, justificadoEm: null },
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
/** Cada linha de uma seção: o que ela mostra, campo a campo */
const linhasDe = (secao: string) => $$(`${secao} [data-atraso]`).map((li) => ({
  tipo: li.getAttribute("data-atraso"),
  os: `${li.querySelector("[data-atraso-os]")!.tagName} ${texto(li.querySelector("[data-atraso-os]"))} ${li.querySelector("[data-atraso-os]")!.getAttribute("href") ?? ""}`.trim(),
  prazo: texto(li.querySelector("[data-atraso-texto]")),
  motivo: texto(li.querySelector("[data-atraso-motivo]")),
  explicacao: texto(li.querySelector("[data-atraso-explicacao]")),
  quem: texto(li.querySelector("[data-atraso-quem]")),
}));

describe("os textos dos atrasos", () => {
  it("'Prazo dd/mm/aaaa · concluída em dd/mm/aaaa (N dias depois)', singular e plural", () => {
    expect(textoDoAtraso({ prazo: "2026-11-06", concluidaEm: "2026-11-09", dias: 3 })).toBe("Prazo 06/11/2026 · concluída em 09/11/2026 (3 dias depois)");
    expect(textoDoAtraso({ prazo: "2026-12-31", concluidaEm: "2027-01-01", dias: 1 })).toBe("Prazo 31/12/2026 · concluída em 01/01/2027 (1 dia depois)");
  });

  it("quem justificou e quando — com o que houver; sem nada, não escreve nada", () => {
    expect(textoDeQuemJustificou({ justificadoPor: "Gabi Gestora", justificadoEm: "2026-11-10T14:00:00.000Z" })).toBe("Justificado por Gabi Gestora em 10/11/2026");
    expect(textoDeQuemJustificou({ justificadoPor: "Gabi Gestora", justificadoEm: null })).toBe("Justificado por Gabi Gestora");
    expect(textoDeQuemJustificou({ justificadoPor: null, justificadoEm: "2026-11-10T14:00:00.000Z" })).toBe("Justificado em 10/11/2026");
    expect(textoDeQuemJustificou({ justificadoPor: null, justificadoEm: null })).toBe("");
    expect(textoDeQuemJustificou({})).toBe("");
    // 23h de Brasília do dia 10 já é dia 11 em UTC: vale o dia de Brasília
    expect(textoDeQuemJustificou({ justificadoPor: "Gabi", justificadoEm: "2026-11-11T02:00:00.000Z" })).toBe("Justificado por Gabi em 10/11/2026");
  });

  it("separa os justificados dos que contam, na ordem em que vieram; sem lista, as duas partes vêm vazias", () => {
    const { justificados, contam } = separarAtrasos(ATRASOS as never);
    expect(justificados.map((a) => a.numeroOs)).toEqual(["OS-107", "OS-109"]);
    expect(contam.map((a) => a.numeroOs)).toEqual(["CH-77"]);
    expect(separarAtrasos(undefined)).toEqual({ justificados: [], contam: [] });
  });
});

describe("Ficha do colaborador: Atrasos justificados", () => {
  async function abrir(atrasos: unknown) {
    responder(`GET /api/desempenho/colaboradores/t1?mes=${MES}`, ficha(atrasos));
    const { FichaDesempenho } = await import("@/components/desempenho/ficha-client");
    await montar(createElement(FichaDesempenho, { tecnicoId: "t1", mesInicial: MES, mesAtual: MES }));
  }

  it("a seção própria mostra a OS (abre a OS), a data do prazo, o motivo, a explicação e quem justificou", async () => {
    await abrir(ATRASOS);
    expect(texto($("[data-atrasos-justificados] h2"))).toContain("Atrasos justificados");
    expect(linhasDe("[data-atrasos-justificados]")).toEqual([
      { tipo: "justificado", os: "A OS-107 /ordens/os7", prazo: "Prazo 06/11/2026 · concluída em 09/11/2026 (3 dias depois)", motivo: "Motivo: Cliente ausente",
        explicacao: "Portaria fechada; o responsável não atendeu.", quem: "Justificado por Gabi Gestora em 10/11/2026" },
      // Sem explicação e sem autor gravados: a linha mostra o que tem; o motivo que esta versão não conhece aparece como veio (nunca some)
      { tipo: "justificado", os: "A OS-109 /ordens/os9", prazo: "Prazo 12/11/2026 · concluída em 14/11/2026 (2 dias depois)", motivo: "Motivo: MOTIVO_DE_OUTRA_VERSAO", explicacao: "", quem: "" },
    ]);
    // O número ao lado bate com a regra: a composição diz quantos ficaram fora da conta
    expect(texto($("[data-tabela-composicao] [data-metrica-detalhe], [data-composicao] [data-metrica-detalhe]"))).toBe("1 de 2 atividades · 2 atrasos justificados fora da conta");
    // A instrução fica no ⓘ do título
    expect($$("[data-dica]").map((d) => d.getAttribute("aria-label")).filter(Boolean)).toEqual(expect.arrayContaining(["Ajuda: Atrasos justificados", "Ajuda: Atrasos que contam"]));
  });

  it("o atraso que CONTA fica em outra seção — sem motivo, sem autor —, com o número abrindo a OS (é lá que se justifica)", async () => {
    await abrir(ATRASOS);
    expect(texto($("[data-atrasos-que-contam] h2"))).toContain("Atrasos que contam");
    expect(linhasDe("[data-atrasos-que-contam]")).toEqual([
      { tipo: "conta", os: "A CH-77 /ordens/os8", prazo: "Prazo 10/11/2026 · concluída em 11/11/2026 (1 dia depois)", motivo: "", explicacao: "", quem: "" },
    ]);
    // Nenhum atraso aparece nas duas seções
    expect($$("[data-atraso]")).toHaveLength(3);
  });

  it("mês sem atraso justificado: a seção diz isso; sem atraso que conta, a segunda seção não aparece", async () => {
    await abrir([]);
    expect(texto($("[data-atrasos-justificados]"))).toContain("Nenhum atraso justificado em 11/2026.");
    expect($("[data-lista-atrasos]")).toBeNull();
    expect($("[data-atrasos-que-contam]")).toBeNull();
    desmontar();
    // Só atraso que conta: "justificados" vazia com a mensagem, e a lista dos que contam
    await abrir([ATRASOS[1]]);
    expect(texto($("[data-atrasos-justificados]"))).toContain("Nenhum atraso justificado em 11/2026.");
    expect(linhasDe("[data-atrasos-que-contam]").map((l) => l.os)).toEqual(["A CH-77 /ordens/os8"]);
  });

  it("mês fechado antes de a lista existir (linha sem 'atrasos'): nenhuma das seções aparece — e o resto da ficha abre normal", async () => {
    await abrir(undefined);
    expect($("[data-atrasos-justificados]")).toBeNull();
    expect($("[data-atrasos-que-contam]")).toBeNull();
    expect(texto($("[data-ficha-escore]"))).toBe("75,0%");
    expect($("[data-penalidades-ficha]")).not.toBeNull();
  });
});

describe("App do técnico: os atrasos dele", () => {
  // O app recebe só o motivo (o servidor tira a explicação e quem justificou)
  const DO_APP = ATRASOS.map(({ explicacao: _e, justificadoPor: _p, justificadoEm: _q, ...a }: any) => a);
  async function abrir(atrasos: unknown) {
    responder(`GET /api/tecnico/desempenho?mes=${MES}`, { participa: true, ficha: ficha(atrasos) });
    const { DesempenhoTecnico } = await import("@/components/tecnico/desempenho");
    await montar(createElement(DesempenhoTecnico));
  }

  it("mostra os justificados com o motivo e os que contam — sem link para o painel (o técnico não entra lá)", async () => {
    await abrir(DO_APP.slice(0, 2));
    expect(texto($("[data-meus-atrasos-justificados] h2"))).toBe("Atrasos justificados");
    expect(linhasDe("[data-meus-atrasos-justificados]")).toEqual([
      { tipo: "justificado", os: "SPAN OS-107", prazo: "Prazo 06/11/2026 · concluída em 09/11/2026 (3 dias depois)", motivo: "Motivo: Cliente ausente", explicacao: "", quem: "" },
    ]);
    expect(texto($("[data-meus-atrasos-que-contam] h2"))).toBe("Atrasos que contam");
    expect(linhasDe("[data-meus-atrasos-que-contam]").map((l) => `${l.tipo} ${l.os} ${l.motivo}`.trim())).toEqual(["conta SPAN CH-77"]);
    expect($("[data-meus-atrasos-justificados] a, [data-meus-atrasos-que-contam] a")).toBeNull();
    expect(texto($('[data-minha-composicao] [data-metrica="prazo"] [data-metrica-detalhe]'))).toBe("1 de 2 atividades · 2 atrasos justificados fora da conta · peso 50%");
  });

  it("sem atraso (ou mês antigo sem a lista): nenhuma seção aparece; só de um tipo, só a dele", async () => {
    await abrir([]);
    expect($("[data-meus-atrasos-justificados], [data-meus-atrasos-que-contam]")).toBeNull();
    expect($("[data-minha-composicao]")).not.toBeNull();
    desmontar();
    await abrir(undefined);
    expect($("[data-meus-atrasos-justificados], [data-meus-atrasos-que-contam]")).toBeNull();
    expect($("[data-meu-escore]")).not.toBeNull();
    desmontar();
    await abrir([DO_APP[1]]);
    expect($("[data-meus-atrasos-justificados]")).toBeNull();
    expect($("[data-meus-atrasos-que-contam]")).not.toBeNull();
    desmontar();
    await abrir([DO_APP[0]]);
    expect($("[data-meus-atrasos-justificados]")).not.toBeNull();
    expect($("[data-meus-atrasos-que-contam]")).toBeNull();
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
