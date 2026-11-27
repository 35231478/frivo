// @vitest-environment happy-dom
/**
 * Prazos da OS — PR 4, as telas num DOM de verdade (happy-dom), API simulada:
 *  - CONTRATO › Prazo de atendimento: começa com UM prazo para todo chamado; "Definir por prioridade"
 *    abre as cinco linhas já com o prazo que estava; o marcador de horário comercial diz qual é o
 *    horário DA EMPRESA; o que a tela monta é o que o servidor valida;
 *  - OS › cartão "Prazo de atendimento": comparecer até / resolver até com o estado em palavra e cor
 *    (neutro, âmbar, vermelho, verde); a chegada e a conclusão registradas; OS encerrada sem registro;
 *    contrato que não promete para a prioridade; OS que não é chamado não mostra nada. O relógio da
 *    tela anda sozinho. O SELO do cabeçalho só aparece quando o prazo pede atenção;
 *  - CONFIGURAÇÕES › Horário comercial: a semana começa na segunda; ligar um dia, mudar a hora,
 *    salvar (PUT com a jornada), restaurar o padrão; validação antes de chamar; sem permissão, só lê;
 *  - o SINO: dois avisos próprios (estourado e vencendo), com link para a lista já filtrada, só para
 *    quem vê as OS.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";
import { MSG_JORNADA_HORAS, MSG_JORNADA_VAZIA, regrasAtendimentoSchema } from "@/lib/atendimento/prazo";
import { PRAZOS_EM_BRANCO, prazosDoFormulario, prazosParaOFormulario, type PrazosDoFormulario } from "@/lib/atendimento/formulario";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(""),
}));

let root: Root | null = null;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, { status: number; corpo: unknown }> = {};

beforeAll(async () => {
  await Promise.all([
    import("@/components/ui/avisos"), import("@/components/contratos/prazos-atendimento"), import("@/components/os/central/prazo-atendimento"),
    import("@/components/config/horario-comercial-client"), import("@/components/layout/header"),
  ]);
}, 120_000);

const br = (data: string, hora = "00:00") => new Date(`${data}T${hora}:00-03:00`);
/** Quarta, 18/11/2026, 15h em Brasília */
const AGORA = br("2026-11-18", "15:00");

