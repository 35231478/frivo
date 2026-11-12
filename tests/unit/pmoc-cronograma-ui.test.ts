// @vitest-environment happy-dom
/**
 * PMOC — Etapa 2: a aba "Cronograma" num DOM de verdade (o servidor é um substituto que devolve o que
 * o teste manda; as regras e o banco estão em pmoc-cronograma e pmoc-cronograma-pg).
 *  - o que a aba mostra: itens, próxima execução, equipamento fora do cronograma, OS geradas, o motivo
 *    de não gerar (rascunho, expirado, inativo) e a pendência "agenda diferente do cronograma";
 *  - o formulário do item: o que manda ao servidor, a prévia das próximas datas, o erro do servidor;
 *  - "Reagendar atividades": a confirmação diz o que vai mudar; sem o que fazer, não há o que confirmar;
 *  - RBAC na tela: quem só visualiza não vê ações; o número da OS só é link para quem vê OS;
 *  - a aba deixou de ser "em breve" no editor, e a OS mostra o atalho para o plano;
 *  - Etapa 2.1: a opção de fim de semana no formulário e na lista, e a substituição explicada na tela
 *    (a regra, o que cada item cede e o que isso pede do checklist).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as avisos from "@/components/ui/avisos";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import type { CronogramaTela, ItemCronogramaTela, OsDoCronograma } from "@/lib/pmoc-cronograma-server";
import type { PmocDados } from "@/components/pmoc/pmoc-editor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navegacao = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: navegacao.refresh, push: navegacao.push, replace: vi.fn() }), usePathname: () => "/pmoc/p1", useSearchParams: () => new URLSearchParams() }));

const AGORA = new Date("2026-11-12T15:00:00.000Z"); // 12:00 em Brasília
const URL_CRON = "/api/pmocs/p1/cronograma";

const itemTela = (id: string, extra: Partial<ItemCronogramaTela> = {}): ItemCronogramaTela => ({
  id, ativo: true, tipoEquipamentoId: "teSplit", equipamentoId: null, tipoOsId: "to1", dataInicio: "2026-11-12", intervaloMeses: 1, diaExecucao: 25,
  fimSemana: "MANTER", criadoEm: "2026-11-01T12:00:00.000Z", substituidas: 0,
  tipoOs: { id: "to1", nome: "Manutenção preventiva", ativo: true }, tipoEquipamento: { id: "teSplit", nome: "Split" }, equipamento: null, equipamentos: 3, proxima: "2026-11-25", ...extra,
});
const osTela = (id: string, dia: string, extra: Partial<OsDoCronograma> = {}): OsDoCronograma => ({
  id, numero: `OS-${id}`, status: "AGENDADA", data: `${dia}T15:00:00.000Z`, periodo: dia.slice(0, 7), itemId: "i1", tipoOs: "Manutenção preventiva", local: "Matriz", equipamentos: 2, pendente: true, ...extra,
});
const SEM_PREVIA = { criar: 0, incluir: 0, mover: 0, retirar: 0, cancelar: 0, mantidas: 0, substituidos: 0 };
const tela = (extra: Partial<CronogramaTela> = {}): CronogramaTela => ({
  itens: [itemTela("i1")], semCronograma: [], ordens: [osTela("101", "2026-11-25"), osTela("102", "2026-12-25")], totais: { futuras: 2, passadas: 0 }, motivo: null, previa: SEM_PREVIA,
  opcoes: {
    tiposOs: [{ id: "to1", nome: "Manutenção preventiva" }, { id: "to2", nome: "Higienização" }],
    tiposEquipamento: [{ id: "teChiller", nome: "Chiller", equipamentos: 1 }, { id: "teSplit", nome: "Split", equipamentos: 3 }],
    equipamentos: [{ id: "q1", rotulo: "AC-001 · Split da recepção", local: "Matriz" }, { id: "qC", rotulo: "CH-001 · Chiller central", local: "Matriz" }],
  },
  ...extra,
});

let root: Root; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[];
let respostas: Record<string, { status: number; corpo: unknown }>;
let toast: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  navegacao.push.mockClear(); navegacao.refresh.mockClear();
  pedidos = []; respostas = { [`GET ${URL_CRON}`]: { status: 200, corpo: tela() } };
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada); const metodo = init?.method ?? "GET";
    pedidos.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: [] };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
  toast = vi.spyOn(avisos, "toast").mockImplementation(() => {});
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); root = undefined as unknown as Root; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

const $ = <T extends Element = HTMLElement>(s: string) => (document.body.querySelector(s) as T | null);
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const texto = (el: Element | null = caixa) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (rotulo: string) => $$("button").find((b) => texto(b) === rotulo || b.getAttribute("aria-label") === rotulo);
async function digitar(seletor: string, valor: string) {
  const el = $(seletor) as HTMLInputElement | HTMLSelectElement; expect(el, seletor).toBeTruthy();
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
  await esperar();
}
async function montar(elemento: React.ReactElement) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(elemento); });
  await esperar();
}
async function abrirAba(permissoes: Permissoes = permissoesTotais(), somenteLeitura = false) {
  const [{ PmocCronograma }, { PermissoesProvider }] = await Promise.all([import("@/components/pmoc/pmoc-cronograma"), import("@/components/providers/permissoes-provider")]);
  if (root) { act(() => root.unmount()); caixa.remove(); }
  await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(PmocCronograma, { pmocId: "p1", dataExpiracao: "2027-11-11", somenteLeitura }) }));
}

describe("aba Cronograma: o que mostra", () => {
  it("os itens: a quem se aplica, tipo de OS, início, frequência por extenso, dia e próxima execução", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ itens: [
      itemTela("i1"),
      itemTela("i2", { tipoEquipamentoId: null, tipoEquipamento: null, equipamentoId: "qC", equipamento: { id: "qC", nome: "Chiller central", marca: "Carrier", modelo: "30XA", patrimonio: "CH-001", ativo: true }, intervaloMeses: 3, diaExecucao: 10, equipamentos: 1, proxima: "2026-12-10", tipoOs: { id: "to2", nome: "Higienização", ativo: true } }),
      itemTela("i3", { tipoEquipamentoId: null, tipoEquipamento: null, intervaloMeses: 4, equipamentos: 4, proxima: null }),
    ] });
    await abrirAba();
    const linhas = $$("[data-item]").map((tr) => [...tr.querySelectorAll("td")].slice(0, 6).map((td) => texto(td)));
    expect(linhas).toEqual([
      ["Split3 equipamentos", "Manutenção preventiva", "12/11/2026", "Mensal", "25", "25/11/2026"],
      ["CH-001 · Chiller central1 equipamento", "Higienização", "12/11/2026", "Trimestral", "10", "10/12/2026"],
      ["Todos os equipamentos4 equipamentos", "Manutenção preventiva", "12/11/2026", "A cada 4 meses", "25", "—"],
    ]);
    expect($$("[data-item-card]")).toHaveLength(3); // a versão de celular (cards) do mesmo conteúdo
  });

  it("as OS geradas: data, número (link para a OS), tipo, local, quantidade e status; e o total por vir", async () => {
    await abrirAba();
    expect(texto($("[data-totais]"))).toBe("2 OS por vir · 0 anteriores");
    expect($$("[data-os]").map((tr) => [...tr.querySelectorAll("td")].map((td) => texto(td)))).toEqual([
      ["25/11/2026", "OS-101", "Manutenção preventiva", "Matriz", "2", "Agendada"],
      ["25/12/2026", "OS-102", "Manutenção preventiva", "Matriz", "2", "Agendada"],
    ]);
    expect($$("[data-os] a").map((a) => a.getAttribute("href"))).toEqual(["/ordens/101", "/ordens/102"]);
    expect($("[data-pendencias]")).toBeNull();
    expect($("[data-sem-gerar]")).toBeNull();
  });

  it("por que não gera: rascunho, expirado e inativo têm a sua frase, e 'Reagendar atividades' fica desabilitado", async () => {
    for (const [motivo, frase] of [
      ["RASCUNHO", "Plano em rascunho: as OS são geradas quando ele for publicado."],
      ["EXPIRADO", "Plano expirado: o cronograma não gera mais OS."],
      ["INATIVO", "Plano inativo: o cronograma não gera OS."],
    ] as const) {
      respostas[`GET ${URL_CRON}`].corpo = tela({ motivo, ordens: [], totais: { futuras: 0, passadas: 0 } });
      await abrirAba();
      expect(texto($("[data-sem-gerar]")), motivo).toBe(frase);
      expect(($("[data-reagendar]") as HTMLButtonElement).disabled, motivo).toBe(true);
      expect(texto($("[data-sem-os]"))).toBe("Nenhuma OS gerada por este cronograma.");
    }
  });

  it("equipamento do plano fora de todos os itens: a aba diz quais; sem item nenhum, só convida a criar", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ semCronograma: ["qC"] });
    await abrirAba();
    expect(texto($("[data-fora-do-cronograma]"))).toBe("1 equipamento do plano está fora do cronograma: CH-001 · Chiller central.");
    respostas[`GET ${URL_CRON}`].corpo = tela({ itens: [], semCronograma: ["q1", "qC"], ordens: [], totais: { futuras: 0, passadas: 0 } });
    await abrirAba();
    expect($("[data-fora-do-cronograma]")).toBeNull();
    expect(texto($("[data-sem-itens]"))).toBe("Nenhum item no cronograma. Crie o primeiro em “Novo item”.");
  });

  it("agenda diferente do cronograma: a aba avisa e o botão de reagendar ganha destaque", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ previa: { ...SEM_PREVIA, mover: 2 } });
    await abrirAba();
    expect(texto($("[data-pendencias]"))).toBe("A agenda está diferente do cronograma. Use “Reagendar atividades” para acertar.");
    expect($("[data-reagendar]")!.className).toContain("bg-acento");
    // Só mantidas (ajustadas à mão) não é pendência
    respostas[`GET ${URL_CRON}`].corpo = tela({ previa: { ...SEM_PREVIA, mantidas: 1 } });
    await abrirAba();
    expect($("[data-pendencias]")).toBeNull();
  });

  it("falha ao carregar: mostra o erro do servidor, sem tela em branco", async () => {
    respostas[`GET ${URL_CRON}`] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await abrirAba();
    expect(texto($("[data-erro-cronograma]"))).toBe("Sem permissão para esta ação");
  });
});

describe("aba Cronograma: o item", () => {
  it("novo item por TIPO de equipamento: mostra as próximas datas e manda ao servidor o que foi escolhido", async () => {
    const depois = tela({ itens: [itemTela("i1"), itemTela("i9")] });
    respostas[`POST ${URL_CRON}`] = { status: 201, corpo: { cronograma: depois, gerado: { motivo: null, criadas: [{ id: "a", numero: "OS-1" }, { id: "b", numero: "OS-2" }], incluidos: 0, movidas: 0, retirados: 0, canceladas: 0, mantidas: 0, aCancelar: 0 } } };
    await abrirAba();
    await clicar($("[data-novo-item]"));
    expect(texto($("[role=dialog] h3"))).toBe("Novo item do cronograma");
    // Começa em "todos os equipamentos", hoje, mensal — e sem dia: sem prévia
    expect(($("select[aria-label='Aplica-se a']") as HTMLSelectElement).value).toBe("TODOS");
    expect(($("[data-form-item] input[data-input-data]") as HTMLInputElement).value).toBe("12/11/2026");
    expect(texto($("[data-proximas]"))).toBe("Sem execução dentro da validade do plano com estes dados.");

    await digitar("select[aria-label='Aplica-se a']", "TIPO");
    expect([...$("select[aria-label='Tipo de equipamento']")!.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Selecione o tipo", "Chiller (1)", "Split (3)"]);
    await digitar("select[aria-label='Tipo de equipamento']", "teSplit");
    await digitar("select[aria-label='Tipo de OS']", "to2");
    await digitar("select[aria-label='Frequência']", "3");
    expect(($("input[aria-label='A cada quantos meses']") as HTMLInputElement).value).toBe("3");
    await digitar("input[aria-label='Dia de execução']", "10");
    expect(texto($("[data-proximas]"))).toBe("Próximas execuções: 10/12/2026, 10/03/2027, 10/06/2027, 10/09/2027. Vão até a expiração do plano (11/11/2027).");

    await clicar($("[data-salvar-item]"));
    expect(pedidos.find((p) => p.metodo === "POST")).toEqual({ url: URL_CRON, metodo: "POST", corpo: { tipoEquipamentoId: "teSplit", equipamentoId: null, tipoOsId: "to2", dataInicio: "2026-11-12", intervaloMeses: 3, diaExecucao: 10, fimSemana: "POSTERGAR" } });
    expect($("[data-form-item]")).toBeNull();
    expect($$("[data-item]")).toHaveLength(2);
    expect(toast).toHaveBeenCalledWith("Item criado. 2 OS criadas.");
  });

  it("'outro intervalo': a frequência aceita qualquer número de meses, e o seletor acompanha o número", async () => {
    await abrirAba();
    await clicar($("[data-novo-item]"));
    await digitar("select[aria-label='Frequência']", "outro");
    expect(($("input[aria-label='A cada quantos meses']") as HTMLInputElement).value).toBe("4");
    await digitar("input[aria-label='A cada quantos meses']", "12");
    expect(($("select[aria-label='Frequência']") as HTMLSelectElement).value).toBe("12"); // 12 meses é "Anual"
    await digitar("input[aria-label='A cada quantos meses']", "5");
    expect(($("select[aria-label='Frequência']") as HTMLSelectElement).value).toBe("outro");
  });

  it("por EQUIPAMENTO: manda só o equipamento; escolher o escopo sem dizer qual não chega ao servidor", async () => {
    respostas[`POST ${URL_CRON}`] = { status: 201, corpo: { cronograma: tela(), gerado: null } };
    await abrirAba();
    await clicar($("[data-novo-item]"));
    await digitar("select[aria-label='Aplica-se a']", "EQUIPAMENTO");
    await digitar("select[aria-label='Tipo de OS']", "to1");
    await digitar("input[aria-label='Dia de execução']", "25");
    await clicar($("[data-salvar-item]"));
    expect(texto($("[data-erro-item]"))).toBe("Selecione o equipamento.");
    expect(pedidos.filter((p) => p.metodo === "POST")).toEqual([]);
    expect([...$("select[aria-label='Equipamento']")!.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Selecione o equipamento", "AC-001 · Split da recepção — Matriz", "CH-001 · Chiller central — Matriz"]);
    await digitar("select[aria-label='Equipamento']", "qC");
    await clicar($("[data-salvar-item]"));
    expect(pedidos.find((p) => p.metodo === "POST")!.corpo).toMatchObject({ tipoEquipamentoId: null, equipamentoId: "qC", intervaloMeses: 1, diaExecucao: 25 });
    expect(toast).toHaveBeenCalledWith("Item criado."); // sem geração (rascunho, por exemplo): só confirma o item
  });

  it("o servidor recusou: a mensagem dele aparece no formulário, que continua aberto com o que foi digitado", async () => {
    respostas[`POST ${URL_CRON}`] = { status: 400, corpo: { erro: "O dia de execução vai de 1 a 28." } };
    await abrirAba();
    await clicar($("[data-novo-item]"));
    await digitar("select[aria-label='Tipo de OS']", "to1");
    await digitar("input[aria-label='Dia de execução']", "29");
    await clicar($("[data-salvar-item]"));
    expect(texto($("[data-erro-item]"))).toBe("O dia de execução vai de 1 a 28.");
    expect(($("input[aria-label='Dia de execução']") as HTMLInputElement).value).toBe("29");
    expect(toast).not.toHaveBeenCalled();
  });

  it("editar: abre com o que está gravado e salva por PUT no item", async () => {
    respostas[`PUT ${URL_CRON}/i1`] = { status: 200, corpo: { cronograma: tela({ itens: [itemTela("i1", { diaExecucao: 27, proxima: "2026-11-27" })], previa: { ...SEM_PREVIA, mover: 2 } }), gerado: { motivo: null, criadas: [], incluidos: 0, movidas: 0, retirados: 0, canceladas: 0, mantidas: 0, aCancelar: 0 } } };
    await abrirAba();
    await clicar($("[data-item='i1'] button[aria-label='Editar item']"));
    expect(texto($("[role=dialog] h3"))).toBe("Editar item do cronograma");
    expect([($("select[aria-label='Aplica-se a']") as HTMLSelectElement).value, ($("select[aria-label='Tipo de equipamento']") as HTMLSelectElement).value, ($("select[aria-label='Tipo de OS']") as HTMLSelectElement).value, ($("input[aria-label='Dia de execução']") as HTMLInputElement).value])
      .toEqual(["TIPO", "teSplit", "to1", "25"]);
    await digitar("input[aria-label='Dia de execução']", "27");
    await clicar($("[data-salvar-item]"));
    expect(pedidos.find((p) => p.metodo === "PUT")).toMatchObject({ url: `${URL_CRON}/i1`, corpo: { tipoEquipamentoId: "teSplit", diaExecucao: 27 } });
    expect(toast).toHaveBeenCalledWith("Item salvo.");
    expect(texto($("[data-pendencias]"))).toContain("A agenda está diferente do cronograma"); // mudou o dia: falta reagendar
  });

  it("excluir: pede confirmação; cancelada, nada é enviado; confirmada, DELETE no item", async () => {
    respostas[`DELETE ${URL_CRON}/i1`] = { status: 200, corpo: { cronograma: tela({ itens: [], semCronograma: ["q1"] }) } };
    await abrirAba();
    (globalThis.confirm as any).mockReturnValueOnce(false);
    await clicar($("[data-item='i1'] button[aria-label='Excluir item']"));
    expect(pedidos.filter((p) => p.metodo === "DELETE")).toEqual([]);
    expect($$("[data-item]")).toHaveLength(1);
    await clicar($("[data-item='i1'] button[aria-label='Excluir item']"));
    expect(pedidos.filter((p) => p.metodo === "DELETE").map((p) => p.url)).toEqual([`${URL_CRON}/i1`]);
    expect($$("[data-item]")).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith("Item excluído do cronograma.");
  });
});

describe("aba Cronograma: fim de semana e substituição (Etapa 2.1)", () => {
  const selFim = () => $("select[aria-label='Se cair no fim de semana']") as HTMLSelectElement;
  const GERADO = { motivo: null, criadas: [], incluidos: 0, movidas: 0, retirados: 0, canceladas: 0, mantidas: 0, aCancelar: 0 };
  const balao = (b: Element | null) => texto(document.getElementById(b!.getAttribute("aria-describedby")!));

  it("item novo: propõe POSTERGAR, com as mesmas três opções (e os mesmos nomes) dos contratos", async () => {
    await abrirAba();
    await clicar($("[data-novo-item]"));
    expect(selFim().value).toBe("POSTERGAR");
    expect([...selFim().querySelectorAll("option")].map((o) => [o.value, o.textContent])).toEqual([
      ["MANTER", "Manter na data original"], ["ADIANTAR", "Adiantar para sexta-feira"], ["POSTERGAR", "Postergar para segunda-feira"],
    ]);
  });

  it("a prévia das próximas datas acompanha a opção: dia 14 (sábado em novembro, domingo em fevereiro)", async () => {
    await abrirAba();
    await clicar($("[data-novo-item]"));
    await digitar("input[aria-label='Dia de execução']", "14");
    expect(texto($("[data-proximas]"))).toContain("Próximas execuções: 16/11/2026, 14/12/2026, 14/01/2027, 15/02/2027 e mais 8.");
    await digitar("select[aria-label='Se cair no fim de semana']", "ADIANTAR");
    expect(texto($("[data-proximas]"))).toContain("Próximas execuções: 13/11/2026, 14/12/2026, 14/01/2027, 12/02/2027 e mais 8.");
    await digitar("select[aria-label='Se cair no fim de semana']", "MANTER");
    expect(texto($("[data-proximas]"))).toContain("Próximas execuções: 14/11/2026, 14/12/2026, 14/01/2027, 14/02/2027 e mais 8.");
  });

  it("o que foi escolhido vai ao servidor; editar abre com o que está gravado (item antigo = manter) e salva a troca", async () => {
    respostas[`POST ${URL_CRON}`] = { status: 201, corpo: { cronograma: tela(), gerado: GERADO } };
    respostas[`PUT ${URL_CRON}/i1`] = { status: 200, corpo: { cronograma: tela({ itens: [itemTela("i1", { fimSemana: "ADIANTAR" })] }), gerado: GERADO } };
    await abrirAba();
    await clicar($("[data-novo-item]"));
    await digitar("select[aria-label='Tipo de OS']", "to2");
    await digitar("input[aria-label='Dia de execução']", "14");
    await digitar("select[aria-label='Se cair no fim de semana']", "MANTER");
    await clicar($("[data-salvar-item]"));
    expect(pedidos.find((p) => p.metodo === "POST")!.corpo).toMatchObject({ diaExecucao: 14, fimSemana: "MANTER" });

    await clicar($("[data-item='i1'] button[aria-label='Editar item']"));
    expect(selFim().value).toBe("MANTER"); // o item de exemplo foi gravado antes de a opção existir
    await digitar("select[aria-label='Se cair no fim de semana']", "ADIANTAR");
    await clicar($("[data-salvar-item]"));
    expect(pedidos.find((p) => p.metodo === "PUT")!.corpo).toMatchObject({ fimSemana: "ADIANTAR" });
    expect(texto($("[data-item='i1'] [data-fim-semana]"))).toBe("fim de semana: sexta");
  });

  it("a lista mostra a opção de cada item (manter não polui) e quantas execuções o item cede a um de maior intervalo", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ itens: [
      itemTela("i1", { substituidas: 4 }),
      itemTela("i2", { intervaloMeses: 6, fimSemana: "POSTERGAR", tipoOs: { id: "to2", nome: "Higienização", ativo: true }, proxima: "2027-04-26" }),
      itemTela("i3", { fimSemana: "ADIANTAR", substituidas: 1 }),
    ] });
    await abrirAba();
    const linhas = $$("[data-item]").map((tr) => [...tr.querySelectorAll("td")].map((td) => texto(td)));
    expect(linhas.map((l) => [l[0], l[4], l[5]])).toEqual([
      ["Split3 equipamentos4 execuções substituídas", "25", "25/11/2026"], // "substituídas" fica numa linha própria, abaixo
      ["Split3 equipamentos", "25", "26/04/2027fim de semana: segunda"],
      ["Split3 equipamentos1 execução substituída", "25", "25/11/2026fim de semana: sexta"],
    ]);
    expect($$("[data-item] [data-substituidas]").map((e) => texto(e))).toEqual(["4 execuções substituídas", "1 execução substituída"]);
    expect($$("[data-fim-semana]").map((e) => e.getAttribute("data-fim-semana"))).toEqual(["POSTERGAR", "ADIANTAR"]);
    // no celular (cards), o mesmo conteúdo
    const cards = $$("[data-item-card]").map((c) => texto(c));
    expect(cards[0]).toContain("Split · 3 equipamentos");
    expect($$("[data-item-card] [data-substituidas]").map((e) => texto(e))).toEqual(["4 execuções substituídas", "1 execução substituída"]); // numa linha própria
    expect(cards[0]).toContain("Manutenção preventiva · Mensal, dia 25");
    expect(cards[0]).not.toContain("fim de semana");
    expect(cards[1]).toContain("Higienização · Semestral, dia 25 (fim de semana: segunda)");
    expect(cards[1]).not.toContain("substituída");
    expect(cards[2]).toContain("1 execução substituída");
  });

  it("a regra da substituição está na tela: a frase na lista, a dica com o desempate e, no tipo de OS, o que o checklist precisa ter", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ itens: [itemTela("i1"), itemTela("i2", { intervaloMeses: 6 })] });
    await abrirAba();
    expect(texto($("[data-regra-substituicao]"))).toBe("Uma OS por execução e por local. No mesmo mês, vale o item de maior intervalo.");
    expect(balao($("button[aria-label='Ajuda: Itens do cronograma']"))).toBe(
      "Quando dois itens pegam o mesmo equipamento no mesmo mês, só o de maior intervalo gera OS: a limpeza semestral substitui a preventiva mensal. No empate, vale o item criado primeiro.");

    await clicar($("[data-novo-item]"));
    expect(balao($("[data-form-item] button[aria-label='Ajuda: Tipo de OS']"))).toBe(
      "Define o serviço e o checklist da OS gerada. O serviço de maior intervalo substitui os outros no mês: o checklist dele deve incluir também a rotina leve. Os tipos ficam em Configurações.");
    expect(balao($("[data-form-item] button[aria-label='Ajuda: Se cair no fim de semana']"))).toBe("Vale quando o dia de execução cai em sábado ou domingo. Feriados não entram na conta.");
    // Já existe outro item no plano: o formulário lembra que este pode ser substituído
    expect(texto($("[data-aviso-substituicao]"))).toBe("No mês em que um item de maior intervalo atender o mesmo equipamento, este não gera OS.");
  });

  it("a confirmação do 'Reagendar' separa o que sai por substituição do que saiu do cronograma", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ previa: { ...SEM_PREVIA, criar: 1, retirar: 5, substituidos: 3, cancelar: 2 } });
    await abrirAba();
    await clicar($("[data-reagendar]"));
    expect($$("[data-previa] li").map((li) => texto(li))).toEqual([
      "Criar 1 OS", "Retirar 3 equipamentos atendidos por outro serviço", "Retirar 2 equipamentos que saíram do cronograma", "Cancelar 2 OS que ficam sem equipamento",
    ]);
    await clicar(botao("Voltar"));

    // Só substituição (e no singular): a linha "saiu do cronograma" não aparece
    respostas[`GET ${URL_CRON}`].corpo = tela({ previa: { ...SEM_PREVIA, retirar: 1, substituidos: 1, cancelar: 1 } });
    await abrirAba();
    await clicar($("[data-reagendar]"));
    expect($$("[data-previa] li").map((li) => texto(li))).toEqual(["Retirar 1 equipamento atendido por outro serviço", "Cancelar 1 OS que fica sem equipamento"]);
  });

  it("plano com um item só: ao editar esse item, o lembrete da substituição não aparece (não há com quem disputar)", async () => {
    await abrirAba();
    await clicar($("[data-item='i1'] button[aria-label='Editar item']"));
    expect($("[data-aviso-substituicao]")).toBeNull();
    await clicar(botao("Cancelar"));
    await clicar($("[data-novo-item]")); // já o item NOVO disputa com o que existe
    expect($("[data-aviso-substituicao]")).not.toBeNull();
  });

  it("quem só visualiza vê a opção e o que foi substituído, mas não tem como mudar", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ itens: [itemTela("i1", { fimSemana: "POSTERGAR", substituidas: 2 })] });
    await abrirAba(montarPermissoes({ pmoc: ["visualizar"] }), true); // o editor abre a aba só para leitura sem "PMOC › Editar"
    expect(texto($("[data-item='i1']"))).toContain("2 execuções substituídas");
    expect(texto($("[data-item='i1'] [data-fim-semana]"))).toBe("fim de semana: segunda");
    expect($("[data-novo-item]")).toBeNull();
    expect($("[data-item='i1'] button[aria-label='Editar item']")).toBeNull();
  });
});

describe("aba Cronograma: Reagendar atividades", () => {
  it("nada a fazer: o diálogo diz que a agenda já está igual, e não há botão para confirmar", async () => {
    await abrirAba();
    await clicar($("[data-reagendar]"));
    expect(texto($("[data-previa-vazia]"))).toBe("A agenda já está igual ao cronograma.");
    expect($("[data-confirmar-reagendar]")).toBeNull();
    await clicar(botao("Fechar"));
    expect($("[data-modal-reagendar]")).toBeNull();
    expect(pedidos.filter((p) => p.metodo === "POST")).toEqual([]);
  });

  it("a confirmação diz o que vai mudar, linha por linha, antes de mexer em qualquer OS", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ previa: { criar: 3, incluir: 1, mover: 2, retirar: 4, cancelar: 1, mantidas: 1, substituidos: 0 } });
    await abrirAba();
    await clicar($("[data-reagendar]"));
    expect($$("[data-previa] li").map((li) => texto(li))).toEqual([
      "Criar 3 OS", "Incluir 1 equipamento em OS já geradas", "Mudar a data de 2 OS", "Retirar 4 equipamentos que saíram do cronograma", "Cancelar 1 OS que fica sem equipamento",
    ]);
    expect(texto($("[data-mantidas]"))).toBe("1 OS com data ajustada à mão fica como está.");
    expect($("[data-sem-cancelar]")).toBeNull(); // quem está pedindo pode cancelar OS
    expect(pedidos.filter((p) => p.metodo === "POST")).toEqual([]);
    await clicar(botao("Voltar"));
    expect(pedidos.filter((p) => p.metodo === "POST")).toEqual([]);
  });

  it("confirmar chama o servidor uma vez e mostra o que mudou; a aba passa a mostrar a agenda nova", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ previa: { ...SEM_PREVIA, mover: 2 } });
    respostas[`POST ${URL_CRON}/reagendar`] = { status: 200, corpo: {
      resultado: { motivo: null, criadas: [], incluidos: 0, movidas: 2, retirados: 0, canceladas: 0, mantidas: 0, aCancelar: 0 },
      cronograma: tela({ ordens: [osTela("101", "2026-11-27"), osTela("102", "2026-12-27")] }),
    } };
    await abrirAba();
    await clicar($("[data-reagendar]"));
    await clicar($("[data-confirmar-reagendar]"));
    expect(pedidos.filter((p) => p.metodo === "POST").map((p) => p.url)).toEqual([`${URL_CRON}/reagendar`]);
    expect($("[data-modal-reagendar]")).toBeNull();
    expect($$("[data-os] td:first-child").map((td) => texto(td))).toEqual(["27/11/2026", "27/12/2026"]);
    expect($("[data-pendencias]")).toBeNull();
    expect(toast).toHaveBeenCalledWith("Agenda atualizada: 2 OS com data nova.", "sucesso");
  });

  it("quem não pode cancelar OS é avisado antes; depois, a mensagem diz quantas OS ficaram para quem pode", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ previa: { ...SEM_PREVIA, retirar: 1, cancelar: 1 } });
    respostas[`POST ${URL_CRON}/reagendar`] = { status: 200, corpo: { resultado: { motivo: null, criadas: [], incluidos: 0, movidas: 0, retirados: 0, canceladas: 0, mantidas: 0, aCancelar: 1 }, cronograma: tela({ previa: { ...SEM_PREVIA, retirar: 1, cancelar: 1 } }) } };
    await abrirAba(montarPermissoes({ pmoc: ["visualizar", "editar"] }));
    await clicar($("[data-reagendar]"));
    expect(texto($("[data-sem-cancelar]"))).toBe("Cancelar OS exige a permissão Ordens de serviço › Excluir. Essas OS ficam como estão.");
    await clicar($("[data-confirmar-reagendar]"));
    expect(toast).toHaveBeenCalledWith("A agenda já estava igual ao cronograma. 1 OS ficou sem equipamento, à espera de quem pode cancelar OS.", "info");
  });

  it("o servidor recusou (plano voltou para rascunho noutra aba): o motivo aparece no diálogo", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ previa: { ...SEM_PREVIA, criar: 1 } });
    respostas[`POST ${URL_CRON}/reagendar`] = { status: 409, corpo: { erro: "Plano em rascunho: as OS são geradas quando ele for publicado." } };
    await abrirAba();
    await clicar($("[data-reagendar]"));
    await clicar($("[data-confirmar-reagendar]"));
    expect(texto($("[data-modal-reagendar] [role=alert]"))).toBe("Plano em rascunho: as OS são geradas quando ele for publicado.");
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("aba Cronograma: permissões na tela", () => {
  it("quem só visualiza: vê itens e OS; sem Novo item, Editar, Excluir nem Reagendar — e a pendência vira só informação", async () => {
    respostas[`GET ${URL_CRON}`].corpo = tela({ previa: { ...SEM_PREVIA, mover: 1 } });
    await abrirAba(montarPermissoes({ pmoc: ["visualizar"] }), true);
    expect($$("[data-item]")).toHaveLength(1);
    expect($$("[data-os]")).toHaveLength(2);
    for (const s of ["[data-novo-item]", "[data-reagendar]", "button[aria-label='Editar item']", "button[aria-label='Excluir item']"]) expect($(s), s).toBeNull();
    expect(texto($("[data-pendencias]"))).toBe("A agenda está diferente do cronograma. Falta reagendar as atividades.");
    expect(texto($("[data-sem-itens]") ?? null)).toBe("");
  });

  it("o número da OS só é link para quem tem Ordens de serviço › Visualizar", async () => {
    await abrirAba(montarPermissoes({ pmoc: ["visualizar", "editar"] }));
    expect($$("[data-os] a")).toHaveLength(0);
    expect($$("[data-os] td:nth-child(2)").map((td) => texto(td))).toEqual(["OS-101", "OS-102"]);
    await abrirAba(montarPermissoes({ pmoc: ["visualizar"], ordens: ["visualizar"] }), true);
    expect($$("[data-os] a")).toHaveLength(2);
  });
});

describe("editor do PMOC e OS", () => {
  const plano = (extra: Partial<PmocDados> = {}): PmocDados => ({
    id: "p1", nome: "PMOC 2026 — Hospital", descricao: "Texto", clienteId: "c1", unidadeId: "u1", dataInicio: "2026-11-12", dataExpiracao: "2027-11-11",
    status: "RASCUNHO", responsavelTecnicoId: null, rtNome: "Eng. Paula", rtCrea: "SP-1", artNumero: "123", artArquivoNome: null, artArquivoTipo: null, artArquivoTamanho: null, ativo: true,
    cliente: { id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" }, unidade: { id: "u1", nome: "Matriz", cidade: "São Paulo", estado: "SP" },
    equipamentos: [{ id: "v1", equipamento: { id: "q1", nome: "Split", marca: "LG", modelo: "S4", patrimonio: "AC-001", tipo: "AR_CONDICIONADO_SPLIT", capacidade: null, setor: null, localizacao: null, ativo: true, unidadeId: "u1" } }], ...extra,
  });
  async function abrirEditor(props: Record<string, unknown>) {
    const [{ PmocEditor }, { PermissoesProvider }] = await Promise.all([import("@/components/pmoc/pmoc-editor"), import("@/components/providers/permissoes-provider")]);
    if (root) { act(() => root.unmount()); caixa.remove(); }
    await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(PmocEditor, props) }));
  }

  it("'Cronograma' é uma aba de verdade (só com o plano salvo); Planejamento, Recomendações e Anexos seguem 'em breve'", async () => {
    await abrirEditor({});
    const abas = () => $$("[role=tab]").map((b) => [texto(b).replace(/\s*\d+$/, ""), (b as HTMLButtonElement).disabled]);
    expect(abas()).toEqual([["Identificação", false], ["Equipamentos AVAC", true], ["Cronograma", true], ["Ocorrências", true], ["Histórico", true]]); // plano novo: salvar primeiro
    await abrirEditor({ inicial: plano() });
    expect(abas()).toEqual([["Identificação", false], ["Equipamentos AVAC", false], ["Cronograma", false], ["Ocorrências", false], ["Histórico", false]]); // "Histórico" chegou na Etapa 3; "Ocorrências", depois
    expect($$("[data-aba-futura]").map((b) => texto(b))).toEqual(["Planejamento em breve", "Recomendações em breve", "Anexos em breve"]);
    await clicar($("[role=tab][data-aba='cronograma']"));
    expect($("[data-cronograma]")).toBeTruthy();
    expect(pedidos.some((p) => p.url === URL_CRON && p.metodo === "GET")).toBe(true);
  });

  it("abrir direto na aba (link da OS: ?aba=cronograma) e publicar dizendo quantas OS o cronograma gerou", async () => {
    await abrirEditor({ inicial: plano(), abaInicial: "cronograma" });
    expect($("[role=tab][data-aba='cronograma']")!.getAttribute("aria-selected")).toBe("true");
    expect($("[data-cronograma]")).toBeTruthy();

    respostas["PUT /api/pmocs/p1"] = { status: 200, corpo: { ...plano({ status: "PUBLICADO" }), osGeradas: 12 } };
    await clicar(botao("Publicar"));
    expect(texto($("[data-msg='ok']"))).toBe("PMOC publicado. 12 OS geradas pelo cronograma.");
    respostas["PUT /api/pmocs/p1"] = { status: 200, corpo: { ...plano({ status: "PUBLICADO" }), osGeradas: 1 } };
    await clicar(botao("Salvar") ?? $("[role=tab][data-aba='identificacao']"));
    if (!botao("Salvar")) { await clicar($("[role=tab][data-aba='identificacao']")); }
    await clicar(botao("Salvar"));
    expect(texto($("[data-msg='ok']"))).toBe("Alterações salvas. 1 OS gerada pelo cronograma.");
    respostas["PUT /api/pmocs/p1"] = { status: 200, corpo: { ...plano({ status: "PUBLICADO" }), osGeradas: 0 } };
    await clicar(botao("Salvar"));
    expect(texto($("[data-msg='ok']"))).toBe("Alterações salvas.");
  });

  it("a OS gerada pelo cronograma mostra o plano no resumo: link para quem vê o PMOC, só o nome para quem não vê", async () => {
    const { ResumoOs } = await import("@/components/os/central/resumo-os");
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    const os = { cliente: { nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" }, historico: [], atividades: [], prazos: [], descricao: "Manutenção", criadoEm: AGORA.toISOString(), previsaoConclusao: AGORA.toISOString() };
    const ver = async (permissoes: Permissoes, pmoc: unknown) => {
      if (root) { act(() => root.unmount()); caixa.remove(); }
      await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(ResumoOs, { os: { ...os, pmoc }, central: { falta: [], prazoOs: { situacao: "SEM_PRAZO", diasAtraso: 0, diasRestantes: 0 }, prazosAtividades: [] } as any, onAba: () => {} }) }));
      const el = $("[data-pmoc-da-os]");
      return el ? [el.tagName, texto(el), el.getAttribute("href")] : null;
    };
    expect(await ver(permissoesTotais(), { id: "p1", nome: "PMOC 2026 — Hospital" })).toEqual(["A", "PMOC 2026 — Hospital", "/pmoc/p1?aba=cronograma"]);
    expect(await ver(montarPermissoes({ ordens: ["visualizar"] }), { id: "p1", nome: "PMOC 2026 — Hospital" })).toEqual(["SPAN", "PMOC 2026 — Hospital", null]);
    expect(await ver(permissoesTotais(), null)).toBeNull(); // OS comum: nada a mostrar
  });
});
