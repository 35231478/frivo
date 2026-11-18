// @vitest-environment happy-dom
/**
 * Nova OS — ajustes da tela, num DOM de verdade (happy-dom), API simulada:
 *  - datas: "Agendar para" (data+hora, vai para a 1ª atividade/calendário) no lugar da antiga
 *    "Previsão de conclusão"; "Prazo para finalizar" (data) é o PRAZO DE EXECUÇÃO da OS (prazoExecucao),
 *    campo próprio — a tela não manda mais a data prevista (previsaoConclusao), que é agenda;
 *  - equipe: lista com os integrantes discretos embaixo de cada equipe (líder primeiro), por teclado;
 *    equipe e colaboradores com o mesmo botão (ícone dentro, sem deslocar o alinhamento);
 *  - "Vincular equipamento" pela gaveta: exige cliente; equipamentos de todos os locais do cliente,
 *    filtro pelo endereço, busca (nome/marca/modelo/BTU/TR/TAG/local), selecionar todos, contador,
 *    escolhidos que o filtro esconde, estado vazio com cadastro rápido (só com permissão).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, permissoesVazias } from "@/lib/permissoes";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/nova", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown } | ((url: string, init: RequestInit) => { status: number; corpo: unknown })>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => {
  await Promise.all([import("@/app/(dashboard)/ordens/nova/page"), import("@/components/providers/permissoes-provider")]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  nav.push.mockClear();
  respostas = {
    "/api/clientes": { status: 200, corpo: [{ id: "c1", nome: "Hospital Santa Luzia" }, { id: "c2", nome: "Padaria Pão Dourado" }] },
    "/api/unidades": { status: 200, corpo: [{ id: "un1", nome: "Matriz" }, { id: "un2", nome: "Anexo — Bloco B" }] },
    "/api/equipamentos": { status: 200, corpo: EQUIPAMENTOS },
    "/api/contratos": { status: 200, corpo: [] },
    "/api/tipos-os": { status: 200, corpo: [] },
    "/api/tecnicos": { status: 200, corpo: [{ id: "t1", nome: "João Silva", competencias: [] }, { id: "t2", nome: "Maria Souza", competencias: [] }] },
    // t9 não está na lista de colaboradores (inativo): não aparece entre os integrantes
    "/api/equipes": { status: 200, corpo: [
      { id: "eq1", nome: "Alfa", cor: "#0EA5E9", liderId: "t2", membroIds: ["t1", "t2", "t9"] },
      { id: "eq2", nome: "Beta", cor: null, liderId: null, membroIds: ["t1"] },
    ] },
    "POST /api/ordens": { status: 201, corpo: { id: "osNova" } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.includes(" ") ? k.split(" ") : ["GET", k]; return m === metodo && url.startsWith(u); })
      .sort((a, b) => b.length - a.length)[0];
    const r0 = chave ? respostas[chave] : { status: 200, corpo: {} };
    const r = typeof r0 === "function" ? r0(url, init) : r0;
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

const EQUIPAMENTOS = [
  { id: "eqA", nome: "Split Recepção", marca: "Daikin", modelo: "FTXS", capacidade: "12.000 BTU/h", patrimonio: "AC-01", setor: "Recepção", ativo: true,
    unidadeId: "un1", unidade: { id: "un1", nome: "Matriz" }, tipoEquipamento: { id: "te1", nome: "Split Hi-Wall" } },
  { id: "eqB", nome: "Split Sala 2", marca: "LG", modelo: "Dual Inverter", capacidade: "18.000 BTU/h", patrimonio: "AC-02", ativo: true,
    unidadeId: "un1", unidade: { id: "un1", nome: "Matriz" }, tipoEquipamento: { id: "te1", nome: "Split Hi-Wall" } },
  { id: "eqC", nome: "Chiller", marca: "Carrier", modelo: "30RB", potencia: "3 TR", patrimonio: "CH-01", ativo: true,
    unidadeId: "un2", unidade: { id: "un2", nome: "Anexo — Bloco B" }, tipoEquipamento: null },
];

async function montar(url: string, permissoes = permissoesTotais()) {
  window.history.replaceState(null, "", url);
  const [{ PermissoesProvider }, { default: NovaOrdemPage }] = await Promise.all([
    import("@/components/providers/permissoes-provider"), import("@/app/(dashboard)/ordens/nova/page"),
  ]);
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(NovaOrdemPage) })); });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)];
// A gaveta é um portal no <body>: procura no documento todo
const $d = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$d = (sel: string) => [...document.querySelectorAll(sel)];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/ /g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
async function escolher(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}
async function tecla(el: Element | null, key: string) {
  await act(async () => { el!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
  await esperar();
}
/** O bloco (FormField) de um rótulo. */
// O campo inteiro (FormField): com ⓘ, o rótulo fica numa linha própria dentro dele
const campo = (rotulo: string) => [...caixa.querySelectorAll("label")].find((l) => txt(l).replace(/\*$/, "").trim() === rotulo)?.closest(".flex-col") ?? null;
/** A seção (FormSection) de um título. */
const secao = (titulo: string) => [...caixa.querySelectorAll("h3")].find((h) => txt(h) === titulo)?.parentElement ?? null;
async function escolherNoSelect(rotulo: string, opcao: string) {
  await clicar(campo(rotulo)!.querySelector("button"));
  await clicar([...campo(rotulo)!.querySelectorAll("button")].find((b) => txt(b) === opcao) ?? null);
}
const abrirOs = () => clicar([...caixa.querySelectorAll("button")].find((b) => txt(b).includes("Abrir ordem de serviço")) ?? null);
const post = () => chamadas.find((c) => c.metodo === "POST" && c.url === "/api/ordens");
const opcoesGaveta = () => $$d("[data-opcao-equipamento]").map((o) => o.getAttribute("data-opcao-equipamento"));
const marcado = (id: string) => $d<HTMLInputElement>(`[data-opcao-equipamento="${id}"] input`)!.checked;
const contador = () => txt($d("[data-contador-gaveta]"));
const escolhidosNaPagina = () => $$("[data-equipamento-escolhido]").map((o) => o.getAttribute("data-equipamento-escolhido"));