beforeEach(() => {
  chamadas.length = 0; respostas = {};
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"], now: AGORA });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); root = null; caixa?.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el, "elemento a clicar").not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function escrever(el: Element | null, v: string) {
  expect(el, "campo a preencher").not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET");
const toasts = () => $$("[data-toast]").map((t) => txt(t));
async function montar(elemento: React.ReactElement) {
  if (root) { act(() => root!.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(elemento); });
  await esperar();
}

/* ═════════ contrato ═════════ */
describe("Contrato › Prazo de atendimento", () => {
  let valor: PrazosDoFormulario;
  async function montarPrazos(inicial: PrazosDoFormulario = PRAZOS_EM_BRANCO(), extra: { horario?: string; erro?: string } = {}) {
    const { PrazosAtendimento } = await import("@/components/contratos/prazos-atendimento");
    valor = inicial;
    function Caixa() {
      const [v, setV] = useState(inicial);
      valor = v;
      return createElement(PrazosAtendimento, { value: v, onChange: setV, horario: extra.horario ?? "segunda a sexta, das 8h às 18h", erro: extra.erro });
    }
    await montar(createElement(Caixa));
  }
  const campo = (nome: string) => $<HTMLInputElement>(`input[aria-label='${nome}']`);
  const modo = () => $("[data-prazos-atendimento]")!.getAttribute("data-prazos-atendimento");

  it("começa simples: UM prazo para todo chamado, em branco (\"Sem prazo\"), com o avançado atrás de um link", async () => {
    await montarPrazos();
    expect(modo()).toBe("unico");
    expect($$("input[data-horas]").map((i) => [i.getAttribute("aria-label"), (i as HTMLInputElement).value, (i as HTMLInputElement).placeholder]))
      .toEqual([["Comparecer em (horas)", "", "Sem prazo"], ["Resolver em (horas)", "", "Sem prazo"]]);
    expect($("[data-prazos-por-prioridade]")).toBeNull();
    expect(txt($("[data-alternar-prioridade]"))).toBe("Definir por prioridade do chamado");
    expect($("[data-erro-prazos-atendimento]")).toBeNull();
    // em branco não grava promessa nenhuma
    expect(prazosDoFormulario(valor)).toEqual([]);
  });

  it("o prazo único vale para as cinco prioridades; o que a tela monta passa na validação do servidor", async () => {
    await montarPrazos();
    await escrever(campo("Comparecer em (horas)"), "4");
    await escrever(campo("Resolver em (horas)"), "24");
    const enviado = prazosDoFormulario(valor);
    expect(enviado.map((r) => `${r.prioridade} ${r.comparecerHoras}/${r.resolverHoras} ${r.soHorarioComercial}`))
      .toEqual(["BAIXA 4/24 false", "NORMAL 4/24 false", "ALTA 4/24 false", "URGENTE 4/24 false", "CRITICO 4/24 false"]);
    expect(regrasAtendimentoSchema.safeParse(enviado).success).toBe(true);
  });

  it("o marcador diz QUAL é o horário comercial da empresa — e marca o contrato inteiro", async () => {
    await montarPrazos({ ...PRAZOS_EM_BRANCO(), geral: { comparecer: "4", resolver: "" } }, { horario: "segunda a sexta, das 8h às 18h; sábado, das 8h às 12h" });
    expect(txt($("[data-horario-comercial]"))).toBe("segunda a sexta, das 8h às 18h; sábado, das 8h às 12h. Fora desse horário o relógio do prazo para.");
    expect($<HTMLInputElement>("[data-so-horario-comercial]")!.checked).toBe(false);
    await clicar($("[data-so-horario-comercial]"));
    expect(prazosDoFormulario(valor).every((r) => r.soHorarioComercial)).toBe(true);
    expect(prazosDoFormulario(valor)).toHaveLength(5);
  });

  it("\"Definir por prioridade\" abre as cinco linhas já com o prazo que estava; cada uma muda sozinha; voltar fica com o da Normal", async () => {
    await montarPrazos({ ...PRAZOS_EM_BRANCO(), geral: { comparecer: "4", resolver: "24" } });
    await clicar($("[data-alternar-prioridade]"));
    expect(modo()).toBe("por-prioridade");
    expect($$("[data-prazo-prioridade]").map((l) => [l.getAttribute("data-prazo-prioridade"), txt(l.querySelector("span")), ...[...l.querySelectorAll("input")].map((i) => i.value)]))
      .toEqual([["BAIXA", "Baixa", "4", "24"], ["NORMAL", "Normal", "4", "24"], ["ALTA", "Alta", "4", "24"], ["URGENTE", "Urgente", "4", "24"], ["CRITICO", "Crítico", "4", "24"]]);
    expect(txt($("[data-alternar-prioridade]"))).toBe("Usar um prazo só para todo chamado");

    await escrever(campo("Comparecer em (horas), prioridade Crítico"), "1");
    await escrever(campo("Resolver em (horas), prioridade Crítico"), "6");
    await escrever(campo("Comparecer em (horas), prioridade Baixa"), "");
    await escrever(campo("Resolver em (horas), prioridade Baixa"), "");
    expect(prazosDoFormulario(valor).map((r) => `${r.prioridade} ${r.comparecerHoras}/${r.resolverHoras}`)).toEqual(["NORMAL 4/24", "ALTA 4/24", "URGENTE 4/24", "CRITICO 1/6"]);

    await escrever(campo("Comparecer em (horas), prioridade Normal"), "12");
    await clicar($("[data-alternar-prioridade]"));
    expect(modo()).toBe("unico");
    expect([campo("Comparecer em (horas)")!.value, campo("Resolver em (horas)")!.value]).toEqual(["12", "24"]);
  });

  it("contrato com prazos diferentes por prioridade já abre com as linhas à mostra; o erro do servidor aparece no bloco", async () => {
    const gravado = [
      { prioridade: "NORMAL", comparecerHoras: 24, resolverHoras: null, soHorarioComercial: true },
      { prioridade: "URGENTE", comparecerHoras: 4, resolverHoras: 24, soHorarioComercial: true },
    ];
    await montarPrazos(prazosParaOFormulario(gravado), { erro: "O prazo para resolver não pode ser menor que o de comparecer." });
    expect(modo()).toBe("por-prioridade");
    expect([campo("Comparecer em (horas), prioridade Urgente")!.value, campo("Resolver em (horas), prioridade Urgente")!.value, campo("Resolver em (horas), prioridade Normal")!.value]).toEqual(["4", "24", ""]);
    expect($<HTMLInputElement>("[data-so-horario-comercial]")!.checked).toBe(true);
    expect(txt($("[data-erro-prazos-atendimento]"))).toBe("O prazo para resolver não pode ser menor que o de comparecer.");
    expect($("[data-erro-prazos-atendimento]")!.getAttribute("role")).toBe("alert");
    expect(prazosDoFormulario(valor)).toEqual(gravado);
  });
});

/* ═════════ a OS ═════════ */
describe("OS › cartão e selo do prazo de atendimento", () => {
  const os = (extra: Record<string, unknown> = {}) => ({
    id: "os1", numero: "OS-2026-0301", status: "AGENDADA", prioridade: "URGENTE", origem: "PORTAL_CLIENTE", contratoId: "ct1", contrato: { numero: "CT-2026-012" },
    chamadoAbertoEm: br("2026-11-18", "10:00").toISOString(),
    atendimentoComparecerAte: br("2026-11-18", "17:00").toISOString(), atendimentoResolverAte: br("2026-11-19", "10:00").toISOString(),
    atendimentoComparecidoEm: null, dataConclusao: null, ...extra,
  });
  async function montarCartao(dados: any) {
    const { PrazoDeAtendimento, SeloDeAtendimento } = await import("@/components/os/central/prazo-atendimento");
    await montar(createElement("div", null, createElement(SeloDeAtendimento, { os: dados }), createElement(PrazoDeAtendimento, { os: dados })));
  }
  const linha = (qual: "comparecer" | "resolver") => {
    const l = $(`[data-prazo-atendimento='${qual}']`);
    return l ? [l.getAttribute("data-situacao"), txt(l.querySelector("[data-limite]")), txt(l.querySelector("[data-tom]")), l.querySelector("[data-tom]")!.getAttribute("data-tom"), txt(l.querySelector("[data-cumprido]"))] : null;
  };
  const selo = () => { const s = $("[data-selo-atendimento]"); return s ? [s.getAttribute("data-selo-atendimento"), txt(s), s.getAttribute("data-tom")] : null; };

  it("os dois prazos com o limite por extenso e o estado em palavra: com folga é neutro e não há selo", async () => {
    await montarCartao(os());
    expect(txt($("[data-cartao='prazo-atendimento'] h2, [data-cartao='prazo-atendimento'] h3"))).toBe("Prazo de atendimento");
    expect(linha("comparecer")).toEqual(["NO_PRAZO", "18/11/2026 às 17:00", "faltam 2 h", "previsto", ""]);
    expect(linha("resolver")).toEqual(["NO_PRAZO", "19/11/2026 às 10:00", "faltam 19 h", "previsto", ""]);
    expect(txt($("[data-chamado-aberto]"))).toBe("Chamado aberto em 18/11/2026 às 10:00 · contrato CT-2026-012");
    expect(selo()).toBeNull();
    // é outro assunto: nada de "prazo de execução" nem "atrasada" neste cartão
    expect(txt($("[data-cartao='prazo-atendimento']"))).not.toMatch(/execução|Atrasad/i);
  });

  it("perto do limite fica âmbar e o selo aparece; passou do limite, vermelho", async () => {
    await montarCartao(os({ atendimentoComparecerAte: br("2026-11-18", "15:40").toISOString() }));
    expect(linha("comparecer")).toEqual(["VENCENDO", "18/11/2026 às 15:40", "faltam 40 min", "atencao", ""]);
    expect(selo()).toEqual(["VENCENDO", "Prazo de atendimento vencendo", "atencao"]);

    await montarCartao(os({ atendimentoComparecerAte: br("2026-11-18", "14:00").toISOString() }));
    expect(linha("comparecer")).toEqual(["ESTOURADO", "18/11/2026 às 14:00", "estourou há 1 h", "atrasado", ""]);
    expect(linha("resolver")?.[0]).toBe("NO_PRAZO");
    expect(selo()).toEqual(["ESTOURADO", "Prazo de atendimento estourado", "atrasado"]);
  });

  it("o relógio da tela anda sozinho: sem recarregar, \"faltam 40 min\" vira \"estourou\"", async () => {
    await montarCartao(os({ atendimentoComparecerAte: br("2026-11-18", "15:40").toISOString() }));
    expect(linha("comparecer")?.[2]).toBe("faltam 40 min");
    await act(async () => { vi.setSystemTime(new Date(br("2026-11-18", "15:50").getTime() - 30_000)); vi.advanceTimersByTime(30_000); }); // o relógio da tela bate a cada meio minuto
    expect(linha("comparecer")?.slice(0, 4)).toEqual(["ESTOURADO", "18/11/2026 às 15:40", "estourou há 10 min", "atrasado"]);
    expect(selo()?.[0]).toBe("ESTOURADO");
  });

  it("a página nasce no servidor: o HTML não depende da hora em que foi gerado (sem \"faltam…\" nem selo), só o limite e os fatos gravados", async () => {
    const { renderToString } = await import("react-dom/server");
    const { PrazoDeAtendimento, SeloDeAtendimento } = await import("@/components/os/central/prazo-atendimento");
    const html = (dados: any) => renderToString(createElement("div", null, createElement(SeloDeAtendimento, { os: dados }), createElement(PrazoDeAtendimento, { os: dados })));
    const aberta = os({ atendimentoComparecerAte: br("2026-11-18", "15:40").toISOString() });
    const as15h = html(aberta);
    vi.setSystemTime(br("2026-11-18", "16:30")); // o navegador hidrata depois: o limite de comparecer já passou
    expect(html(aberta)).toBe(as15h);
    expect(as15h).toContain("18/11/2026 às 15:40");
    expect(as15h).not.toMatch(/faltam|estourou|data-selo-atendimento|data-situacao/);
    // o que já é fato (chegou, concluiu) não depende do relógio e já vem pronto do servidor
    const cumprida = html(os({ atendimentoComparecidoEm: br("2026-11-18", "13:42").toISOString(), atendimentoComparecerAte: br("2026-11-18", "14:00").toISOString() }));
    expect(cumprida).toContain("cumprido no prazo");
    expect(cumprida).toContain("Chegou em 18/11/2026 às 13:42");
    expect(cumprida).toContain('data-situacao="CUMPRIDO"');
  });

  it("o \"Cheguei\" registrado: comparecimento cumprido (verde) com a hora da chegada; chegou depois do limite, diz o atraso", async () => {
    await montarCartao(os({ atendimentoComparecerAte: br("2026-11-18", "14:00").toISOString(), atendimentoComparecidoEm: br("2026-11-18", "13:42").toISOString(), status: "EM_ANDAMENTO" }));
    expect(linha("comparecer")).toEqual(["CUMPRIDO", "18/11/2026 às 14:00", "cumprido no prazo", "ok", "Chegou em 18/11/2026 às 13:42"]);
    expect(selo()).toBeNull(); // o comparecimento saiu da conta; resolver tem folga

    await montarCartao(os({ atendimentoComparecerAte: br("2026-11-18", "13:00").toISOString(), atendimentoComparecidoEm: br("2026-11-18", "14:30").toISOString() }));
    expect(linha("comparecer")).toEqual(["CUMPRIDO_FORA", "18/11/2026 às 13:00", "cumprido com 1 h 30 min de atraso", "atrasado", "Chegou em 18/11/2026 às 14:30"]);
  });

  it("OS concluída: resolver cumprido com a data da conclusão; sem chegada registrada depois do limite, \"sem registro\" — sem alerta", async () => {
    await montarCartao(os({
      status: "CONCLUIDA", dataConclusao: br("2026-11-18", "14:50").toISOString(),
      atendimentoComparecerAte: br("2026-11-18", "14:00").toISOString(), atendimentoComparecidoEm: br("2026-11-18", "13:42").toISOString(),
    }));
    expect(linha("resolver")).toEqual(["CUMPRIDO", "19/11/2026 às 10:00", "cumprido no prazo", "ok", "Concluída em 18/11/2026 às 14:50"]);
    expect(selo()).toBeNull();

    await montarCartao(os({ status: "CONCLUIDA", dataConclusao: br("2026-11-18", "14:50").toISOString(), atendimentoComparecerAte: br("2026-11-18", "14:00").toISOString() }));
    expect(linha("comparecer")).toEqual(["SEM_REGISTRO", "18/11/2026 às 14:00", "sem registro", "previsto", ""]);
    expect(selo()).toBeNull();
    // cancelada com o limite vencido: nada de vermelho contando para sempre
    await montarCartao(os({ status: "CANCELADA", atendimentoComparecerAte: br("2026-11-10", "14:00").toISOString(), atendimentoResolverAte: br("2026-11-11", "10:00").toISOString() }));
    expect([linha("comparecer")?.[2], linha("resolver")?.[2], selo()]).toEqual(["sem registro", "sem registro", null]);
  });

  it("só um dos dois prometido mostra só a linha dele; contrato que não promete para a prioridade diz isso", async () => {
    await montarCartao(os({ atendimentoResolverAte: null }));
    expect([linha("comparecer")?.[0], linha("resolver")]).toEqual(["NO_PRAZO", null]);

    await montarCartao(os({ prioridade: "ALTA", atendimentoComparecerAte: null, atendimentoResolverAte: null }));
    expect([linha("comparecer"), linha("resolver")]).toEqual([null, null]);
    expect(txt($("[data-sem-promessa]"))).toBe("O contrato não promete prazo de atendimento para a prioridade Alta.");
    expect(txt($("[data-chamado-aberto]"))).toContain("Chamado aberto em 18/11/2026 às 10:00");
    expect(selo()).toBeNull();
  });

  it("OS que não é chamado de cliente em contrato não mostra o cartão: sem contrato, sem abertura, ou preventiva recorrente", async () => {
    for (const extra of [{ contratoId: null }, { chamadoAbertoEm: null }, { origem: "RECORRENTE" }]) {
      await montarCartao(os(extra));
      expect($("[data-cartao='prazo-atendimento']"), JSON.stringify(extra)).toBeNull();
    }
  });
});

/* ═════════ configurações ═════════ */
describe("Configurações › Horário comercial", () => {
  const PADRAO = { dias: [1, 2, 3, 4, 5].map((dia) => ({ dia, inicio: "08:00", fim: "18:00" })) };
  const URL = "/api/configuracoes/horario-comercial";
  async function montarHorario(inicial = PADRAO, podeEditar = true) {
    const [{ HorarioComercialClient }, { Avisos }] = await Promise.all([import("@/components/config/horario-comercial-client"), import("@/components/ui/avisos")]);
    await montar(createElement("div", null, createElement(Avisos, { key: "a" }), createElement(HorarioComercialClient, { key: "t", inicial, podeEditar })));
  }
  const dia = (n: number) => $(`[data-dia='${n}']`)!;
  const ligado = (n: number) => dia(n).querySelector("[role='switch']")!.getAttribute("aria-checked") === "true";
  const horas = (n: number) => [...dia(n).querySelectorAll<HTMLInputElement>("input")].map((i) => i.value);
  const resumo = () => txt($("[data-resumo-horario]"));

  it("a semana começa na segunda; dia sem expediente fica desligado e sem campo de hora", async () => {
    await montarHorario();
    expect($$("[data-dia]").map((l) => [l.getAttribute("data-dia"), txt(l.querySelector("span.font-medium"))]))
      .toEqual([["1", "Segunda"], ["2", "Terça"], ["3", "Quarta"], ["4", "Quinta"], ["5", "Sexta"], ["6", "Sábado"], ["0", "Domingo"]]);
    expect([1, 2, 3, 4, 5, 6, 0].map(ligado)).toEqual([true, true, true, true, true, false, false]);
    expect(horas(1)).toEqual(["08:00", "18:00"]);
    expect(horas(6)).toEqual([]);
    expect(txt(dia(6))).toContain("Sem expediente");
    expect(resumo()).toBe("Horário comercial: segunda a sexta, das 8h às 18h. Os prazos já gravados nas OS não mudam.");
    expect(chamadas).toEqual([]); // abrir a tela não grava nada
  });

  it("ligar o sábado, acertar a hora e salvar: PUT com a jornada inteira, toast, e o resumo acompanha", async () => {
    respostas[`PUT ${URL}`] = { status: 200, corpo: {} };
    await montarHorario();
    await clicar(dia(6).querySelector("[role='switch']"));
    expect(horas(6)).toEqual(["08:00", "18:00"]);
    await escrever($("input[aria-label='Fim do expediente — sábado']"), "12:00");
    expect(resumo()).toContain("segunda a sexta, das 8h às 18h; sábado, das 8h às 12h");
    await clicar($("[data-salvar-horario]"));
    expect(gravacoes()).toEqual([{ url: URL, metodo: "PUT", corpo: { dias: [...PADRAO.dias, { dia: 6, inicio: "08:00", fim: "12:00" }] } }]);
    expect(toasts()).toContain("Horário comercial salvo. Vale para os prazos de atendimento calculados daqui em diante.");
    expect($("[data-erro-horario]")).toBeNull();
  });

  it("valida antes de chamar: fim antes do início e semana sem nenhum dia não vão ao servidor", async () => {
    await montarHorario();
    await escrever($("input[aria-label='Fim do expediente — segunda']"), "07:00");
    await clicar($("[data-salvar-horario]"));
    expect(txt($("[data-erro-horario]"))).toBe(MSG_JORNADA_HORAS);
    expect(gravacoes()).toEqual([]);
    // mexer em qualquer coisa tira a mensagem
    await escrever($("input[aria-label='Fim do expediente — segunda']"), "18:00");
    expect($("[data-erro-horario]")).toBeNull();
    for (const n of [1, 2, 3, 4, 5]) await clicar(dia(n).querySelector("[role='switch']"));
    expect(resumo()).toContain("Complete os horários para salvar.");
    await clicar($("[data-salvar-horario]"));
    expect(txt($("[data-erro-horario]"))).toBe(MSG_JORNADA_VAZIA);
    expect(gravacoes()).toEqual([]);
  });

  it("o servidor recusou: a mensagem dele aparece e nada de toast de sucesso", async () => {
    respostas[`PUT ${URL}`] = { status: 403, corpo: { erro: "Sem permissão para gerenciar as configurações." } };
    await montarHorario();
    const antes = toasts().length; // o aviso de um salvamento anterior pode ainda estar na tela
    await clicar($("[data-salvar-horario]"));
    expect(gravacoes()).toHaveLength(1);
    expect(txt($("[data-erro-horario]"))).toBe("Sem permissão para gerenciar as configurações.");
    expect(toasts()).toHaveLength(antes);
  });

  it("\"Restaurar padrão\" volta a segunda a sexta, das 8h às 18h — e só grava quando salvar", async () => {
    await montarHorario({ dias: [{ dia: 0, inicio: "09:00", fim: "13:00" }, { dia: 6, inicio: "09:00", fim: "13:00" }] });
    expect(resumo()).toContain("sábado e domingo, das 9h às 13h");
    await clicar([...document.querySelectorAll("button")].find((b) => txt(b) === "Restaurar padrão")!);
    expect([1, 2, 3, 4, 5, 6, 0].map(ligado)).toEqual([true, true, true, true, true, false, false]);
    expect(resumo()).toContain("segunda a sexta, das 8h às 18h");
    expect(gravacoes()).toEqual([]);
  });

  it("sem Configurações › gerenciar: lê, mas não muda nem salva", async () => {
    await montarHorario(PADRAO, false);
    expect($("[data-salvar-horario]")).toBeNull();
    expect([...document.querySelectorAll("button")].some((b) => txt(b) === "Restaurar padrão")).toBe(false);
    expect($$<HTMLButtonElement>("[role='switch']").every((b) => b.disabled)).toBe(true);
    expect($$<HTMLInputElement>("[data-dia] input").every((i) => i.disabled)).toBe(true);
    expect(txt($("[data-somente-leitura]"))).toContain("Configurações › gerenciar");
    await clicar(dia(6).querySelector("[role='switch']"));
    expect(ligado(6)).toBe(false);
  });
});

/* ═════════ o sino ═════════ */
describe("Sino: prazo de atendimento vencendo e estourado", () => {
  const ALERTAS = {
    prazosVencidos: 0, etapasVencendoHoje: 0, pedidosPendentes: 0, atendimentosAtraso: 0, chamadosPortal: 0, atendimentoVencendo: 0, atendimentoEstourado: 0,
    checklistPendente: 0, checklistsComAlertas: 0, documentosVencendo: 0, veiculosManutencao: 0, boletosPagos: 0, orcamentosRespondidos: 0, nfPedidos: 0, nfPedidoId: null, total: 0,
  };
  async function sino(alertas: Record<string, unknown>, permissoes: Permissoes) {
    respostas["GET /api/alertas"] = { status: 200, corpo: { ...ALERTAS, ...alertas } };
    const [{ Header }, { PermissoesProvider }] = await Promise.all([import("@/components/layout/header"), import("@/components/providers/permissoes-provider")]);
    const sessao = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role: "OPERADOR", permissoes }, expires: "2099-01-01T00:00:00Z" };
    await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes } as any, createElement(Header, { session: sessao, avatarUrl: null } as any)));
    await clicar([...caixa.querySelectorAll("button")].find((b) => b.querySelector("svg.lucide-bell"))!);
  }
  const links = () => [...caixa.querySelectorAll("[data-sino-menu] a")] as HTMLAnchorElement[];
  const link = (rotulo: string) => links().find((a) => a.textContent?.includes(rotulo)) ?? null;
  const OS = montarPermissoes({ ordens: ["visualizar"] });
  const ESTOURADO = "Prazo de atendimento estourado", VENCENDO = "Prazo de atendimento vencendo";

  it("cada aviso com a sua contagem e o link para a lista de OS já filtrada; o estourado vem antes; não se confunde com \"OS atrasadas\"", async () => {
    await sino({ atendimentoEstourado: 2, atendimentoVencendo: 3, atendimentosAtraso: 4, total: 9 }, OS);
    expect([link(ESTOURADO)?.getAttribute("href"), txt(link(ESTOURADO))]).toEqual(["/ordens?atendimento=estourado&periodo=todos", "Prazo de atendimento estourado2"]);
    expect([link(VENCENDO)?.getAttribute("href"), txt(link(VENCENDO))]).toEqual(["/ordens?atendimento=vencendo&periodo=todos", "Prazo de atendimento vencendo3"]);
    expect(links().indexOf(link(ESTOURADO)!)).toBeLessThan(links().indexOf(link(VENCENDO)!));
    // o prazo de EXECUÇÃO continua com o aviso dele, com o filtro dele
    expect([link("OS atrasadas")?.getAttribute("href"), txt(link("OS atrasadas"))]).toEqual(["/ordens?prazo=atrasadas&periodo=todos", "OS atrasadas4"]);
  });

  it("zero não aparece: o sino não ganha linha parada quando está tudo em dia", async () => {
    await sino({ atendimentoEstourado: 0, atendimentoVencendo: 1, total: 1 }, OS);
    expect(link(ESTOURADO)).toBeNull();
    expect(link(VENCENDO)).not.toBeNull();
  });

  it("quem não vê as OS nunca recebe os avisos (mesmo que a API mande)", async () => {
    await sino({ atendimentoEstourado: 2, atendimentoVencendo: 3, total: 5 }, montarPermissoes({ financeiro: ["visualizar"] }));
    expect(link(ESTOURADO)).toBeNull();
    expect(link(VENCENDO)).toBeNull();
  });
});
