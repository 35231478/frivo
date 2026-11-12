// @vitest-environment happy-dom
/**
 * PMOC — RENOVAÇÃO nas telas, num DOM de verdade (o servidor é um substituto que devolve o que o
 * teste manda; as regras e o banco estão em pmoc-renovacao e pmoc-renovacao-pg):
 *  - o botão "Renovar" no cabeçalho do plano, só para quem tem "PMOC › Editar";
 *  - o diálogo: datas propostas e editáveis, o que VAI e o que NÃO vai (a ART não vai), recalculado
 *    quando a vigência muda;
 *  - confirmar manda nome e datas e abre o plano novo; erro do servidor aparece no diálogo;
 *  - o plano novo avisa o que fazer; a faixa de vencimento aponta para "Renovar";
 *  - o histórico mostra o link para o outro plano.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import type { PmocDados } from "@/components/pmoc/pmoc-editor";
import type { PreviaRenovacao } from "@/lib/pmoc-renovacao-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navegacao = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: navegacao.refresh, push: navegacao.push, replace: vi.fn() }), usePathname: () => "/pmoc/p1", useSearchParams: () => new URLSearchParams() }));

const AGORA = new Date("2027-10-20T15:00:00.000Z"); // 20/10/2027, 12:00 em Brasília
const URL_R = "/api/pmocs/p1/renovacao";

let root: Root; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[];
let respostas: Record<string, { status: number; corpo: unknown }>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  navegacao.push.mockClear(); navegacao.refresh.mockClear();
  pedidos = []; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada); const metodo = init?.method ?? "GET";
    pedidos.push({ url, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: [] };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); root = undefined as unknown as Root; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

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
async function montar(elemento: React.ReactElement) {
  if (root) { act(() => root.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(elemento); });
  await esperar();
}
/** Plano publicado que expira em 22 dias (11/11/2027) */
const plano = (extra: Partial<PmocDados> = {}): PmocDados => ({
  id: "p1", nome: "PMOC 2027 — Hospital", descricao: "Texto", clienteId: "c1", unidadeId: "u1", dataInicio: "2026-11-12", dataExpiracao: "2027-11-11",
  status: "PUBLICADO", responsavelTecnicoId: null, rtNome: "Eng. Paula", rtCrea: "SP-1", artNumero: "123", artArquivoNome: null, artArquivoTipo: null, artArquivoTamanho: null, ativo: true,
  cliente: { id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" }, unidade: { id: "u1", nome: "Matriz", cidade: "São Paulo", estado: "SP" },
  equipamentos: [], ...extra,
});
const itemDaPrevia = (id: string, extra: Record<string, unknown> = {}) => ({
  id, ativo: true, tipoEquipamentoId: null, equipamentoId: null, tipoOsId: "toLeve", dataInicio: "2026-11-12", intervaloMeses: 1, diaExecucao: 25, fimSemana: "POSTERGAR",
  criadoEm: "2026-11-01T12:00:00.000Z", servico: "Manutenção Preventiva", aplicaA: "Todos os equipamentos", ...extra,
});
const PREVIA: PreviaRenovacao = {
  pmoc: { id: "p1", nome: "PMOC 2027 — Hospital", dataInicio: "2026-11-12", dataExpiracao: "2027-11-11" },
  proposta: { nome: "PMOC 2028 — Hospital", dataInicio: "2027-11-12", dataExpiracao: "2028-11-11" },
  equipamentos: [{ id: "q1", rotulo: "AC-001 · Split da recepção", ativo: true }, { id: "q2", rotulo: "AC-002 · Split UTI 1", ativo: true }, { id: "q3", rotulo: "AC-003 · Split do almoxarifado", ativo: false }],
  itens: [
    itemDaPrevia("iLeve"),
    itemDaPrevia("iQuimica", { tipoOsId: "toQuimica", tipoEquipamentoId: "teSplit", dataInicio: "2027-04-01", intervaloMeses: 6, criadoEm: "2026-11-02T12:00:00.000Z", servico: "Limpeza Química", aplicaA: "Split" }),
    itemDaPrevia("iQ3", { equipamentoId: "q3", intervaloMeses: 3, diaExecucao: 5, criadoEm: "2026-11-03T12:00:00.000Z", aplicaA: "AC-003 · Split do almoxarifado" }),
  ] as PreviaRenovacao["itens"],
  renovacoes: [],
};
async function abrirEditor(props: Record<string, unknown> = {}, permissoes: Permissoes = permissoesTotais()) {
  const [{ PmocEditor }, { PermissoesProvider }] = await Promise.all([import("@/components/pmoc/pmoc-editor"), import("@/components/providers/permissoes-provider")]);
  await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(PmocEditor, { inicial: plano(), ...props }) }));
}
async function abrirDialogo(previa: PreviaRenovacao | null = PREVIA, permissoes?: Permissoes) {
  if (previa) respostas[`GET ${URL_R}`] = { status: 200, corpo: previa };
  await abrirEditor({}, permissoes);
  await clicar($("[data-renovar]"));
}
const INICIO = "input[aria-label='Data de início da nova vigência']", EXPIRA = "input[aria-label='Data de expiração da nova vigência']", NOME = "input[aria-label='Nome do novo plano']";
const valor = (s: string) => ($(s) as HTMLInputElement).value;
const renovacoes = () => pedidos.filter((p) => p.url === URL_R && p.metodo === "POST");

