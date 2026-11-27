// @vitest-environment happy-dom
/**
 * Lista de OS na barra enxuta (componente real num DOM de verdade): o período substitui a navegação
 * por dia (por padrão todo o período, com as setas desligadas); os atalhos de teclado continuam
 * (← › período, T = hoje); busca "Pesquisar no período selecionado"; "Mais filtros" recolhe os chips
 * de status/prioridade e os demais filtros; "Limpar filtros" zera tudo menos o período.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";
import { periodoOrdens } from "@/lib/listas/filtros";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: () => {}, replace: nav.replace, back: () => {} }),
  usePathname: () => "/ordens", useSearchParams: () => new URLSearchParams(nav.qs),
}));

let root: Root;
let caixa: HTMLDivElement;
const AGORA = new Date("2026-11-04T01:30:00.000Z"); // terça 03/11/2026 em Brasília
beforeEach(() => { nav.replace.mockClear(); nav.qs = ""; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(AGORA); });
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.useRealTimers(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const tecla = async (key: string) => { await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); }); await esperar(); };
const ultimaUrl = () => String(nav.replace.mock.calls.at(-1)?.[0] ?? "");

const OS1 = { id: "os1", numero: "OS-2026-0001", chamadoNumero: null, origem: "INTERNA", cliente: "Hospital Santa Clara", clienteLogo: null, unidade: "Matriz", responsavel: "Ana", atividades: 1, tecnicos: [], status: "ABERTA", estagio: "ABERTA", prioridade: "NORMAL", criadoEm: "2026-11-02T12:00:00.000Z", previsaoConclusao: null, prazo: null, prazoProprio: false, prazoSituacao: "SEM_PRAZO", prazoTexto: "Sem prazo", atrasoJustificado: null };
async function montar(qs = "", ordens: unknown[] = []) {
  nav.qs = qs;
  if (root) { act(() => root.unmount()); caixa.remove(); } // dois "montar" no mesmo teste: um de cada vez
  const [{ OrdensListaClient }, { PermissoesProvider }, { periodoTela }, { SelecaoMassaProvider }] = await Promise.all([
    import("@/components/ordens/ordens-lista-client"), import("@/components/providers/permissoes-provider"), import("@/lib/periodo"), import("@/components/acoes-massa/selecao"),
  ]);
  const periodo = periodoTela(periodoOrdens(Object.fromEntries(new URLSearchParams(qs).entries()), AGORA));
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais(), children:
      // a página real envolve a lista no provedor da seleção em massa
      createElement(SelecaoMassaProvider as any, { entidade: "ordens", idsPagina: (ordens as { id: string }[]).map((o) => o.id), total: ordens.length, children:
        createElement(OrdensListaClient as any, { ordens, total: ordens.length, pagina: 1, porPagina: 50, periodo, opcoes: { clientes: [], usuarios: [], tiposOs: [], contratos: [] } }),
      }),
    }));
  });
  await esperar();
}

describe("lista de OS: barra enxuta", () => {
  it("tabela profissional: ordena pelo cabeçalho (?sort=&dir=), Abertura desc por padrão; número e nome na fonte única da planilha", async () => {
    await montar("", [OS1]);
    expect($("table[data-tabela-planilha]")).not.toBeNull();
    expect(txt($('th[aria-sort="descending"]'))).toContain("Abertura");
    // Status logo depois do cliente (o estágio é o que se olha primeiro); Prazo não ordena e fica escondida por padrão
    expect($$("[data-ordenar]").map((b) => b.getAttribute("data-ordenar"))).toEqual(["numero", "cliente", "status", "criadoEm", "previsaoConclusao", "prioridade"]);
    await clicar($('[data-ordenar="numero"]'));
    expect(ultimaUrl()).toBe("/ordens?sort=numero&dir=desc");
    const numero = $('tr[data-linha="os1"] td[data-celula="numero"] a')!;
    expect(numero.className).toContain("font-mono");
    expect(numero.className).not.toContain("font-display");
    expect($('tr[data-linha="os1"] td[data-celula="cliente"]')!.getAttribute("title")).toBe("Hospital Santa Clara");
    // a linha inteira abre a OS (o link do número continua, para abrir em nova aba)
    expect($('tr[data-linha="os1"]')!.getAttribute("data-abrir")).toBe("/ordens/os1");
    expect(numero.getAttribute("href")).toBe("/ordens/os1");
    await clicar($('tr[data-linha="os1"] td[data-celula="cliente"]'));
    expect(nav.push).toHaveBeenCalledWith("/ordens/os1");
  });

  it("coluna Status: o ESTÁGIO da OS (o mesmo selo do andamento e as cores do calendário) e, ao lado, só o que pede ação", async () => {
    const os = (id: string, extra: Record<string, unknown>) => ({ ...OS1, id, numero: `OS-${id}`, ...extra });
    await montar("", [
      os("aberta", { estagio: "ABERTA" }), os("agendada", { estagio: "AGENDADA" }), os("execucao", { status: "PAUSADA", estagio: "EM_ANDAMENTO" }),
      os("concluida", { status: "CONCLUIDA", estagio: "CONCLUIDA" }), os("faturada", { status: "CONCLUIDA", estagio: "FATURADA" }), os("cancelada", { status: "CANCELADA", estagio: "CANCELADA" }),
      os("atrasada", { estagio: "EM_ANDAMENTO", prazo: "2026-10-30T00:00:00.000Z", prazoProprio: true, prazoSituacao: "ATRASADO", prazoTexto: "Atrasada 4 dias" }),
      os("hoje", { estagio: "AGENDADA", prazo: "2026-11-03T00:00:00.000Z", prazoSituacao: "VENCE_HOJE", prazoTexto: "Vence hoje" }),
      os("folga", { estagio: "AGENDADA", prazo: "2026-11-20T00:00:00.000Z", prazoSituacao: "NO_PRAZO", prazoTexto: "Faltam 17 dias" }),
      os("justificada", { estagio: "EM_ANDAMENTO", prazo: "2026-10-28T00:00:00.000Z", prazoSituacao: "ATRASADO", prazoTexto: "Atrasada 6 dias", atrasoJustificado: "Cliente ausente" }),
    ]);
    const celula = (id: string) => $(`tr[data-linha="${id}"] td[data-celula="status"]`)!;
    const selo = (id: string) => celula(id).querySelector("[data-estagio]")!;
    // os seis estágios, com o mesmo rótulo da barra de andamento e o tom do sistema de design
    const esperado: Record<string, [string, string]> = {
      aberta: ["Aberta", "previsto"], agendada: ["Agendada", "acento"], execucao: ["Em execução", "atencao"],
      concluida: ["Concluída", "ok"], faturada: ["Faturada", "ok-solido"], cancelada: ["Cancelada", "atrasado"],
    };
    for (const [id, [rotulo, tom]] of Object.entries(esperado)) {
      expect(txt(selo(id)), id).toBe(rotulo);
      expect(selo(id).getAttribute("data-tom"), id).toBe(tom);
    }
    // "Pausada" (status gravado) aparece como o estágio "Em execução", nunca o nome cru do banco
    expect(txt(celula("execucao"))).not.toContain("Pausada");
    // o aviso de prazo mora aqui: só quando pede ação (atrasada, vence hoje); justificado escrito ao lado
    expect(txt(celula("atrasada"))).toBe("Em execuçãoAtrasada 4 dias");
    expect(celula("atrasada").querySelector(".pill-atrasado")).not.toBeNull();
    expect(txt(celula("hoje"))).toBe("AgendadaVence hoje");
    expect(celula("hoje").querySelector(".pill-atencao")).not.toBeNull();
    expect(txt(celula("folga"))).toBe("Agendada");
    expect(txt(celula("justificada"))).toBe("Em execuçãoAtrasada 6 diasJustificado");
    expect(celula("justificada").querySelector("[data-atraso-justificado]")!.getAttribute("title")).toBe("Atraso justificado: Cliente ausente");
    for (const id of ["aberta", "folga", "concluida", "atrasada"]) expect(celula(id).querySelector("[data-atraso-justificado]"), id).toBeNull();
    // os cartões (celular) trazem o mesmo selo
    const cartao = $$("[data-cartoes] > div").find((c) => txt(c).includes("OS-atrasada"))!;
    expect(txt(cartao.querySelector("[data-status-lista]"))).toBe("Em execuçãoAtrasada 4 dias");
    expect(txt(cartao)).toContain("Prazo 30/10/2026"); // prazo PRÓPRIO: o cartão mostra
    const cartaoHoje = $$("[data-cartoes] > div").find((c) => txt(c).includes("OS-hoje"))!;
    expect(txt(cartaoHoje)).not.toContain("Prazo 03/11"); // herdado da prevista: o cartão não repete
  });

  it("Prevista fica; Prazo é escondida por padrão (liga em Colunas) e nunca repete a prevista sem explicação: próprio em preto, herdado apagado com o título", async () => {
    const os = (id: string, extra: Record<string, unknown>) => ({ ...OS1, id, numero: `OS-${id}`, ...extra });
    await montar("", [
      os("proprio", { previsaoConclusao: "2026-11-10T12:00:00.000Z", prazo: "2026-11-20T00:00:00.000Z", prazoProprio: true, prazoSituacao: "NO_PRAZO", prazoTexto: "Faltam 17 dias" }),
      os("herdado", { previsaoConclusao: "2026-11-12T12:00:00.000Z", prazo: "2026-11-12T00:00:00.000Z", prazoProprio: false, prazoSituacao: "NO_PRAZO", prazoTexto: "Faltam 9 dias" }),
      os("sem", { prazo: null, prazoSituacao: "SEM_PRAZO", prazoTexto: "Sem prazo" }),
    ]);
    const cabecalhos = () => $$("table thead th").map(txt);
    expect(cabecalhos()).toContain("Prevista");
    expect(cabecalhos()).not.toContain("Prazo");
    // liga em Colunas
    await clicar($("[data-colunas-menu]"));
    expect($('[data-coluna-opcao="prazo"]')!.getAttribute("aria-checked")).toBe("false");
    await clicar($('[data-coluna-opcao="prazo"]'));
    expect(cabecalhos()).toContain("Prazo");
    const celula = (id: string) => $(`tr[data-linha="${id}"] td[data-celula="prazo"]`)!;
    const prevista = (id: string) => txt($(`tr[data-linha="${id}"] td[data-celula="previsao"]`));
    // prazo próprio: a data, em preto, e diferente da prevista
    expect(txt(celula("proprio"))).toBe("20/11/2026");
    expect(prevista("proprio")).toBe("10/11/2026");
    expect(celula("proprio").querySelector("[data-prazo-proprio]")).not.toBeNull();
    expect(celula("proprio").querySelector("[data-prazo-herdado]")).toBeNull();
    // herdado: a mesma data da prevista, apagada, com o título explicando por quê
    expect(txt(celula("herdado"))).toBe("12/11/2026");
    expect(prevista("herdado")).toBe("12/11/2026");
    const herdado = celula("herdado").querySelector("[data-prazo-herdado]")!;
    expect(herdado.getAttribute("title")).toBe("Sem prazo próprio: vale a data prevista");
    expect(herdado.className).toContain("text-ink-muted");
    expect(celula("herdado").querySelector("[data-prazo-proprio]")).toBeNull();
    // o selo de atraso NÃO mora mais aqui (está no Status)
    for (const id of ["proprio", "herdado"]) expect(celula(id).querySelector("[class*='pill-']"), id).toBeNull();
    expect(txt(celula("sem"))).toBe("—");
    expect(celula("sem").querySelector("[data-prazo-herdado], [data-prazo-proprio]")).toBeNull();
  });

  it("filtro Prazo de atendimento em 'Mais filtros': vencendo e estourado vão para a URL (?atendimento=) — separado do Prazo de execução", async () => {
    await montar();
    await clicar($("[data-mais-filtros]"));
    // os dois filtros de prazo têm cada um o seu nome
    expect([txt($("[data-filtro-opcao=prazo]")), txt($("[data-filtro-opcao=atendimento]"))]).toEqual(["Prazo de execução", "Prazo de atendimento"]);
    await clicar($("[data-filtro-opcao=atendimento]"));
    const sel = $<HTMLSelectElement>("select[aria-label='Prazo de atendimento']")!;
    expect([...sel.options].map((o) => [o.value, o.textContent])).toEqual([["", "Todos"], ["vencendo", "Vencendo"], ["estourado", "Estourado"]]);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, "estourado"); sel.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
    expect(ultimaUrl()).toBe("/ordens?atendimento=estourado");
    // chegando pelo sino (?atendimento=vencendo): o filtro já aparece ligado, conta como ativo e "Limpar filtros" o tira
    await montar("atendimento=vencendo");
    expect(txt($("[data-filtros-ativos]"))).toBe("1");
    expect($$("[data-filtro-caixa]").map((c) => c.getAttribute("data-filtro-caixa"))).toEqual(["atendimento"]);
    expect($<HTMLSelectElement>("select[aria-label='Prazo de atendimento']")!.value).toBe("vencendo");
    await clicar($("[data-limpar-filtros]"));
    expect(ultimaUrl()).toBe("/ordens?");
    // lista vazia só com este filtro ligado (o sino trouxe, mas alguém já resolveu): o "Limpar filtros" do estado vazio aparece e tira o filtro
    nav.replace.mockClear();
    await clicar($$("[data-lista-vazia] button").find((b) => txt(b) === "Limpar filtros") ?? null);
    expect(new URLSearchParams(ultimaUrl().split("?")[1] ?? "").get("atendimento")).toBeNull();
    expect(nav.replace).toHaveBeenCalled();
    // os dois juntos convivem na URL
    await montar("prazo=atrasadas&atendimento=estourado");
    expect(txt($("[data-filtros-ativos]"))).toBe("2");
    expect($$("[data-filtro-caixa]").map((c) => c.getAttribute("data-filtro-caixa")).sort()).toEqual(["atendimento", "prazo"]);
  });

  it("filtro Prazo em 'Mais filtros': atrasadas, vencem hoje e com atraso justificado vão para a URL (?prazo=) e contam como filtro ativo", async () => {
    await montar();
    await clicar($("[data-mais-filtros]")); await clicar($("[data-filtro-opcao=prazo]"));
    const sel = $<HTMLSelectElement>("select[aria-label='Prazo de execução']")!;
    expect([...sel.options].map((o) => [o.value, o.textContent])).toEqual([["", "Todos"], ["atrasadas", "Atrasadas"], ["hoje", "Vencem hoje"], ["justificadas", "Com atraso justificado"]]);
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, "atrasadas"); sel.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
    expect(ultimaUrl()).toBe("/ordens?prazo=atrasadas");
    // chegando pelo sino/dashboard (?prazo=atrasadas): o filtro já aparece ligado, e "Limpar filtros" o tira
    await montar("prazo=atrasadas");
    expect(txt($("[data-filtros-ativos]"))).toBe("1");
    expect($$("[data-filtro-caixa]").map((c) => c.getAttribute("data-filtro-caixa"))).toEqual(["prazo"]);
    expect($<HTMLSelectElement>("select[aria-label='Prazo de execução']")!.value).toBe("atrasadas");
    await clicar($("[data-limpar-filtros]"));
    expect(ultimaUrl()).toBe("/ordens?");
    // lista vazia com o filtro ligado: o "Limpar filtros" do estado vazio aparece e também tira o prazo
    nav.replace.mockClear();
    await clicar($$("[data-lista-vazia] button").find((b) => txt(b) === "Limpar filtros")!);
    expect(ultimaUrl()).toBe("/ordens?");
  });

  it("por padrão o mês atual (setas ligadas); T vai para hoje; ← › andam o dia; a barra tem a busca e 'Mais filtros' fechado", async () => {
    await montar();
    expect(txt($("[data-mes-rotulo]"))).toBe("Novembro de 2026");
    expect($<HTMLButtonElement>("[data-mes-anterior]")!.disabled).toBe(false);
    expect($<HTMLInputElement>("[data-busca]")!.placeholder).toBe("Pesquisar");
    expect(document.body.textContent).toContain("Pesquisar no período selecionado"); // o rótulo em cima do campo
    expect($("[data-painel-filtros]")).toBeNull();
    await tecla("t");
    expect(ultimaUrl()).toBe("/ordens?periodo=hoje");
    await montar("periodo=hoje");
    expect(txt($("[data-mes-rotulo]"))).toBe("Hoje, 03/11/2026");
    await tecla("ArrowRight");
    expect(ultimaUrl()).toBe("/ordens?periodo=hoje&ref=2026-11-04");
    await tecla("ArrowLeft");
    expect(ultimaUrl()).toBe("/ordens?periodo=hoje&ref=2026-11-02");
  });

  it("os filtros ativos aparecem sozinhos; 'Mais filtros' lista os demais; 'Limpar filtros' zera os filtros e a busca, não o período", async () => {
    await montar("periodo=semana&status=ABERTA,AGENDADA&busca=split&clienteId=c1");
    expect(txt($("[data-filtros-ativos]"))).toBe("2"); // status + clienteId (a busca não conta)
    expect($$("[data-filtro-caixa]").map((c) => c.getAttribute("data-filtro-caixa"))).toEqual(["status", "clienteId"]); // os ativos já aparecem
    await clicar($("[data-mais-filtros]")); await clicar($("[data-filtro-opcao=prioridade]")); // e a prioridade entra pelo menu
    const chips = $$("[data-painel-filtros] button[aria-pressed]");
    expect(chips.length).toBeGreaterThan(8);
    expect(chips.filter((c) => c.getAttribute("aria-pressed") === "true").map(txt)).toEqual(["Aberta", "Agendada"]);
    await clicar(chips.find((c) => txt(c) === "Agendada")!);
    expect(ultimaUrl()).toBe("/ordens?periodo=semana&status=ABERTA&busca=split&clienteId=c1");
    await clicar($("[data-limpar-filtros]"));
    expect(ultimaUrl()).toBe("/ordens?periodo=semana");
    // O "Limpar filtros" do estado vazio faz o mesmo (e também deixa o período)
    nav.replace.mockClear();
    await clicar($$("[data-lista-vazia] button").find((b) => txt(b) === "Limpar filtros")!);
    expect(ultimaUrl()).toBe("/ordens?periodo=semana");
  });
});
