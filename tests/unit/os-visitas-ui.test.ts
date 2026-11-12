// @vitest-environment happy-dom
/**
 * OS EM CAMPANHA / MÚLTIPLAS VISITAS nas telas, num DOM de verdade (o servidor é um substituto que
 * devolve o que o teste manda; as regras e o banco estão em os-visitas e os-visitas-pg):
 *  - o convite "Planejar visitas" na OS com uma atividade de vários equipamentos;
 *  - o diálogo: data, quantidade por dia, pular fim de semana, quem executa, e a PRÉVIA recalculada;
 *  - o painel: progresso somado, cada visita no seu dia com o seu lote, quem executa;
 *  - replanejar, incluir dia, tirar dia, mover visita e mover equipamentos;
 *  - só quem edita OS planeja; "Visita N de M" na lista de atividades e o progresso no cabeçalho.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as avisos from "@/components/ui/avisos";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { centralDaOs } from "@/lib/os/central";
import type { EstadoVisitasTela, VisitaTela } from "@/lib/os/visitas";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams() }));

const URL_V = "/api/ordens/os1/visitas";
/** Quinta-feira, 12/11/2026 (13 = sexta, 14 = sábado, 15 = domingo, 16 = segunda) */
const HOJE = "2026-11-12";

let root: Root; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[];
let respostas: Record<string, { status: number; corpo: unknown }>;
let toast: ReturnType<typeof vi.spyOn>;
let mudou: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pedidos = []; respostas = {}; mudou = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada); const metodo = init?.method ?? "GET";
    pedidos.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: [] };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
  toast = vi.spyOn(avisos, "toast").mockImplementation(() => {});
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); root = undefined as unknown as Root; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const $ = <T extends Element = HTMLElement>(s: string) => (document.body.querySelector(s) as T | null);
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const texto = (el: Element | null = caixa) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(seletor: string, valor: string) {
  const el = $(seletor) as HTMLInputElement; expect(el, seletor).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(seletor: string, valor: string) {
  const el = $(seletor) as HTMLSelectElement; expect(el, seletor).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}
async function montar(elemento: React.ReactElement) {
  if (root) { act(() => root.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(elemento); });
  await esperar();
}

const eq = (n: number, feito = false) => ({ id: `q${String(n).padStart(3, "0")}`, rotulo: `AC-${String(n).padStart(3, "0")} · Split ${n}`, local: `1º andar · Sala ${n}`, feito, ordem: `1º andar\u0001Sala ${String(n).padStart(3, "0")}` });
const faixa = (de: number, ate: number, feito = false) => Array.from({ length: ate - de + 1 }, (_, i) => eq(de + i, feito));
const visita = (numero: number, dia: string, equipamentos: ReturnType<typeof eq>[], extra: Partial<VisitaTela> = {}): VisitaTela => ({
  id: `v${numero}`, titulo: "Limpeza Química", status: "AGENDADA", dataAgendada: `${dia}T15:00:00.000Z`, dia, numero, pendente: true, executor: null, equipamentos, ...extra,
});
const BASE: EstadoVisitasTela = {
  plano: null, visitas: [], progresso: { feitos: 0, total: 0, visitas: 0, concluidas: 0 }, sobras: 0, bloqueio: null, hoje: HOJE, tipoOsId: "toQuimica", executorModelo: null,
  origem: { id: "a1", titulo: "Limpeza Química", equipamentos: faixa(1, 60), dataAgendada: "2026-11-16T15:00:00.000Z", dia: "2026-11-16" },
  proposta: { inicio: "2026-11-16", porDia: 25, pularFimSemana: true },
};
/** 3 visitas: a 1ª concluída (20 de 25), a 2ª e a 3ª pendentes */
const COM_PLANO: EstadoVisitasTela = {
  ...BASE, origem: null, plano: { porDia: 25, pularFimSemana: true }, sobras: 5,
  visitas: [
    visita(1, "2026-11-12", [...faixa(1, 20, true), ...faixa(21, 25)], { status: "CONCLUIDA", pendente: false, executor: "Equipe Alfa: Carlos Lima (responsável), Bruna Reis" }),
    visita(2, "2026-11-13", faixa(26, 50)), visita(3, "2026-11-16", faixa(51, 60)),
  ],
  progresso: { feitos: 20, total: 60, visitas: 3, concluidas: 1 },
  proposta: { inicio: "2026-11-13", porDia: 25, pularFimSemana: true },
};
async function abrir(estado: EstadoVisitasTela | null = BASE, permissoes: Permissoes = permissoesTotais()) {
  if (estado) respostas[`GET ${URL_V}`] = { status: 200, corpo: estado };
  const [{ OsVisitas }, { PermissoesProvider }] = await Promise.all([import("@/components/os/os-visitas"), import("@/components/providers/permissoes-provider")]);
  await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(OsVisitas, { osId: "os1", onMudou: mudou }) }));
}
const SO_VER = montarPermissoes({ ordens: ["visualizar"] });
const envios = () => pedidos.filter((p) => p.url === URL_V && p.metodo === "POST").map((p) => p.corpo);
const INICIO = "input[aria-label='Data de início das visitas']", POR_DIA = "input[aria-label='Equipamentos por dia']";
const previa = () => [texto($("[data-previa-resumo]")), $$("[data-previa-dia]").map((d) => texto(d))];