describe("PMOC › Renovar: o botão", () => {
  it("fica no cabeçalho do plano, ao lado de 'Criar cópia', e só carrega a prévia quando é clicado", async () => {
    await abrirEditor();
    const botoes = $$("button, a").map((b) => texto(b));
    expect(botoes.indexOf("Renovar")).toBeGreaterThan(-1);
    expect(botoes.indexOf("Criar cópia")).toBe(botoes.indexOf("Renovar") + 1);
    expect(pedidos.some((p) => p.url === URL_R)).toBe(false);
    expect($("[data-modal-renovar]")).toBeNull();
  });

  it("exige PMOC › Editar: quem só visualiza (ou visualiza e cria) não vê o botão; plano novo ainda não tem o que renovar", async () => {
    await abrirEditor({}, montarPermissoes({ pmoc: ["visualizar"] }));
    expect($("[data-renovar]")).toBeNull();
    await abrirEditor({}, montarPermissoes({ pmoc: ["visualizar", "criar"] }));
    expect($("[data-renovar]")).toBeNull();
    expect($$("button").some((b) => texto(b) === "Criar cópia")).toBe(true); // a cópia continua com "Criar"
    await abrirEditor({}, montarPermissoes({ pmoc: ["visualizar", "editar"] }));
    expect($("[data-renovar]")).toBeTruthy();
    await abrirEditor({ inicial: undefined });
    expect($("[data-renovar]")).toBeNull();
  });

  it("aparece também no plano expirado e no plano inativo (renovar não mexe no plano de origem)", async () => {
    await abrirEditor({ inicial: plano({ dataInicio: "2025-01-01", dataExpiracao: "2025-12-31" }) });
    expect($("[data-renovar]")).toBeTruthy();
    await abrirEditor({ inicial: plano({ ativo: false }) });
    expect($("[data-renovar]")).toBeTruthy();
  });
});