describe("datas da Nova OS", () => {
  it("“Agendar para” (data e hora) fica nas informações gerais; “Prazo para finalizar” (data) em quem executa; sem “Previsão de conclusão”", async () => {
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva");
    expect(caixa.textContent).not.toContain("Previsão de conclusão");

    const agendar = campo("Agendar para")!;
    expect(secao("Informações gerais")!.contains(agendar)).toBe(true);
    expect(agendar.querySelector("input[aria-label='Agendar para — data']")).not.toBeNull();
    expect(agendar.querySelector("input[aria-label='Agendar para — hora']")).not.toBeNull();
    // Princípio 7: a explicação vai para o ⓘ do rótulo
    const dicaAgendar = agendar.querySelector("[data-dica]")!;
    expect(dicaAgendar.getAttribute("aria-label")).toBe("Ajuda: Agendar para");
    expect(document.getElementById(dicaAgendar.getAttribute("aria-describedby")!)!.textContent).toBe("Opcional. Data e hora da primeira atividade, exibida no calendário.");
    expect(txt(agendar)).not.toContain("calendário");

    const prazo = campo("Prazo para finalizar")!;
    expect(secao("Quem executa")!.contains(prazo)).toBe(true);
    expect(prazo.querySelectorAll("input[data-input-data]")).toHaveLength(1);
    expect(prazo.querySelector("[data-input-hora]")).toBeNull(); // só a data
    const dicaPrazo = prazo.querySelector("[data-dica]")!;
    expect(document.getElementById(dicaPrazo.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Opcional. Após esta data, a OS é sinalizada como atrasada. Se o tipo de OS tem prazo padrão, o campo já vem sugerido a partir do dia agendado — dá para ajustar.");
  });

  describe("prazo sugerido pelo tipo de OS", () => {
    const prazo = () => $<HTMLInputElement>("input[aria-label='Prazo para finalizar']")!;
    const dicaSugestao = () => txt([...campo("Prazo para finalizar")!.querySelectorAll("p")].find((p) => txt(p).startsWith("Sugerido")) ?? null);
    /** Escolhe o tipo no seletor (o 1º botão do campo é o ⓘ da ajuda: o seletor é o seguinte) */
    const escolherTipo = async (nome: string) => {
      const c = campo("Tipo de OS")!;
      await clicar(c.querySelector("button:not([data-dica])"));
      await clicar([...c.querySelectorAll("button:not([data-dica])")].filter((b) => txt(b) === nome).at(-1) ?? null);
    };
    beforeEach(() => {
      const todos = [{ id: "tp3" }, { id: "tp0" }, { id: "tpS" }];
      respostas["/api/tipos-os"] = { status: 200, corpo: [
        { id: "tp3", nome: "Corretiva", ativo: true, prazoExecucaoDias: 3 },
        { id: "tp0", nome: "Emergência", ativo: true, prazoExecucaoDias: 0 },
        { id: "tpS", nome: "Vistoria", ativo: true, prazoExecucaoDias: null },
      ] };
      respostas["/api/tecnicos"] = { status: 200, corpo: [{ id: "t1", nome: "João Silva", competencias: todos }, { id: "t2", nome: "Maria Souza", competencias: todos }] };
    });

    it("aparece com tipo + agendamento, acompanha os dois, e some com tipo sem padrão", async () => {
      await montar("/ordens/nova?clienteId=c1&descricao=Corretiva");
      expect(prazo().value).toBe("");
      await digitar($("input[aria-label='Agendar para — data']"), "18112026");
      await digitar($("input[aria-label='Agendar para — hora']"), "1430");
      expect(prazo().value).toBe(""); // só o agendamento não sugere nada
      await escolherTipo("Corretiva");
      expect(prazo().value).toBe("21/11/2026"); // 18/11 + 3 dias
      expect(dicaSugestao()).toBe("Sugerido pelo tipo de OS: 3 dias após o agendamento.");
      await digitar($("input[aria-label='Agendar para — data']"), "20112026");
      expect(prazo().value).toBe("23/11/2026"); // acompanhou o reagendamento
      await escolherTipo("Emergência");
      expect(prazo().value).toBe("20/11/2026");
      expect(dicaSugestao()).toBe("Sugerido pelo tipo de OS: no dia agendado.");
      await escolherTipo("Vistoria"); // tipo sem prazo padrão: o campo volta a ficar vazio
      expect(prazo().value).toBe("");
      expect(dicaSugestao()).toBe("");
    });

    it("é editável: depois que a pessoa digita, o prazo dela fica (não é sobrescrito) — e dá para voltar ao sugerido", async () => {
      await montar("/ordens/nova?clienteId=c1&descricao=Corretiva");
      await digitar($("input[aria-label='Agendar para — data']"), "18112026");
      await digitar($("input[aria-label='Agendar para — hora']"), "1430");
      await escolherTipo("Corretiva");
      await digitar(prazo(), "30112026");
      expect(dicaSugestao()).toBe("");
      await digitar($("input[aria-label='Agendar para — data']"), "19112026"); // mudar o agendamento não mexe no que ela digitou
      expect(prazo().value).toBe("30/11/2026");
      const voltar = $("[data-usar-prazo-sugerido]")!;
      expect(txt(voltar)).toBe("Usar o prazo do tipo de OS (22/11/2026)");
      await clicar(voltar);
      expect(prazo().value).toBe("22/11/2026");
      expect($("[data-usar-prazo-sugerido]")).toBeNull();
      await clicar($("[data-seletor-equipe] button"));
      await clicar($('[data-opcao-equipe="eq2"]'));
      await abrirOs();
      expect(post()!.corpo).toMatchObject({ prazoExecucao: "2026-11-22", execucao: { tipoOsId: "tp3" } });
      expect("usarPrazoPadrao" in post()!.corpo).toBe(false);
    });

    it("apagar o prazo sugerido: a OS vai SEM prazo e o servidor é avisado para não reaplicar o padrão do tipo", async () => {
      await montar("/ordens/nova?clienteId=c1&descricao=Corretiva");
      await digitar($("input[aria-label='Agendar para — data']"), "18112026");
      await digitar($("input[aria-label='Agendar para — hora']"), "1430");
      await escolherTipo("Corretiva");
      expect(prazo().value).toBe("21/11/2026");
      await digitar(prazo(), "");
      expect(prazo().value).toBe("");
      await clicar($("[data-seletor-equipe] button"));
      await clicar($('[data-opcao-equipe="eq2"]'));
      await abrirOs();
      expect(post()!.corpo).toMatchObject({ prazoExecucao: "", usarPrazoPadrao: false });
    });
  });

  it("o prazo vai como prazoExecucao (o prazo de execução da OS), e NÃO como data prevista; o agendamento vai como dataAgendada da 1ª atividade (hora de Brasília)", async () => {
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva");
    await digitar($("input[aria-label='Agendar para — data']"), "18112026");
    await digitar($("input[aria-label='Agendar para — hora']"), "1430");
    await digitar($("input[aria-label='Prazo para finalizar']"), "20112026");
    expect($<HTMLInputElement>("input[aria-label='Prazo para finalizar']")!.value).toBe("20/11/2026");
    await clicar($("[data-seletor-equipe] button"));
    await clicar($('[data-opcao-equipe="eq2"]'));
    await abrirOs();
    expect(post()!.corpo).toMatchObject({
      clienteId: "c1", prazoExecucao: "2026-11-20",
      execucao: { dataAgendada: "2026-11-18T17:30:00.000Z", equipeId: "eq2", tecnicoIds: ["t1"] },
    });
    // prazo e agenda não se misturam mais: a tela não escreve a data prevista
    expect("previsaoConclusao" in post()!.corpo).toBe(false);
    expect(nav.push).toHaveBeenCalledWith("/ordens/osNova");
  });

  it("os dois campos são opcionais: sem eles vai vazio (sem prazo, sem agendamento)", async () => {
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva");
    await clicar($("[data-seletor-equipe] button"));
    await clicar($('[data-opcao-equipe="eq2"]'));
    await abrirOs();
    expect(post()!.corpo.prazoExecucao).toBe("");
    expect("previsaoConclusao" in post()!.corpo).toBe(false);
    expect(post()!.corpo.execucao.dataAgendada).toBeNull();
  });
});

describe("chamado do cliente: a hora de abertura é do sistema (Prazos da OS — PR 4)", () => {
  const CONTRATOS = { "/api/contratos": { status: 200, corpo: [{ id: "ct1", numero: "CT-101" }] } };
  const contrato = () => campo("Contrato vinculado")!.querySelector("select");
  const abertura = () => ({ data: $<HTMLInputElement>("input[aria-label='Chamado aberto em — data']"), hora: $<HTMLInputElement>("input[aria-label='Chamado aberto em — hora']") });
  const executor = async () => { await clicar($("[data-seletor-equipe] button")); await clicar($('[data-opcao-equipe="eq2"]')); };

  it("sem contrato não há o que marcar; com contrato, \"Chamado do cliente\" mostra a data e a hora de agora, preenchidas e TRAVADAS", async () => {
    Object.assign(respostas, CONTRATOS);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-18T12:17:00.000Z") }); // 09:17 em Brasília
    try {
      await montar("/ordens/nova?clienteId=c1&descricao=Chiller%20desarmando");
      expect($("[data-e-chamado]")).toBeNull();
      await escolher(contrato(), "ct1");
      expect($<HTMLInputElement>("[data-e-chamado]")!.checked).toBe(false);
      expect(abertura().data).toBeNull();
      await clicar($("[data-e-chamado]"));
      const { data, hora } = abertura();
      expect([data!.value, hora!.value]).toEqual(["18/11/2026", "09:17"]);
      expect([data!.disabled, hora!.disabled]).toEqual([true, true]);
      // não é obrigatório nem editável: nada de asterisco, e a tela diz de onde vem a hora
      expect(txt(campo("Chamado aberto em"))).toContain("Preenchido pelo sistema ao salvar. Não pode ser alterado.");
      expect(txt(campo("Chamado aberto em"))).not.toContain("*");
      // o calendário do campo também fica travado
      expect([...campo("Chamado aberto em")!.querySelectorAll("button")].every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("ao salvar, a tela só diz que é um chamado — a hora não sai do navegador (quem grava é o servidor)", async () => {
    Object.assign(respostas, CONTRATOS);
    await montar("/ordens/nova?clienteId=c1&descricao=Chiller%20desarmando");
    await escolher(contrato(), "ct1");
    await clicar($("[data-e-chamado]"));
    await executor();
    await abrirOs();
    expect(post()!.corpo).toMatchObject({ clienteId: "c1", contratoId: "ct1", chamadoDoCliente: true });
    expect("chamadoAbertoEm" in post()!.corpo).toBe(false);
    expect(nav.push).toHaveBeenCalledWith("/ordens/osNova");
  });

  it("sem marcar (ou desmarcando), a OS vai como OS comum; tirar o contrato some com o marcador e não manda nada", async () => {
    Object.assign(respostas, CONTRATOS);
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva");
    await escolher(contrato(), "ct1");
    await clicar($("[data-e-chamado]"));
    await clicar($("[data-e-chamado]")); // desmarcou
    expect(abertura().data).toBeNull();
    await executor();
    await abrirOs();
    expect("chamadoDoCliente" in post()!.corpo).toBe(false);

    chamadas.length = 0;
    act(() => root.unmount()); caixa.remove();
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva");
    await escolher(contrato(), "ct1");
    await clicar($("[data-e-chamado]"));
    await escolher(contrato(), ""); // voltou para "Sem contrato"
    expect($("[data-e-chamado]")).toBeNull();
    await executor();
    await abrirOs();
    expect("chamadoDoCliente" in post()!.corpo).toBe(false);
  });
});

describe("equipe: integrantes discretos na lista", () => {
  it("cada equipe mostra os integrantes embaixo (líder primeiro, só quem é colaborador); escolher preenche os colaboradores", async () => {
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva");
    const botao = $<HTMLButtonElement>("[data-seletor-equipe] button")!;
    expect(botao.getAttribute("aria-haspopup")).toBe("listbox");
    expect(botao.getAttribute("aria-expanded")).toBe("false");
    await clicar(botao);
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    const lista = $("[role=listbox]")!;
    expect(lista.getAttribute("aria-label")).toBe("Equipes");
    expect($$("[role=option]").map((o) => o.getAttribute("data-opcao-equipe"))).toEqual(["sem-equipe", "eq1", "eq2"]);
    const alfa = $('[data-opcao-equipe="eq1"] [data-integrantes]')!;
    expect(txt(alfa)).toBe("Maria Souza, João Silva");
    expect(alfa.className).toContain("text-xs");
    expect(alfa.className).toContain("text-ink-muted");
    expect(alfa.getAttribute("title")).toBe("Maria Souza, João Silva");
    expect(txt($('[data-opcao-equipe="eq2"] [data-integrantes]'))).toBe("João Silva");
    expect($('[data-opcao-equipe="sem-equipe"] [data-integrantes]')).toBeNull();

    await clicar($('[data-opcao-equipe="eq1"]'));
    expect($("[role=listbox]")).toBeNull();
    expect(txt($("[data-equipe-escolhida]"))).toBe("Alfa · 2 integrantes");
    await abrirOs();
    expect(post()!.corpo.execucao).toMatchObject({ equipeId: "eq1", tecnicoIds: expect.arrayContaining(["t1", "t2"]) });
    expect(post()!.corpo.execucao.tecnicoIds).not.toContain("t9");
  });

  it("por teclado: seta abre, setas/Home/End andam, Enter escolhe, Esc fecha e devolve o foco", async () => {
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva");
    const botao = $<HTMLButtonElement>("[data-seletor-equipe] button")!;
    await tecla(botao, "ArrowDown");
    const lista = () => $("[role=listbox]")!;
    expect(document.activeElement).toBe(lista());
    const ativa = () => document.getElementById(lista().getAttribute("aria-activedescendant")!)!.getAttribute("data-opcao-equipe");
    expect(ativa()).toBe("sem-equipe");
    await tecla(lista(), "ArrowDown");
    expect(ativa()).toBe("eq1");
    await tecla(lista(), "End");
    expect(ativa()).toBe("eq2");
    await tecla(lista(), "ArrowDown"); // não passa do último
    expect(ativa()).toBe("eq2");
    await tecla(lista(), "Home");
    await tecla(lista(), "ArrowDown");
    await tecla(lista(), "Enter");
    expect($("[role=listbox]")).toBeNull();
    expect(txt($("[data-equipe-escolhida]"))).toContain("Alfa");
    expect(document.activeElement).toBe(botao);

    await clicar(botao);
    expect($('[data-opcao-equipe="eq1"]')!.getAttribute("aria-selected")).toBe("true");
    expect($('[data-opcao-equipe="eq2"]')!.getAttribute("aria-selected")).toBe("false");
    expect(ativa()).toBe("eq1"); // reabre na escolhida
    await tecla(lista(), "Escape");
    expect($("[role=listbox]")).toBeNull();
    expect(document.activeElement).toBe(botao);
    expect(txt($("[data-equipe-escolhida]"))).toContain("Alfa"); // Esc não muda a escolha
  });

  it("equipe e colaboradores alinhados: mesmo botão de largura total, ícone por dentro (nada ao lado deslocando)", async () => {
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva");
    const tecnicos = $("[data-seletor-tecnicos]")!;
    const equipe = $("[data-seletor-equipe]")!;
    expect(equipe.parentElement).toBe(tecnicos); // sem wrapper com ícone do lado
    const botaoEquipe = equipe.querySelector("button")!;
    const botaoColab = [...tecnicos.querySelectorAll("button")].find((b) => txt(b).includes("…ou escolha colaboradores"))!;
    for (const b of [botaoEquipe, botaoColab]) {
      for (const c of ["w-full", "px-3", "py-2.5", "rounded-lg", "text-sm"]) expect(b.className.split(/\s+/)).toContain(c);
      expect(b.firstElementChild!.querySelector("svg")).not.toBeNull(); // ícone dentro, antes do texto
    }
  });
});

describe("vincular equipamento pela gaveta", () => {
  it("sem cliente: avisa para escolher o cliente primeiro e não abre nem busca nada", async () => {
    await montar("/ordens/nova");
    expect(txt($("[data-vincular-equipamento]"))).toBe("Vincular equipamento");
    await clicar($("[data-vincular-equipamento]"));
    const aviso = $("[data-aviso-sem-cliente]")!;
    expect(aviso.getAttribute("role")).toBe("alert");
    expect(txt(aviso)).toBe("Selecione o cliente antes: os equipamentos vêm dos endereços dele.");
    expect($("[data-vincular-equipamento]")!.getAttribute("aria-describedby")).toBe(aviso.id);
    expect($d("[data-gaveta-equipamentos]")).toBeNull();
    expect(chamadas.some((c) => c.url.startsWith("/api/equipamentos"))).toBe(false);

    await escolherNoSelect("Cliente", "Hospital Santa Luzia");
    expect($("[data-aviso-sem-cliente]")).toBeNull();
  });

  it("abre filtrada pelo endereço da OS, com todos os locais do cliente a um clique; busca por TAG, BTU (sem ponto), TR e local", async () => {
    await montar("/ordens/nova?clienteId=c1&unidadeId=un1&descricao=Preventiva");
    await clicar($("[data-vincular-equipamento]"));
    const dialogo = $d("[role=dialog]")!;
    expect(txt(document.getElementById(dialogo.getAttribute("aria-labelledby")!))).toBe("Vincular equipamentos à OS");
    expect(chamadas.filter((c) => c.url.startsWith("/api/equipamentos")).map((c) => c.url)).toEqual(["/api/equipamentos?clienteId=c1&resumo=1"]);

    const filtro = $d<HTMLSelectElement>("[data-filtro-local]")!;
    expect(filtro.value).toBe("un1");
    expect([...filtro.options].map((o) => txt(o))).toEqual(["Todos os locais (3)", "Anexo — Bloco B (1)", "Matriz (2)"]);
    expect(opcoesGaveta()).toEqual(["eqA", "eqB"]);
    expect(txt($d('[data-opcao-equipamento="eqA"]'))).toContain("12.000 BTU/h");
    expect(txt($d('[data-opcao-equipamento="eqA"]'))).toContain("TAG AC-01");

    const busca = $d<HTMLInputElement>("input[aria-label='Pesquisar equipamento']")!;
    await digitar(busca, "ac-02");
    expect(opcoesGaveta()).toEqual(["eqB"]);
    await digitar(busca, "12000");
    expect(opcoesGaveta()).toEqual(["eqA"]);
    await digitar(busca, "recepcao daikin"); // sem acento, várias palavras
    expect(opcoesGaveta()).toEqual(["eqA"]);
    await digitar(busca, "3 tr");
    expect(opcoesGaveta()).toEqual([]);
    expect(txt($d("[data-gaveta-sem-resultado]"))).toContain("em Matriz");

    await escolher(filtro, "");
    expect(opcoesGaveta()).toEqual(["eqC"]);
    expect(txt($d('[data-opcao-equipamento="eqC"]'))).toContain("Anexo — Bloco B"); // com todos os locais, mostra o local
    await digitar(busca, "anexo");
    expect(opcoesGaveta()).toEqual(["eqC"]);
    await digitar(busca, "");
    expect(opcoesGaveta()).toEqual(["eqC", "eqA", "eqB"]); // por local, depois por nome
  });

  it("selecionar todos / desmarcar, contador, e confirmar leva a lista para a OS (na 1ª atividade)", async () => {
    await montar("/ordens/nova?clienteId=c1&unidadeId=un1&descricao=Preventiva");
    await clicar($("[data-vincular-equipamento]"));
    const confirmar = () => $d<HTMLButtonElement>("[data-confirmar-equipamentos]")!;
    expect(confirmar().disabled).toBe(true);
    expect(contador()).toBe("0 selecionados");

    const todos = () => $d<HTMLInputElement>("[data-selecionar-todos]")!;
    await clicar(todos());
    expect(contador()).toBe("2 selecionados");
    expect(txt(todos().parentElement)).toContain("Desmarcar todos");
    await clicar(todos());
    expect(contador()).toBe("0 selecionados");
    await clicar($d('[data-opcao-equipamento="eqB"] input'));
    expect(todos().indeterminate).toBe(true);
    expect(txt(todos().parentElement)).toContain("Selecionar todos");

    await escolher($d("[data-filtro-local]"), "");
    await clicar($d('[data-opcao-equipamento="eqC"] input'));
    expect(contador()).toBe("2 selecionados");
    expect(txt(confirmar())).toContain("Vincular 2 equipamentos");
    await clicar(confirmar());

    expect(escolhidosNaPagina()).toEqual(["eqB", "eqC"]);
    expect(txt($("[data-qtd-atendidos]"))).toBe("2 equipamentos selecionados");
    expect(txt($("[data-vincular-equipamento]"))).toBe("Editar equipamentos");

    await clicar($("[data-seletor-equipe] button"));
    await clicar($('[data-opcao-equipe="eq2"]'));
    await abrirOs();
    expect(post()!.corpo).toMatchObject({ clienteId: "c1", unidadeId: "un1", equipamentoIds: ["eqB", "eqC"] });
  });

  it("reabrir: os já escolhidos vêm marcados e primeiro; os que o filtro esconde aparecem à parte e dá para tirar", async () => {
    await montar("/ordens/nova?clienteId=c1&unidadeId=un1&descricao=Preventiva");
    await clicar($("[data-vincular-equipamento]"));
    await escolher($d("[data-filtro-local]"), "");
    await clicar($d('[data-opcao-equipamento="eqB"] input'));
    await clicar($d('[data-opcao-equipamento="eqC"] input'));
    await clicar($d("[data-confirmar-equipamentos]"));
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); }); // animação de saída da gaveta

    await clicar($("[data-vincular-equipamento]"));
    expect($d<HTMLSelectElement>("[data-filtro-local]")!.value).toBe("un1"); // volta ao endereço da OS
    expect(opcoesGaveta()).toEqual(["eqB", "eqA"]); // escolhido primeiro
    expect(marcado("eqB")).toBe(true);
    expect(marcado("eqA")).toBe(false);
    const fora = $d("[data-ja-selecionados]")!;
    expect(txt(fora)).toContain("1 selecionado fora deste filtro");
    expect(txt(fora)).toContain("Chiller — Carrier 30RB");
    await clicar(fora.querySelector("button[aria-label='Tirar Chiller — Carrier 30RB']"));
    expect($d("[data-ja-selecionados]")).toBeNull();
    expect(contador()).toBe("1 selecionado");
    await clicar($d("[data-confirmar-equipamentos]"));
    expect(escolhidosNaPagina()).toEqual(["eqB"]);

    // Cancelar não muda nada
    await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
    await clicar($("[data-vincular-equipamento]"));
    await clicar($d('[data-opcao-equipamento="eqA"] input'));
    await clicar([...document.querySelectorAll("[role=dialog] button")].find((b) => txt(b) === "Cancelar") ?? null);
    expect(escolhidosNaPagina()).toEqual(["eqB"]);

    // Tirar direto na página
    await clicar($("button[aria-label='Tirar Split Sala 2 — LG Dual Inverter da OS']"));
    expect($("[data-equipamentos-escolhidos]")).toBeNull();
    expect(txt($("[data-vincular-equipamento]"))).toBe("Vincular equipamento");
  });

  it("trocar o endereço mantém os escolhidos (são do mesmo cliente); trocar o cliente limpa", async () => {
    await montar("/ordens/nova?clienteId=c1&unidadeId=un1&descricao=Preventiva");
    await clicar($("[data-vincular-equipamento]"));
    await clicar($d('[data-opcao-equipamento="eqA"] input'));
    await clicar($d("[data-confirmar-equipamentos]"));
    expect(escolhidosNaPagina()).toEqual(["eqA"]);

    await escolherNoSelect("Endereço do cliente", "Anexo — Bloco B");
    expect(escolhidosNaPagina()).toEqual(["eqA"]);
    await escolherNoSelect("Cliente", "Padaria Pão Dourado");
    expect(escolhidosNaPagina()).toEqual([]);
    expect(txt($("[data-vincular-equipamento]"))).toBe("Vincular equipamento");
  });

  it("mais de 5 escolhidos: a página mostra 5 e “Mostrar todos”", async () => {
    respostas["/api/equipamentos"] = { status: 200, corpo: Array.from({ length: 7 }, (_, i) => ({
      id: `e${i + 1}`, nome: `Split ${i + 1}`, marca: "Daikin", modelo: "FTXS", ativo: true, unidadeId: "un1", unidade: { id: "un1", nome: "Matriz" },
    })) };
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva");
    await clicar($("[data-vincular-equipamento]"));
    await clicar($d("[data-selecionar-todos]"));
    await clicar($d("[data-confirmar-equipamentos]"));
    expect(txt($("[data-qtd-atendidos]"))).toBe("7 equipamentos selecionados");
    expect(escolhidosNaPagina()).toHaveLength(5);
    await clicar($("[data-ver-todos-atendidos]"));
    expect(escolhidosNaPagina()).toHaveLength(7);
    expect(txt($("[data-ver-todos-atendidos]"))).toBe("Mostrar menos");
  });

  it("cliente sem equipamento: estado vazio com cadastro rápido — o novo entra na lista já marcado", async () => {
    respostas["/api/equipamentos"] = { status: 200, corpo: [] };
    respostas["POST /api/equipamentos"] = { status: 201, corpo: { id: "eqNovo", marca: "Midea", modelo: "Xtreme", unidadeId: "un2" } };
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva");
    await clicar($("[data-vincular-equipamento]"));
    const vazio = $d("[data-gaveta-vazia]")!;
    expect(txt(vazio)).toContain("Este cliente ainda não tem equipamento cadastrado");
    expect(vazio.querySelector("a[href='/equipamentos/novo']")).not.toBeNull();
    expect($d("[data-selecionar-todos]")).toBeNull();

    await clicar($d("[data-cadastrar-equipamento]"));
    const campoModal = (rotulo: string) => [...document.querySelectorAll("label")]
      .find((l) => txt(l.querySelector("span")).replace(/\s*\*$/, "") === rotulo && l.querySelector("input, select"))!.querySelector("input, select")!;
    await escolher(campoModal("Unidade / endereço"), "un2"); // sem endereço na OS: pergunta onde fica
    const tipo = campoModal("Tipo") as HTMLSelectElement;
    await escolher(tipo, [...tipo.options].find((o) => o.value)!.value);
    await digitar(campoModal("Marca"), "Midea");
    await digitar(campoModal("Modelo"), "Xtreme");
    await clicar([...document.querySelectorAll("button")].find((b) => txt(b).includes("Salvar e selecionar")) ?? null);

    const criado = chamadas.find((c) => c.metodo === "POST" && c.url === "/api/equipamentos")!;
    expect(criado.corpo).toMatchObject({ unidadeId: "un2", marca: "Midea", modelo: "Xtreme" });
    expect(opcoesGaveta()).toEqual(["eqNovo"]);
    expect(marcado("eqNovo")).toBe(true);
    expect(txt($d('[data-opcao-equipamento="eqNovo"]'))).toContain("Anexo — Bloco B");
    await clicar($d("[data-confirmar-equipamentos]"));
    expect(escolhidosNaPagina()).toEqual(["eqNovo"]);
  });

  it("cliente sem equipamento e sem endereço: orienta a cadastrar o endereço antes (sem cadastro rápido sem onde pôr)", async () => {
    respostas["/api/equipamentos"] = { status: 200, corpo: [] };
    respostas["/api/unidades"] = { status: 200, corpo: [] };
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva");
    await clicar($("[data-vincular-equipamento]"));
    expect(txt($d("[data-gaveta-vazia] [data-sem-endereco]"))).toContain("cadastre o endereço");
    expect($d("[data-cadastrar-equipamento]")).toBeNull();
  });

  it("sem permissão de cadastrar equipamento: o estado vazio só explica, sem atalho de cadastro", async () => {
    respostas["/api/equipamentos"] = { status: 200, corpo: [] };
    await montar("/ordens/nova?clienteId=c1&descricao=Preventiva", permissoesVazias());
    await clicar($("[data-vincular-equipamento]"));
    expect($d("[data-gaveta-vazia]")).not.toBeNull();
    expect($d("[data-cadastrar-equipamento]")).toBeNull();
    expect($d("[data-gaveta-vazia] a")).toBeNull();
  });
});