describe("OS › visitas: o convite para planejar", () => {
  it("OS com uma atividade de 60 equipamentos: convida a dividir em visitas, sem criar outra OS", async () => {
    await abrir();
    expect(texto($("[data-convite-visitas]"))).toBe("60 equipamentos numa atividade só. Não cabe num dia? Divida em visitas diárias, sem criar outra OS. Planejar visitas");
    expect($("[data-visitas]")).toBeNull();
    expect($("[data-modal-planejar]")).toBeNull();
  });

  it("não convida quem só visualiza, nem quando nada serve para dividir, nem quando a rota recusa (técnico do app)", async () => {
    await abrir(BASE, SO_VER);
    expect(texto()).toBe("");
    await abrir({ ...BASE, origem: null, bloqueio: "Para planejar visitas, a OS precisa de uma atividade agendada, ainda não iniciada, com 2 equipamentos ou mais." });
    expect(texto()).toBe("");
    respostas[`GET ${URL_V}`] = { status: 403, corpo: { erro: "O planejamento das visitas é feito pelo escritório." } };
    await abrir(null);
    expect(texto()).toBe("");
  });
});

describe("OS › visitas: o diálogo de planejar", () => {
  it("abre com a proposta (data da atividade, 25 por dia, pular fim de semana) e já mostra a PRÉVIA: quantas visitas, de que dia a que dia", async () => {
    await abrir();
    await clicar($("[data-planejar-visitas]"));
    expect([($(INICIO) as HTMLInputElement).value, ($(POR_DIA) as HTMLInputElement).value, ($("[data-pular-fim-semana]") as HTMLInputElement).checked]).toEqual(["16/11/2026", "25", true]);
    expect(texto($("[data-modal-planejar]"))).toContain("Continua sendo uma OS só, com uma cobrança.");
    expect(texto($("[data-modal-planejar]"))).toContain("60 a distribuir");
    expect(previa()).toEqual(["3 visitas, de seg, 16/11/2026 a qua, 18/11/2026", ["seg, 16/11 · 25", "ter, 17/11 · 25", "qua, 18/11 · 10"]]);
    expect(envios()).toEqual([]); // a prévia não grava nada
  });

  it("a prévia acompanha o que se muda: quantidade por dia, data de início e pular (ou não) o fim de semana", async () => {
    await abrir();
    await clicar($("[data-planejar-visitas]"));
    await digitar(POR_DIA, "20");
    expect(previa()).toEqual(["3 visitas, de seg, 16/11/2026 a qua, 18/11/2026", ["seg, 16/11 · 20", "ter, 17/11 · 20", "qua, 18/11 · 20"]]);
    await digitar(INICIO, "13/11/2026"); // sexta: a 2ª visita pula para segunda
    expect(previa()[1]).toEqual(["sex, 13/11 · 20", "seg, 16/11 · 20", "ter, 17/11 · 20"]);
    await clicar($("[data-pular-fim-semana]"));
    expect(previa()).toEqual(["3 visitas, de sex, 13/11/2026 a dom, 15/11/2026", ["sex, 13/11 · 20", "sáb, 14/11 · 20", "dom, 15/11 · 20"]]);
    await digitar(POR_DIA, "60");
    expect(previa()).toEqual(["1 visita, em sex, 13/11/2026", ["sex, 13/11 · 60"]]);
  });

  it("muitos dias: a prévia mostra os primeiros e diz quantos faltam", async () => {
    await abrir();
    await clicar($("[data-planejar-visitas]"));
    await digitar(POR_DIA, "3");
    expect(texto($("[data-previa-resumo]"))).toBe("20 visitas, de seg, 16/11/2026 a sex, 11/12/2026");
    expect($$("[data-previa-dia]")).toHaveLength(14);
    expect(texto($("[data-previa]"))).toContain("e mais 6");
  });

  it("valor que não serve: a regra explica no lugar da prévia e não deixa confirmar", async () => {
    await abrir();
    await clicar($("[data-planejar-visitas]"));
    const confirmar = () => $("[data-confirmar-visitas]") as HTMLButtonElement;
    for (const [campo, valor, msg] of [[POR_DIA, "0", "Informe quantos equipamentos por dia."], [POR_DIA, "", "Informe quantos equipamentos por dia."], [POR_DIA, "501", "São no máximo 500 equipamentos por dia."]]) {
      await digitar(campo, valor);
      expect([texto($("[data-previa-erro]")), $("[data-previa]"), confirmar().disabled]).toEqual([msg, null, true]);
    }
    await digitar(POR_DIA, "25");
    await digitar(INICIO, "11/11/2026");
    expect([texto($("[data-previa-erro]")), confirmar().disabled]).toEqual(["A data de início já passou.", true]);
    await digitar(INICIO, "12/11/2026");
    expect([$("[data-previa-erro]"), confirmar().disabled]).toEqual([null, false]);
  });

  it("CONFIRMAR manda a atividade a dividir, a data, a quantidade, o fim de semana e quem executa (em branco = sem quem execute); o painel aparece", async () => {
    respostas[`POST ${URL_V}`] = { status: 200, corpo: { resultado: {}, estado: { ...COM_PLANO, sobras: 0 } } };
    await abrir();
    await clicar($("[data-planejar-visitas]"));
    expect(texto($("[data-modal-planejar]"))).toContain("Opcional. Em branco, as visitas nascem sem quem execute, para distribuir depois.");
    await digitar(POR_DIA, "30");
    await clicar($("[data-confirmar-visitas]"));
    expect(envios()).toEqual([{
      acao: "PLANEJAR", inicio: "2026-11-16", porDia: 30, pularFimSemana: true, atividadeId: "a1",
      executor: { tecnicoIds: [], responsavelId: null, equipeId: null, veiculoId: null },
    }]);
    expect($("[data-modal-planejar]")).toBeNull();
    expect($("[data-visitas]")).toBeTruthy();
    expect($("[data-convite-visitas]")).toBeNull();
    expect(toast).toHaveBeenCalledWith("Visitas planejadas.");
    expect(mudou).toHaveBeenCalledTimes(1);
  });

  it("a atividade já tem quem execute: o diálogo abre com ele e manda para todas as visitas", async () => {
    respostas[`POST ${URL_V}`] = { status: 200, corpo: { resultado: {}, estado: COM_PLANO } };
    await abrir({ ...BASE, executorModelo: { tecnicoIds: ["t1", "t2"], responsavelId: "t1", equipeId: "eqA", veiculoId: "vA" } });
    await clicar($("[data-planejar-visitas]"));
    await clicar($("[data-confirmar-visitas]"));
    expect(envios()[0].executor).toEqual({ tecnicoIds: ["t1", "t2"], responsavelId: "t1", equipeId: "eqA", veiculoId: "vA" });
  });

  it("erro do servidor (409, 400): aparece no diálogo, que continua aberto; nada muda na tela", async () => {
    await abrir();
    await clicar($("[data-planejar-visitas]"));
    for (const [status, erro] of [[409, "Uma das visitas começou enquanto o planejamento era feito. Abra de novo e confira."], [400, "Sem competência neste tipo de OS: Elaine Paz."]] as const) {
      respostas[`POST ${URL_V}`] = { status, corpo: { erro } };
      await clicar($("[data-confirmar-visitas]"));
      expect(texto($("[data-erro-visitas]"))).toBe(erro);
    }
    expect($("[data-modal-planejar]")).toBeTruthy();
    expect(mudou).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("OS › visitas: o painel", () => {
  it("o PROGRESSO soma as visitas: '20 de 60 equipamentos', quantas visitas concluídas e a barra", async () => {
    await abrir(COM_PLANO);
    expect(texto($("[data-progresso]"))).toBe("20 de 60 equipamentos");
    expect(texto($("[data-visitas-concluidas]"))).toBe("1 de 3 visitas concluídas");
    expect($("[role=progressbar]")!.getAttribute("aria-valuenow")).toBe("33");
    await abrir({ ...COM_PLANO, progresso: { feitos: 60, total: 60, visitas: 1, concluidas: 1 } });
    expect([texto($("[data-progresso]")), texto($("[data-visitas-concluidas]")), $("[role=progressbar]")!.getAttribute("aria-valuenow")]).toEqual(["60 de 60 equipamentos", "1 de 1 visita concluída", "100"]);
  });

  it("cada visita no SEU dia, com a situação, o lote e quem executa — ou 'Sem quem execute'", async () => {
    await abrir(COM_PLANO);
    expect($$("[data-visita]").map((v) => texto(v))).toEqual([
      "Visita 1qui, 12/11/2026Concluída20 de 25 equipamentosEquipe Alfa: Carlos Lima (responsável), Bruna Reis",
      "Visita 2sex, 13/11/2026Agendada0 de 25 equipamentosSem quem execute",
      "Visita 3seg, 16/11/2026Agendada0 de 10 equipamentosSem quem execute",
    ]);
    // a visita concluída não tem ações; as pendentes têm mover e tirar
    const acoes = $$("[data-visita]").map((v) => [!!v.querySelector("[data-mover-visita]"), !!v.querySelector("[data-tirar-dia]")]);
    expect(acoes).toEqual([[false, false], [true, true], [true, true]]);
    expect(texto($("[data-sobras]"))).toBe("5 equipamentos ficaram sem atendimento em visita concluída. Replaneje para voltar a eles.");
  });

  it("quem só visualiza vê o painel e o progresso, sem nenhum botão de planejamento", async () => {
    await abrir(COM_PLANO, SO_VER);
    expect(texto($("[data-progresso]"))).toBe("20 de 60 equipamentos");
    expect($$("[data-visita]")).toHaveLength(3);
    for (const s of ["[data-replanejar]", "[data-incluir-dia]", "[data-mover-visita]", "[data-tirar-dia]"]) expect($(s), s).toBeNull();
    await clicar($$("[data-ver-equipamentos]")[1]);
    expect($$("[data-equipamentos-da-visita] input[type=checkbox]")).toEqual([]);
    expect($("[data-mover-para]")).toBeNull();
  });

  it("uma visita só pendente: não dá para tirar o dia (o botão fica desligado)", async () => {
    await abrir({ ...COM_PLANO, visitas: COM_PLANO.visitas.slice(0, 2) });
    expect(($$("[data-visita]")[1].querySelector("[data-tirar-dia]") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("OS › visitas: replanejar e ajustar", () => {
  it("REPLANEJAR: avisa que só refaz o que não começou; por padrão não mexe em quem executa; as sobras entram se marcado", async () => {
    respostas[`POST ${URL_V}`] = { status: 200, corpo: { resultado: {}, estado: COM_PLANO } };
    await abrir(COM_PLANO);
    await clicar($("[data-replanejar]"));
    expect(texto($("[data-modal-planejar]"))).toContain("Refaz só as visitas que ainda não começaram. O que já foi feito não é mexido.");
    expect(($("[data-trocar-executor]") as HTMLInputElement).checked).toBe(false);
    expect(($("[data-incluir-sobras]") as HTMLInputElement).checked).toBe(true);
    // 35 pendentes + 5 sobras = 40, em 25 por dia, a partir de sexta 13
    expect(previa()).toEqual(["2 visitas, de sex, 13/11/2026 a seg, 16/11/2026", ["sex, 13/11 · 25", "seg, 16/11 · 15"]]);
    await clicar($("[data-incluir-sobras]"));
    expect(previa()[1]).toEqual(["sex, 13/11 · 25", "seg, 16/11 · 10"]);
    await clicar($("[data-confirmar-visitas]"));
    expect(envios()).toEqual([{ acao: "PLANEJAR", inicio: "2026-11-13", porDia: 25, pularFimSemana: true, incluirSobras: false }]);
    expect(toast).toHaveBeenCalledWith("Visitas replanejadas.");
    // marcando "trocar quem executa", o executor vai no pedido
    await clicar($("[data-replanejar]"));
    await clicar($("[data-trocar-executor]"));
    await clicar($("[data-confirmar-visitas]"));
    expect(envios()[1]).toMatchObject({ incluirSobras: true, executor: { tecnicoIds: [], equipeId: null } });
  });

  it("INCLUIR UM DIA: a prévia mostra os lotes repartidos por igual; dia que já tem visita é recusado antes de enviar", async () => {
    respostas[`POST ${URL_V}`] = { status: 200, corpo: { resultado: {}, estado: COM_PLANO } };
    await abrir(COM_PLANO);
    await clicar($("[data-incluir-dia]"));
    const dia = "[data-modal-dia] input[aria-label='Dia da nova visita']";
    expect(($("[data-confirmar-visitas]") as HTMLButtonElement).disabled).toBe(true);
    await digitar(dia, "13/11/2026");
    expect([texto($("[data-erro-visitas]")), ($("[data-confirmar-visitas]") as HTMLButtonElement).disabled]).toEqual(["Já existe uma visita pendente nesse dia.", true]);
    await digitar(dia, "17/11/2026");
    expect(previa()).toEqual(["3 visitas, de sex, 13/11/2026 a ter, 17/11/2026", ["sex, 13/11 · 12", "seg, 16/11 · 12", "ter, 17/11 · 11"]]);
    await clicar($("[data-confirmar-visitas]"));
    expect(envios()).toEqual([{ acao: "INCLUIR_DIA", dia: "2026-11-17" }]);
    expect(toast).toHaveBeenCalledWith("Dia incluído.");
  });

  it("MOVER UMA VISITA: abre com o dia atual, diz que só ela muda, e manda o dia novo", async () => {
    respostas[`POST ${URL_V}`] = { status: 200, corpo: { resultado: {}, estado: COM_PLANO } };
    await abrir(COM_PLANO);
    await clicar($$("[data-visita]")[1].querySelector("[data-mover-visita]"));
    const dia = "[data-modal-dia] input[aria-label='Novo dia da visita']";
    expect(($(dia) as HTMLInputElement).value).toBe("13/11/2026");
    expect(texto($("[data-modal-dia]"))).toContain("Hoje em sex, 13/11/2026. Só esta visita muda; as outras ficam como estão.");
    await digitar(dia, "19/11/2026");
    await clicar($("[data-confirmar-visitas]"));
    expect(envios()).toEqual([{ acao: "MOVER_VISITA", visitaId: "v2", dia: "2026-11-19" }]);
  });

  it("TIRAR UM DIA: confirma mostrando para onde vão os equipamentos, e só então manda", async () => {
    respostas[`POST ${URL_V}`] = { status: 200, corpo: { resultado: {}, estado: COM_PLANO } };
    await abrir(COM_PLANO);
    await clicar($$("[data-visita]")[2].querySelector("[data-tirar-dia]"));
    expect(texto($("[data-modal-tirar]"))).toContain("A visita de seg, 16/11/2026 deixa de existir. Os 10 equipamentos vão para as outras visitas pendentes.");
    expect(previa()).toEqual(["1 visita, em sex, 13/11/2026", ["sex, 13/11 · 35"]]);
    expect(envios()).toEqual([]);
    await clicar($("[data-confirmar-visitas]"));
    expect(envios()).toEqual([{ acao: "TIRAR_DIA", visitaId: "v3" }]);
    expect(toast).toHaveBeenCalledWith("Dia retirado.");
  });

  it("AJUSTE MANUAL: abre a visita, marca equipamentos, escolhe a visita de destino e move", async () => {
    respostas[`POST ${URL_V}`] = { status: 200, corpo: { resultado: {}, estado: COM_PLANO } };
    await abrir(COM_PLANO);
    await clicar($$("[data-ver-equipamentos]")[1]);
    expect($$("[data-equipamentos-da-visita] [data-equipamento]")).toHaveLength(25);
    expect(texto($("[data-equipamento='q026']"))).toBe("AC-026 · Split 26 · 1º andar · Sala 26");
    const mover = () => $("[data-mover-equipamentos]") as HTMLButtonElement;
    expect(mover().disabled).toBe(true);
    await clicar($("[data-equipamento='q026'] input"));
    await clicar($("[data-equipamento='q027'] input"));
    expect(texto($("[data-mover-para]"))).toContain("Mover 2 marcados para");
    expect(mover().disabled).toBe(true); // falta o destino
    // o destino só oferece as OUTRAS visitas pendentes
    expect($$("[data-mover-para] option").map((o) => texto(o))).toEqual(["Escolha a visita", "Visita 3 · seg, 16/11/2026"]);
    await escolher("[data-mover-para] select", "v3");
    await clicar(mover());
    expect(envios()).toEqual([{ acao: "MOVER_EQUIPAMENTOS", equipamentoIds: ["q026", "q027"], paraVisitaId: "v3" }]);
    expect(toast).toHaveBeenCalledWith("Equipamentos movidos.");
  });

  it("a visita concluída mostra o que foi atendido, sem caixa para mover", async () => {
    await abrir(COM_PLANO);
    await clicar($$("[data-ver-equipamentos]")[0]);
    expect($$("[data-equipamentos-da-visita] input[type=checkbox]")).toEqual([]);
    expect(texto($("[data-equipamento='q001']"))).toBe("AC-001 · Split 1 · 1º andar · Sala 1atendido");
    expect(texto($("[data-equipamento='q021']"))).toBe("AC-021 · Split 21 · 1º andar · Sala 21");
    expect($("[data-mover-para]")).toBeNull();
  });
});

describe("OS › visitas: no resto da OS", () => {
  it("cabeçalho: 'Equipamentos atendidos' soma as visitas (feitos de total), sem contar visita cancelada nem atividade fora do plano", () => {
    const at = (id: string, status: string, plano: string | null, feitos: number, total: number) => ({
      id, titulo: "Limpeza", status, dataAgendada: null, prazo: null, planoVisitasId: plano,
      equipamentos: Array.from({ length: total }, (_, i) => ({ feito: i < feitos, equipamentoId: `${id}-${i}` })),
    });
    const os = (atividades: ReturnType<typeof at>[]) => centralDaOs({ status: "EM_ANDAMENTO", statusManual: false, previsaoConclusao: null, atividades, medicoes: [], itensOrcamento: [], orcamentos: [], prazosSla: [], materiais: [] } as any);
    expect(os([at("v1", "CONCLUIDA", "p1", 20, 25), at("v2", "AGENDADA", "p1", 0, 25), at("v3", "CANCELADA", "p1", 9, 9), at("avulsa", "AGENDADA", null, 0, 4)]).visitas)
      .toEqual({ feitos: 20, total: 50, visitas: 2, concluidas: 1 });
    // OS sem plano de visitas: nada muda no cabeçalho
    expect(os([at("a1", "CONCLUIDA", null, 3, 5)]).visitas).toBeNull();
    expect(os([at("a1", "CONCLUIDA", null, 3, 5)]).equipamentosAtendidos).toBe(3);
  });

  it("lista de atividades: a atividade que é visita mostra 'Visita N de M' (por data); a atividade comum não", async () => {
    const [{ OsAtividades }, { PermissoesProvider }] = await Promise.all([import("@/components/os/os-atividades"), import("@/components/providers/permissoes-provider")]);
    const at = (id: string, dataAgendada: string, planoVisitasId: string | null, status = "AGENDADA") => ({ id, titulo: id, status, dataAgendada, planoVisitasId, equipamentos: [], tecnicosEquipe: [] });
    const atividades = [at("b", "2026-11-13T15:00:00Z", "p1"), at("a", "2026-11-12T15:00:00Z", "p1", "CONCLUIDA"), at("avulsa", "2026-11-30T15:00:00Z", null), at("c", "2026-11-16T15:00:00Z", "p1")];
    await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(OsAtividades, { osId: "os1", atividades }) }));
    expect($$("[data-chip-visita]").map((c) => texto(c))).toEqual(["Visita 2 de 3", "Visita 1 de 3", "Visita 3 de 3"]);
  });
});