describe("PMOC › Renovar: o diálogo", () => {
  it("propõe o nome e a vigência (dia seguinte à expiração + 1 ano), em dd/mm/aaaa, e diz que nasce em rascunho sem gerar OS", async () => {
    await abrirDialogo();
    expect(pedidos.filter((p) => p.url === URL_R).map((p) => p.metodo)).toEqual(["GET"]);
    expect([valor(NOME), valor(INICIO), valor(EXPIRA)]).toEqual(["PMOC 2028 — Hospital", "12/11/2027", "11/11/2028"]);
    expect(texto($("[data-modal-renovar]"))).toContain("Ele nasce em rascunho: nenhuma OS é gerada até publicar.");
    expect(texto($("[data-modal-renovar]"))).toContain("A vigência atual termina em 11/11/2027");
    expect($("[data-aviso-vigencia]")).toBeNull();
    expect($("[data-ja-renovado]")).toBeNull();
  });

  it("O QUE VAI: cliente/unidade/RT/texto, os equipamentos ATIVOS e cada item do cronograma com o início na nova vigência", async () => {
    await abrirDialogo();
    const vai = texto($("[data-vai]"));
    expect(vai).toContain("Cliente, unidade, responsável técnico e texto técnico.");
    expect(texto($("[data-equipamentos-vao]"))).toBe("2 equipamentos ativos.");
    expect(texto($("[data-itens-vao]"))).toBe("2 itens do cronograma, com o início na nova vigência:");
    expect($$("[data-item-renovado]").map((l) => texto(l))).toEqual([
      "Manutenção Preventiva · Todos os equipamentos · Mensal, dia 25 · a partir de 12/11/2027",
      "Limpeza Química · Split · Semestral, dia 25 · a partir de 01/04/2028",
    ]);
  });

  it("O QUE NÃO VAI: a ART (anexar a nova), link/histórico/avisos/OS, o equipamento inativo pelo nome e o item que era dele", async () => {
    await abrirDialogo();
    expect(texto($("[data-art-nao-vai]"))).toBe("ART (número e arquivo): cada vigência tem a sua. Anexe a nova antes de publicar.");
    expect(texto($("[data-nao-vai]"))).toContain("Link público, histórico, avisos e as OS já geradas.");
    expect(texto($("[data-equipamentos-fora]"))).toBe("1 equipamento inativo: AC-003 · Split do almoxarifado.");
    expect($$("[data-item-fora]").map((l) => texto(l))).toEqual(["Item Manutenção Preventiva · AC-003 · Split do almoxarifado: o equipamento está inativo."]);
  });

  it("sem nada de fora: a lista do que não vai fica só com a ART e o que é do plano antigo", async () => {
    await abrirDialogo({ ...PREVIA, equipamentos: PREVIA.equipamentos.slice(0, 1), itens: PREVIA.itens.slice(0, 1) });
    expect(texto($("[data-equipamentos-vao]"))).toBe("1 equipamento ativo.");
    expect(texto($("[data-itens-vao]"))).toBe("1 item do cronograma, com o início na nova vigência:");
    expect($("[data-equipamentos-fora]")).toBeNull();
    expect($$("[data-item-fora]")).toEqual([]);
    expect($("[data-art-nao-vai]")).toBeTruthy();
  });

  it("plano sem cronograma: diz que vão 0 itens, sem lista", async () => {
    await abrirDialogo({ ...PREVIA, itens: [] });
    expect(texto($("[data-itens-vao]"))).toBe("0 itens do cronograma, com o início na nova vigência.");
    expect($$("[data-item-renovado]")).toEqual([]);
  });

  it("mudar a vigência RECALCULA as datas dos itens na hora e mostra o item que passaria da nova expiração", async () => {
    await abrirDialogo();
    await digitar(INICIO, "10/01/2028");
    await digitar(EXPIRA, "09/01/2029");
    expect($$("[data-item-renovado]").map((l) => texto(l).split("a partir de ")[1])).toEqual(["10/01/2028", "01/06/2028"]);
    // vigência curta: a química (junho) não cabe
    await digitar(EXPIRA, "09/04/2028");
    expect($$("[data-item-renovado]")).toHaveLength(1);
    expect($$("[data-item-fora]").map((l) => texto(l))).toContain("Item Limpeza Química · Split: começaria depois da nova expiração.");
  });

  it("observações da vigência: começa antes do fim da atual; início que já passou", async () => {
    await abrirDialogo();
    await digitar(INICIO, "01/11/2027");
    expect($$("[data-aviso-vigencia]").map((a) => texto(a))).toEqual(["A nova vigência começa antes do fim da atual (11/11/2027)."]);
    await digitar(INICIO, "01/10/2027");
    expect($$("[data-aviso-vigencia]").map((a) => texto(a))).toEqual([
      "A nova vigência começa antes do fim da atual (11/11/2027).", "O início já passou: só as manutenções de hoje em diante geram OS.",
    ]);
  });

  it("datas incompletas ou expiração antes do início: pede as datas em vez de mostrar uma lista errada", async () => {
    await abrirDialogo();
    await digitar(EXPIRA, "");
    expect(texto($("[data-sem-datas]"))).toBe("Informe as duas datas, com a expiração depois do início.");
    expect($("[data-vai]")).toBeNull();
    await digitar(EXPIRA, "01/01/2027");
    expect($("[data-sem-datas]")).toBeTruthy();
    await digitar(EXPIRA, "11/11/2028");
    expect($("[data-vai]")).toBeTruthy();
  });

  it("plano que JÁ tem renovação: avisa qual é, com link, e deixa renovar de novo", async () => {
    await abrirDialogo({ ...PREVIA, renovacoes: [{ id: "p2", nome: "PMOC 2028 — Hospital" }] });
    expect(texto($("[data-ja-renovado]"))).toBe("Este plano já tem renovação: PMOC 2028 — Hospital. Renovar de novo cria outro plano.");
    expect($("[data-ja-renovado] a")!.getAttribute("href")).toBe("/pmoc/p2");
    expect(($("[data-confirmar-renovacao]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a prévia não carrega (403, erro): mostra a mensagem do servidor e não deixa confirmar", async () => {
    respostas[`GET ${URL_R}`] = { status: 403, corpo: { erro: "Sem permissão para esta ação." } };
    await abrirDialogo(null);
    expect(texto($("[data-erro-renovacao]"))).toBe("Sem permissão para esta ação.");
    expect(($("[data-confirmar-renovacao]") as HTMLButtonElement).disabled).toBe(true);
    expect($(NOME)).toBeNull();
  });
});

describe("PMOC › Renovar: confirmar", () => {
  it("manda o nome e as datas do diálogo (as propostas, ou as que o usuário mudou) e abre o plano novo", async () => {
    respostas[`POST ${URL_R}`] = { status: 201, corpo: { id: "p2", equipamentos: 2, itens: 2, equipamentosFora: 1, itensFora: 1 } };
    await abrirDialogo();
    await clicar($("[data-confirmar-renovacao]"));
    expect(renovacoes().map((p) => p.corpo)).toEqual([{ nome: "PMOC 2028 — Hospital", dataInicio: "2027-11-12", dataExpiracao: "2028-11-11" }]);
    expect(navegacao.push).toHaveBeenCalledWith("/pmoc/p2?renovado=1");
    expect($("[data-modal-renovar]")).toBeNull();

    await abrirDialogo();
    await digitar(NOME, "Plano do Hospital 2028");
    await digitar(INICIO, "10/01/2028");
    await digitar(EXPIRA, "09/01/2029");
    await clicar($("[data-confirmar-renovacao]"));
    expect(renovacoes().at(-1)!.corpo).toEqual({ nome: "Plano do Hospital 2028", dataInicio: "2028-01-10", dataExpiracao: "2029-01-09" });
  });

  it("erro do servidor (400, 403, 404): a mensagem aparece no diálogo, que continua aberto, e nada navega", async () => {
    await abrirDialogo();
    for (const [status, erro] of [[400, "A data de expiração deve ser depois da data de início."], [403, "Sem permissão para esta ação."], [404, "PMOC não encontrado"]] as const) {
      respostas[`POST ${URL_R}`] = { status, corpo: { erro } };
      await clicar($("[data-confirmar-renovacao]"));
      expect(texto($("[data-erro-renovacao]"))).toBe(erro);
    }
    expect($("[data-modal-renovar]")).toBeTruthy();
    expect(navegacao.push).not.toHaveBeenCalled();
  });

  it("'Cancelar' fecha sem renovar; abrir de novo volta para a proposta (o que foi digitado não fica)", async () => {
    await abrirDialogo();
    await digitar(NOME, "Outro nome");
    await clicar($$("[data-modal-renovar] button").find((b) => texto(b) === "Cancelar"));
    expect($("[data-modal-renovar]")).toBeNull();
    expect(renovacoes()).toEqual([]);
    await clicar($("[data-renovar]"));
    expect(valor(NOME)).toBe("PMOC 2028 — Hospital");
  });
});

describe("PMOC › Renovar: depois de renovar", () => {
  it("o plano novo abre com o aviso do que falta: anexar a nova ART, conferir e publicar", async () => {
    await abrirEditor({ inicial: plano({ id: "p2", status: "RASCUNHO", artNumero: null }), renovadoRecente: true });
    expect(texto($("[data-msg='ok']"))).toBe("Renovação criada como Rascunho, com o cronograma. Anexe a nova ART, confira e publique.");
  });

  it("a faixa de vencimento do plano aponta para 'Renovar' (e não mais para a cópia)", async () => {
    await abrirEditor({ config: { diasAviso: 30, textoPadrao: null } });
    const faixa = texto($("[data-aviso-vencimento]"));
    expect(faixa).toBe("Expira em 22 dias (11/11/2027). Use “Renovar” para criar o plano da próxima vigência, já com o cronograma. Ciente");
    expect(faixa).not.toContain("Criar cópia");
  });

  it("histórico: a linha da renovação traz o link para o outro plano; as outras linhas não", async () => {
    respostas["GET /api/pmocs/p1/historico"] = { status: 200, corpo: { historico: [
      { id: "h2", acao: "Renovação gerada: PMOC 2028 — Hospital", detalhes: "Nova vigência: 12/11/2027 a 11/11/2028. O plano novo nasce em rascunho.", criadoEm: "2027-10-20T15:00:00.000Z", usuario: "Ana Souza", plano: { id: "p2", nome: "PMOC 2028 — Hospital" } },
      { id: "h1", acao: "Plano publicado", detalhes: null, criadoEm: "2026-11-12T15:00:00.000Z", usuario: "Ana Souza", plano: null },
    ] } };
    await abrirEditor();
    await clicar($("[role=tab][data-aba='historico']"));
    const linhas = $$("[data-linha-historico]");
    expect(texto(linhas[0])).toBe("Renovação gerada: PMOC 2028 — HospitalNova vigência: 12/11/2027 a 11/11/2028. O plano novo nasce em rascunho.Abrir PMOC 2028 — Hospital 20/10/2027 às 12:00 · Ana Souza");
    const link = linhas[0].querySelector("[data-plano-ligado]") as HTMLAnchorElement;
    expect([texto(link), link.getAttribute("href")]).toEqual(["Abrir PMOC 2028 — Hospital", "/pmoc/p2"]);
    expect(linhas[1].querySelector("[data-plano-ligado]")).toBeNull();
    expect(texto($("[data-historico-pmoc]"))).toContain("Envios ao cliente, avisos de vencimento, ART, publicação e renovação.");
  });
});
