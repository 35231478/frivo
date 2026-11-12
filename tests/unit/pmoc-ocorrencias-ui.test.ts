// @vitest-environment happy-dom
/**
 * PMOC — OCORRÊNCIAS na tela, num DOM de verdade (o servidor é um substituto que devolve o que o
 * teste manda; as regras estão em pmoc-ocorrencias e o servidor em pmoc-ocorrencias-pg):
 *  - a aba "Ocorrências" no editor do plano (deixou de ser "em breve"), com o número das não resolvidas;
 *  - a lista: data, equipamento, descrição, gravidade e situação; busca e filtros; as excluídas à parte;
 *  - registrar e editar pelo formulário (o que vai no pedido), com o anexo reduzido antes de enviar;
 *  - resolver, reabrir, excluir (com confirmação) e restaurar;
 *  - quem só visualiza (ou plano inativo) vê a lista sem nenhum botão de mudança.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import type { PmocDados } from "@/components/pmoc/pmoc-editor";
import type { OcorrenciaPmoc } from "@/lib/pmoc-ocorrencias";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navegacao = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const reducao = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: navegacao.refresh, push: navegacao.push, replace: vi.fn() }), usePathname: () => "/pmoc/p1", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/imagem-cliente", () => ({ reduzirImagem: (...a: unknown[]) => reducao.fn(...a) }));

const AGORA = new Date("2026-11-12T15:00:00.000Z"); // 12/11/2026, 12:00 em Brasília
const URL_L = "/api/pmocs/p1/ocorrencias";
const url = (id: string) => `${URL_L}/${id}`;

let root: Root; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[];
let respostas: Record<string, { status: number; corpo: unknown }>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  navegacao.push.mockClear(); navegacao.refresh.mockClear();
  reducao.fn.mockReset();
  reducao.fn.mockResolvedValue({ imagem: { dataUrl: "data:image/jpeg;base64,UkVEVVpJREE=", largura: 1600, altura: 1200, bytes: 300_000 }, qualidade: {} });
  pedidos = []; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const u = String(entrada); const metodo = init?.method ?? "GET";
    pedidos.push({ url: u, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${u}`] ?? { status: 200, corpo: [] };
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
  const el = $(seletor) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; expect(el, seletor).toBeTruthy();
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
  await esperar();
}
async function montar(elemento: React.ReactElement) {
  if (root) { act(() => root.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(elemento); });
  await esperar();
}

/* ───────── exemplos ───────── */
const oc = (id: string, extra: Partial<OcorrenciaPmoc> = {}): OcorrenciaPmoc => ({
  id, data: "2026-11-10", descricao: "Vazamento de água na bandeja", gravidade: "ALTA", situacao: "ABERTA", resolvidaEm: null, resolucao: null,
  equipamento: { id: "q1", rotulo: "AC-001 · Split da recepção", tag: "AC-001" }, ordemServico: null, anexo: null, origem: "MANUAL", ativo: true, criadoEm: "2026-11-10T12:00:00.000Z", ...extra,
});
const VAZAMENTO = oc("vazamento", { ordemServico: { id: "os1", numero: "OS-101" }, anexo: { nome: "bandeja.jpg", tipo: "image/jpeg", tamanho: 300_000 } });
const RUIDO = oc("ruido", { data: "2026-11-07", descricao: "Ruído anormal no compressor", gravidade: "CRITICA", situacao: "EM_ANDAMENTO", equipamento: null });
const FILTRO = oc("filtro", { data: "2026-11-02", descricao: "Filtro danificado", gravidade: "MEDIA", situacao: "RESOLVIDA", resolvidaEm: "2026-11-04", resolucao: "Trocado por um filtro novo", equipamento: { id: "q2", rotulo: "AC-002 · Split UTI 1", tag: "AC-002" } });
const CORROSAO = oc("corrosao", { data: "2026-10-23", descricao: "Corrosão na base", gravidade: "BAIXA", equipamento: { id: "q3", rotulo: "CH-001 · Chiller central", tag: "CH-001" } });
const ENGANO = oc("engano", { data: "2026-11-11", descricao: "Falha elétrica registrada por engano", gravidade: "CRITICA", ativo: false });
const LISTA = [CORROSAO, ENGANO, VAZAMENTO, FILTRO, RUIDO]; // fora de ordem, de propósito
const EQUIPAMENTOS = [{ id: "q1", rotulo: "AC-001 · Split da recepção" }, { id: "q2", rotulo: "AC-002 · Split UTI 1" }];
const ORDENS = [{ id: "os2", numero: "OS-102", descricao: "Limpeza Química" }, { id: "os1", numero: "OS-101", descricao: "" }];

const mudancas: number[] = [];
async function abrir(ocorrencias: OcorrenciaPmoc[] = LISTA, props: Record<string, unknown> = {}) {
  mudancas.length = 0;
  if (!respostas[`GET ${URL_L}`]) respostas[`GET ${URL_L}`] = { status: 200, corpo: { ocorrencias, ordens: ORDENS } };
  const { PmocOcorrencias } = await import("@/components/pmoc/pmoc-ocorrencias");
  await montar(createElement(PmocOcorrencias, { pmocId: "p1", equipamentos: EQUIPAMENTOS, somenteLeitura: false, aoMudar: (n: number) => { mudancas.push(n); }, ...props }));
}
const linha = (id: string) => $(`li[data-ocorrencia='${id}']`);
const naLista = () => $$("li[data-ocorrencia]").map((li) => li.getAttribute("data-ocorrencia"));
const escritas = () => pedidos.filter((p) => p.metodo !== "GET");
const M = "[data-modal-ocorrencia]";
const valor = (s: string) => ($(s) as HTMLInputElement).value;
const opcoes = (s: string) => $$(`${s} option`).map((o) => texto(o));
const responder = (chave: string, corpo: unknown, status = 200) => { respostas[chave] = { status, corpo }; };

/* ───────── a aba no editor ───────── */
const plano = (extra: Partial<PmocDados> = {}): PmocDados => ({
  id: "p1", nome: "PMOC 2027 — Hospital", descricao: "Texto", clienteId: "c1", unidadeId: "u1", dataInicio: "2026-08-01", dataExpiracao: "2027-07-31",
  status: "PUBLICADO", responsavelTecnicoId: null, rtNome: "Eng. Paula", rtCrea: "SP-1", artNumero: "123", artArquivoNome: null, artArquivoTipo: null, artArquivoTamanho: null, ativo: true,
  cliente: { id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" }, unidade: { id: "u1", nome: "Matriz", cidade: "São Paulo", estado: "SP" },
  equipamentos: [
    { id: "v1", equipamento: { id: "q1", nome: "Split da recepção", marca: "LG", modelo: "S4", patrimonio: "AC-001", tipo: "AR_CONDICIONADO_SPLIT", capacidade: "48000", setor: null, localizacao: null, ativo: true, unidadeId: "u1" } },
    { id: "v2", equipamento: { id: "q2", nome: null, marca: "Daikin", modelo: "FTXS35", patrimonio: null, tipo: "AR_CONDICIONADO_SPLIT", capacidade: null, setor: null, localizacao: null, ativo: true, unidadeId: "u1" } },
  ], ...extra,
});
async function abrirEditor(props: Record<string, unknown> = {}, permissoes: Permissoes = permissoesTotais()) {
  if (!respostas[`GET ${URL_L}`]) respostas[`GET ${URL_L}`] = { status: 200, corpo: { ocorrencias: LISTA, ordens: ORDENS } };
  const [{ PmocEditor }, { PermissoesProvider }] = await Promise.all([import("@/components/pmoc/pmoc-editor"), import("@/components/providers/permissoes-provider")]);
  await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(PmocEditor, { inicial: plano(), ...props }) }));
}
const numeroDaAba = () => ($("[data-ocorrencias-pendentes]") ? texto($("[data-ocorrencias-pendentes]")) : null);

describe("PMOC › aba Ocorrências no editor", () => {
  it("é uma aba de verdade, entre Cronograma e Histórico; só carrega a lista quando é aberta", async () => {
    await abrirEditor({ ocorrenciasPendentes: 2 });
    expect($$("[role=tab]").map((b) => texto(b).replace(/\s*\d+$/, ""))).toEqual(["Identificação", "Equipamentos AVAC", "Cronograma", "Ocorrências", "Histórico"]);
    expect($$("[data-aba-futura]").map((b) => texto(b))).not.toContain("Ocorrências em breve");
    expect(($("[role=tab][data-aba='ocorrencias']") as HTMLButtonElement).disabled).toBe(false);
    expect(numeroDaAba()).toBe("2"); // o que a página contou no servidor
    expect(pedidos.some((p) => p.url === URL_L)).toBe(false);
    await clicar($("[role=tab][data-aba='ocorrencias']"));
    expect(pedidos.filter((p) => p.url === URL_L && p.metodo === "GET")).toHaveLength(1);
    expect($("[data-ocorrencias]")).toBeTruthy();
    expect(numeroDaAba()).toBe("3"); // e passa a acompanhar a lista: 2 abertas + 1 em andamento
  });

  it("sem ocorrência pendente a aba não mostra número; plano novo (ainda não salvo) não abre a aba", async () => {
    await abrirEditor();
    expect(numeroDaAba()).toBeNull();
    await abrirEditor({ ocorrenciasPendentes: 0 });
    expect(numeroDaAba()).toBeNull();
    await abrirEditor({ inicial: undefined });
    expect(($("[role=tab][data-aba='ocorrencias']") as HTMLButtonElement).disabled).toBe(true);
  });

  it("abre direto na aba pelo endereço (?aba=ocorrencias) e oferece os equipamentos AVAC do próprio plano", async () => {
    await abrirEditor({ abaInicial: "ocorrencias" });
    expect($("[role=tab][data-aba='ocorrencias']")!.getAttribute("aria-selected")).toBe("true");
    await clicar($("[data-nova-ocorrencia]"));
    expect(opcoes(`${M} select[aria-label='Equipamento']`)).toEqual(["Geral da unidade", "AC-001 · Split da recepção", "Daikin FTXS35"]);
  });

  it("o número da aba acompanha cada mudança (resolver tira um)", async () => {
    await abrirEditor({ abaInicial: "ocorrencias" });
    expect(numeroDaAba()).toBe("3");
    responder(`PATCH ${url("vazamento")}`, { ...VAZAMENTO, situacao: "RESOLVIDA", resolvidaEm: "2026-11-12" });
    await clicar(linha("vazamento")!.querySelector("[data-resolver]"));
    await clicar($("[data-confirmar-resolver]"));
    expect(numeroDaAba()).toBe("2");
  });

  it("quem só visualiza o PMOC vê a aba e a lista, sem 'Nova ocorrência' nem ações; plano inativo, idem", async () => {
    await abrirEditor({ abaInicial: "ocorrencias" }, montarPermissoes({ pmoc: ["visualizar"] }));
    expect(naLista()).toHaveLength(4);
    expect($("[data-nova-ocorrencia]")).toBeNull();
    expect($$("[data-acoes-ocorrencia], [data-resolver], [data-editar], [data-excluir], [data-reabrir], [data-restaurar]")).toHaveLength(0);
    await abrirEditor({ abaInicial: "ocorrencias" }, montarPermissoes({ pmoc: ["visualizar", "criar", "excluir"] })); // sem "editar"
    expect($("[data-nova-ocorrencia]")).toBeNull();
    await abrirEditor({ abaInicial: "ocorrencias", inicial: plano({ ativo: false }) });
    expect(naLista()).toHaveLength(4);
    expect($$("[data-nova-ocorrencia], [data-acoes-ocorrencia]")).toHaveLength(0);
    await abrirEditor({ abaInicial: "ocorrencias" }, montarPermissoes({ pmoc: ["visualizar", "editar"] }));
    expect($("[data-nova-ocorrencia]")).toBeTruthy();
    expect($$("[data-acoes-ocorrencia]")).toHaveLength(4);
  });
});

/* ───────── a lista ───────── */
describe("PMOC › Ocorrências: a lista", () => {
  it("mostra data, equipamento, descrição, gravidade e situação — a mais recente primeiro, sem as excluídas", async () => {
    await abrir();
    expect(naLista()).toEqual(["vazamento", "ruido", "filtro", "corrosao"]);
    const campos = (id: string) => ["data-ocorrencia", "equipamento-ocorrencia", "descricao-ocorrencia"].map((c) => texto(linha(id)!.querySelector(`[data-${c}]`))).concat(texto(linha(id)!.querySelector("[data-gravidade]")), texto(linha(id)!.querySelector("[data-pilula-situacao]")));
    expect(campos("vazamento")).toEqual(["10/11/2026", "AC-001 · Split da recepção", "Vazamento de água na bandeja", "Alta", "Aberta"]);
    expect(campos("ruido")).toEqual(["07/11/2026", "Geral da unidade", "Ruído anormal no compressor", "Crítica", "Em andamento"]);
    expect(campos("filtro")).toEqual(["02/11/2026", "AC-002 · Split UTI 1", "Filtro danificado", "Média", "Resolvida em 04/11/2026"]);
    expect(campos("corrosao")).toEqual(["23/10/2026", "CH-001 · Chiller central", "Corrosão na base", "Baixa", "Aberta"]);
    expect(texto(linha("filtro")!.querySelector("[data-resolucao-ocorrencia]"))).toBe("Resolução: Trocado por um filtro novo");
    expect(linha("vazamento")!.querySelector("[data-resolucao-ocorrencia]")).toBeNull();
    expect(texto($("[data-resumo-ocorrencias]"))).toBe("4 ocorrências: 2 abertas, 1 em andamento e 1 resolvida. Entram no documento do plano.");
    expect(mudancas).toEqual([3]);
  });

  it("a cor acompanha a gravidade e a situação (a palavra está sempre escrita)", async () => {
    await abrir();
    const tom = (id: string, atributo: string) => linha(id)!.querySelector(`[${atributo}]`)!.getAttribute("data-tom");
    expect(["corrosao", "filtro", "vazamento", "ruido"].map((id) => tom(id, "data-gravidade"))).toEqual(["previsto", "atencao", "atrasado", "atrasado-solido"]);
    expect(["vazamento", "ruido", "filtro"].map((id) => tom(id, "data-pilula-situacao"))).toEqual(["atencao", "acento", "ok"]);
  });

  it("a OS onde foi detectada vira link para a OS; o anexo abre pela rota própria, em outra aba", async () => {
    await abrir();
    const os = linha("vazamento")!.querySelector("[data-os-ocorrencia]") as HTMLAnchorElement;
    expect([texto(os), os.getAttribute("href")]).toEqual(["Detectada na OS-101", "/ordens/os1"]);
    const anexo = linha("vazamento")!.querySelector("[data-anexo-ocorrencia]") as HTMLAnchorElement;
    expect([texto(anexo), anexo.getAttribute("href"), anexo.getAttribute("target")]).toEqual(["bandeja.jpg", `${url("vazamento")}/anexo?inline=1`, "_blank"]);
    expect(linha("ruido")!.querySelector("[data-os-ocorrencia], [data-anexo-ocorrencia]")).toBeNull();
  });

  it("plano sem ocorrência: a aba diz isso; erro ao carregar aparece na tela", async () => {
    await abrir([]);
    expect(texto($("[data-sem-ocorrencias]"))).toBe("Nenhuma ocorrência registrada neste plano.");
    expect(texto($("[data-resumo-ocorrencias]"))).toBe("Nenhuma ocorrência registrada. Entram no documento do plano.");
    expect($("[data-limpar-filtros]")).toBeNull();
    expect(($("[data-nova-ocorrencia]") as HTMLButtonElement).disabled).toBe(false);
    responder(`GET ${URL_L}`, { erro: "Sem permissão para esta ação" }, 403);
    await abrir();
    expect(texto($("[data-erro-ocorrencias]"))).toBe("Sem permissão para esta ação");
    expect(naLista()).toEqual([]);
    expect(($("[data-nova-ocorrencia]") as HTMLButtonElement).disabled).toBe(true); // sem a lista não dá para registrar
  });

  it("BUSCA e FILTROS por situação e por gravidade, juntos; 'Excluídas' mostra as excluídas; 'Limpar filtros' volta tudo", async () => {
    await abrir();
    expect(opcoes("[data-filtro-situacao]")).toEqual(["Todas as situações", "Aberta", "Em andamento", "Resolvida", "Excluídas (1)"]);
    expect(opcoes("[data-filtro-gravidade]")).toEqual(["Todas as gravidades", "Baixa", "Média", "Alta", "Crítica"]);
    await digitar("[data-busca-ocorrencias]", "ruido");
    expect(naLista()).toEqual(["ruido"]);
    await digitar("[data-busca-ocorrencias]", "split");
    expect(naLista()).toEqual(["vazamento", "filtro"]);
    await digitar("[data-filtro-situacao]", "RESOLVIDA");
    expect(naLista()).toEqual(["filtro"]);
    await digitar("[data-busca-ocorrencias]", "");
    await digitar("[data-filtro-situacao]", "ABERTA");
    expect(naLista()).toEqual(["vazamento", "corrosao"]);
    await digitar("[data-filtro-gravidade]", "BAIXA");
    expect(naLista()).toEqual(["corrosao"]);
    await digitar("[data-filtro-gravidade]", "CRITICA");
    expect(naLista()).toEqual([]);
    expect(texto($("[data-sem-ocorrencias]"))).toBe("Nenhuma ocorrência com estes filtros.Limpar filtros");
    await clicar($("[data-limpar-filtros]"));
    expect(naLista()).toEqual(["vazamento", "ruido", "filtro", "corrosao"]);
    expect([valor("[data-busca-ocorrencias]"), valor("[data-filtro-situacao]"), valor("[data-filtro-gravidade]")]).toEqual(["", "", ""]);
    // As excluídas: só com o filtro, marcadas, e só com "Restaurar"
    await digitar("[data-filtro-situacao]", "EXCLUIDAS");
    expect(naLista()).toEqual(["engano"]);
    expect(texto(linha("engano")!.querySelector("[data-pilula-situacao]"))).toBe("Excluída");
    expect(texto(linha("engano")!.querySelector("[data-acoes-ocorrencia]"))).toBe("Restaurar");
    expect(pedidos).toHaveLength(1); // buscar e filtrar não vão ao servidor
  });
});

/* ───────── registrar e editar ───────── */
describe("PMOC › Ocorrências: registrar", () => {
  const preencher = async (c: { descricao?: string; gravidade?: string }) => {
    if (c.descricao !== undefined) await digitar(`${M} textarea[aria-label='Descrição do problema']`, c.descricao);
    if (c.gravidade) await clicar($(`${M} [data-gravidade-opcao='${c.gravidade}']`));
  };

  it("o formulário abre com a data de hoje, geral da unidade, aberta, sem gravidade escolhida e sem OS", async () => {
    await abrir();
    await clicar($("[data-nova-ocorrencia]"));
    expect(texto($("[role=dialog] h2, [role=dialog] h3") ?? $(M)!.parentElement!.parentElement)).toContain("Nova ocorrência");
    expect(valor(`${M} input[aria-label='Data da ocorrência']`)).toBe("12/11/2026");
    expect([valor(`${M} select[aria-label='Equipamento']`), valor(`${M} select[aria-label='Situação da ocorrência']`), valor(`${M} select[aria-label='OS onde foi detectada']`)]).toEqual(["", "ABERTA", ""]);
    expect(opcoes(`${M} select[aria-label='Equipamento']`)).toEqual(["Geral da unidade", "AC-001 · Split da recepção", "AC-002 · Split UTI 1"]);
    expect(opcoes(`${M} select[aria-label='Situação da ocorrência']`)).toEqual(["Aberta", "Em andamento", "Resolvida"]);
    expect(opcoes(`${M} select[aria-label='OS onde foi detectada']`)).toEqual(["Nenhuma", "OS-102 · Limpeza Química", "OS-101"]);
    expect($$(`${M} [data-gravidade-opcao]`).map((b) => [texto(b), b.getAttribute("aria-checked")])).toEqual([["Baixa", "false"], ["Média", "false"], ["Alta", "false"], ["Crítica", "false"]]);
    expect($(`${M} [data-campos-resolucao]`)).toBeNull();
    expect(texto($(`${M} [data-enviar-anexo]`))).toBe("Enviar foto ou PDF");
    expect(texto($("[data-salvar-ocorrencia]"))).toBe("Registrar ocorrência");
  });

  it("não vai ao servidor sem descrição, sem gravidade, com data futura ou com resolução fora do intervalo", async () => {
    await abrir();
    await clicar($("[data-nova-ocorrencia]"));
    const erro = async () => { await clicar($("[data-salvar-ocorrencia]")); return texto($(`${M} [data-erro-ocorrencia]`)); };
    expect(await erro()).toBe("Descreva o problema (mín. 3 caracteres).");
    await preencher({ descricao: " ab " });
    expect(await erro()).toBe("Descreva o problema (mín. 3 caracteres).");
    await preencher({ descricao: "Vazamento" });
    expect(await erro()).toBe("Escolha a gravidade.");
    await preencher({ gravidade: "ALTA" });
    await digitar(`${M} input[aria-label='Data da ocorrência']`, "13/11/2026");
    expect(await erro()).toBe("A data da ocorrência não pode ser futura.");
    await digitar(`${M} input[aria-label='Data da ocorrência']`, "10/11/2026");
    await digitar(`${M} select[aria-label='Situação da ocorrência']`, "RESOLVIDA");
    await digitar(`${M} input[aria-label='Data da resolução']`, "09/11/2026");
    expect(await erro()).toBe("A resolução não pode ser antes da data da ocorrência.");
    await digitar(`${M} input[aria-label='Data da resolução']`, "13/11/2026");
    expect(await erro()).toBe("A data da resolução não pode ser futura.");
    expect(escritas()).toEqual([]);
  });

  it("REGISTRA: manda data, equipamento, descrição, gravidade, situação e OS; a nova entra na lista e o diálogo fecha", async () => {
    await abrir();
    await clicar($("[data-nova-ocorrencia]"));
    await digitar(`${M} input[aria-label='Data da ocorrência']`, "11/11/2026");
    await digitar(`${M} select[aria-label='Equipamento']`, "q2");
    await preencher({ descricao: "Falha elétrica no quadro", gravidade: "CRITICA" });
    expect($(`${M} [data-gravidade-opcao='CRITICA']`)!.getAttribute("aria-checked")).toBe("true");
    await digitar(`${M} select[aria-label='Situação da ocorrência']`, "EM_ANDAMENTO");
    await digitar(`${M} select[aria-label='OS onde foi detectada']`, "os2");
    const nova = oc("nova", { data: "2026-11-11", descricao: "Falha elétrica no quadro", gravidade: "CRITICA", situacao: "EM_ANDAMENTO", equipamento: { id: "q2", rotulo: "AC-002 · Split UTI 1", tag: "AC-002" }, criadoEm: "2026-11-12T15:00:00.000Z" });
    responder(`POST ${URL_L}`, nova, 201);
    await clicar($("[data-salvar-ocorrencia]"));
    expect(escritas()).toEqual([{ url: URL_L, metodo: "POST", corpo: { data: "2026-11-11", equipamentoId: "q2", descricao: "Falha elétrica no quadro", gravidade: "CRITICA", situacao: "EM_ANDAMENTO", resolvidaEm: null, resolucao: null, ordemServicoId: "os2" } }]);
    expect($(M)).toBeNull();
    expect(naLista()).toEqual(["nova", "vazamento", "ruido", "filtro", "corrosao"]);
    expect(texto($("[data-resumo-ocorrencias]"))).toMatch(/^5 ocorrências: 2 abertas, 2 em andamento e 1 resolvida\./);
    expect(mudancas).toEqual([3, 4]);
    expect(pedidos.filter((p) => p.metodo === "GET")).toHaveLength(1); // não recarrega a lista
  });

  it("geral da unidade e sem OS vão como vazio (null); 'Resolvida' abre a data (hoje) e o que foi feito, e os dois vão no pedido", async () => {
    await abrir();
    await clicar($("[data-nova-ocorrencia]"));
    await preencher({ descricao: "  Filtro rasgado  ", gravidade: "MEDIA" });
    await digitar(`${M} select[aria-label='Situação da ocorrência']`, "RESOLVIDA");
    expect(valor(`${M} input[aria-label='Data da resolução']`)).toBe("12/11/2026");
    await digitar(`${M} textarea[aria-label='O que foi feito']`, "Filtro trocado");
    responder(`POST ${URL_L}`, oc("nova", { situacao: "RESOLVIDA", resolvidaEm: "2026-11-12", resolucao: "Filtro trocado" }), 201);
    await clicar($("[data-salvar-ocorrencia]"));
    expect(escritas()[0].corpo).toEqual({ data: "2026-11-12", equipamentoId: null, descricao: "  Filtro rasgado  ", gravidade: "MEDIA", situacao: "RESOLVIDA", resolvidaEm: "2026-11-12", resolucao: "Filtro trocado", ordemServicoId: null });
    expect(mudancas).toEqual([3, 3]); // já nasceu resolvida: não soma nas pendentes
    // Voltar para "Aberta" antes de salvar: a resolução preenchida NÃO vai
    await clicar($("[data-nova-ocorrencia]"));
    await preencher({ descricao: "Outra", gravidade: "BAIXA" });
    await digitar(`${M} select[aria-label='Situação da ocorrência']`, "RESOLVIDA");
    await digitar(`${M} textarea[aria-label='O que foi feito']`, "Rascunho");
    await digitar(`${M} select[aria-label='Situação da ocorrência']`, "ABERTA");
    expect($(`${M} [data-campos-resolucao]`)).toBeNull();
    await clicar($("[data-salvar-ocorrencia]"));
    expect(escritas()[1].corpo).toMatchObject({ situacao: "ABERTA", resolvidaEm: null, resolucao: null });
  });

  it("erro do servidor aparece no diálogo, que continua aberto com o que foi digitado; 'Cancelar' fecha sem gravar", async () => {
    await abrir();
    await clicar($("[data-nova-ocorrencia]"));
    await preencher({ descricao: "Vazamento de gás", gravidade: "ALTA" });
    responder(`POST ${URL_L}`, { erro: "PMOC inativo: reative antes de editar." }, 409);
    await clicar($("[data-salvar-ocorrencia]"));
    expect(texto($(`${M} [data-erro-ocorrencia]`))).toBe("PMOC inativo: reative antes de editar.");
    expect(valor(`${M} textarea[aria-label='Descrição do problema']`)).toBe("Vazamento de gás");
    expect(naLista()).toHaveLength(4);
    responder(`POST ${URL_L}`, {}, 500);
    await clicar($("[data-salvar-ocorrencia]"));
    expect(texto($(`${M} [data-erro-ocorrencia]`))).toBe("Não foi possível salvar a ocorrência.");
    await clicar($$(`${M} button`).find((b) => texto(b) === "Cancelar"));
    expect($(M)).toBeNull();
    expect(mudancas).toEqual([3]);
  });
});

describe("PMOC › Ocorrências: foto ou anexo", () => {
  async function escolher(arquivo: File) {
    const input = $(`${M} input[aria-label='Foto ou anexo da ocorrência']`) as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [arquivo] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
  }
  const arquivo = (nome: string, tipo: string, tamanho = 1000) => new File([new Uint8Array(tamanho)], nome, { type: tipo });
  const salvarCom = async () => {
    await digitar(`${M} textarea[aria-label='Descrição do problema']`, "Vazamento");
    await clicar($(`${M} [data-gravidade-opcao='ALTA']`));
    responder(`POST ${URL_L}`, oc("nova"), 201);
    await clicar($("[data-salvar-ocorrencia]"));
    return escritas().at(-1)!.corpo;
  };

  it("a FOTO é reduzida antes de enviar (como nos outros módulos) e vai como .jpg; o campo aceita foto e PDF", async () => {
    await abrir();
    await clicar($("[data-nova-ocorrencia]"));
    expect(($(`${M} input[aria-label='Foto ou anexo da ocorrência']`) as HTMLInputElement).accept).toBe("image/*,application/pdf");
    expect(texto($(M))).toContain("Foto (reduzida ao enviar) ou PDF até 3 MB.");
    const foto = arquivo("IMG_2031.HEIC", "image/heic", 7 * 1024 * 1024); // foto de celular, bem acima de 3 MB
    await escolher(foto);
    expect(reducao.fn).toHaveBeenCalledWith(foto, 1600, 0.82);
    expect(texto($(`${M} [data-anexo-formulario]`))).toBe("IMG_2031.jpga salvar");
    expect(await salvarCom()).toMatchObject({ anexo: "data:image/jpeg;base64,UkVEVVpJREE=", anexoNome: "IMG_2031.jpg" });
    expect(escritas().at(-1)!.corpo).not.toHaveProperty("removerAnexo");
  });

  it("PDF vai como é; acima de 3 MB é recusado sem sair do navegador; foto que continua grande depois de reduzida, também", async () => {
    await abrir();
    await clicar($("[data-nova-ocorrencia]"));
    await escolher(arquivo("laudo.pdf", "application/pdf", 3 * 1024 * 1024 + 1));
    expect(texto($(`${M} [data-erro-ocorrencia]`))).toBe("Anexo acima de 3 MB.");
    expect($(`${M} [data-anexo-formulario]`)).toBeNull();
    await escolher(arquivo("laudo.pdf", "application/pdf", 3 * 1024 * 1024));
    expect(texto($(`${M} [data-anexo-formulario]`))).toBe("laudo.pdfa salvar");
    expect($(`${M} [data-erro-ocorrencia]`)).toBeNull();
    expect(reducao.fn).not.toHaveBeenCalled();
    const corpo = await salvarCom();
    expect(corpo.anexoNome).toBe("laudo.pdf");
    expect(corpo.anexo).toMatch(/^data:application\/pdf;base64,/);
    // Foto que, mesmo reduzida, passa de 3 MB
    await clicar($("[data-nova-ocorrencia]"));
    reducao.fn.mockResolvedValueOnce({ imagem: { dataUrl: "data:image/jpeg;base64,AAAA", largura: 1, altura: 1, bytes: 3 * 1024 * 1024 + 1 }, qualidade: {} });
    await escolher(arquivo("enorme.jpg", "image/jpeg"));
    expect(texto($(`${M} [data-erro-ocorrencia]`))).toBe("Anexo acima de 3 MB.");
    expect($(`${M} [data-anexo-formulario]`)).toBeNull();
  });

  it("outro tipo de arquivo é recusado; se a redução falhar, JPG e PNG seguem como vieram e os outros formatos não", async () => {
    await abrir();
    await clicar($("[data-nova-ocorrencia]"));
    await escolher(arquivo("planilha.xlsx", "application/vnd.ms-excel"));
    expect(texto($(`${M} [data-erro-ocorrencia]`))).toBe("O anexo deve ser foto (JPG ou PNG) ou PDF.");
    expect(reducao.fn).not.toHaveBeenCalled();
    reducao.fn.mockRejectedValue(new Error("sem canvas"));
    await escolher(arquivo("foto.heic", "image/heic"));
    expect(texto($(`${M} [data-erro-ocorrencia]`))).toBe("O anexo deve ser foto (JPG ou PNG) ou PDF.");
    expect($(`${M} [data-anexo-formulario]`)).toBeNull();
    await escolher(arquivo("foto.png", "image/png", 3 * 1024 * 1024 + 1));
    expect(texto($(`${M} [data-erro-ocorrencia]`))).toBe("Anexo acima de 3 MB.");
    await escolher(arquivo("foto.png", "image/png"));
    expect(texto($(`${M} [data-anexo-formulario]`))).toBe("foto.pnga salvar");
    expect($(`${M} [data-erro-ocorrencia]`)).toBeNull();
    expect((await salvarCom()).anexo).toMatch(/^data:image\/png;base64,/);
  });

  it("na edição: o anexo gravado aparece; excluir manda `removerAnexo`; trocar manda o novo; sem mexer, não manda nada", async () => {
    await abrir();
    const corpoDe = async (acao: () => Promise<void>) => {
      await clicar(linha("vazamento")!.querySelector("[data-editar]"));
      expect(texto($(`${M} [data-anexo-formulario]`))).toBe("bandeja.jpg");
      await acao();
      responder(`PUT ${url("vazamento")}`, VAZAMENTO);
      await clicar($("[data-salvar-ocorrencia]"));
      return escritas().at(-1)!.corpo;
    };
    const semMexer = await corpoDe(async () => {});
    expect(Object.keys(semMexer).filter((k) => /anexo/i.test(k))).toEqual([]);
    const excluido = await corpoDe(async () => { await clicar($(`${M} [data-remover-anexo]`)); expect($(`${M} [data-anexo-formulario]`)).toBeNull(); });
    expect(excluido).toMatchObject({ removerAnexo: true });
    expect(excluido).not.toHaveProperty("anexo");
    const trocado = await corpoDe(async () => { await clicar($(`${M} [data-remover-anexo]`)); await escolher(arquivo("nova.jpg", "image/jpeg")); });
    expect(trocado).toMatchObject({ anexo: "data:image/jpeg;base64,UkVEVVpJREE=", anexoNome: "nova.jpg" });
    expect(trocado).not.toHaveProperty("removerAnexo");
    // Anexo escolhido e tirado antes de salvar, numa ocorrência que não tinha: nada a remover
    await clicar(linha("ruido")!.querySelector("[data-editar]"));
    await escolher(arquivo("x.jpg", "image/jpeg"));
    await clicar($(`${M} [data-remover-anexo]`));
    responder(`PUT ${url("ruido")}`, RUIDO);
    await clicar($("[data-salvar-ocorrencia]"));
    expect(Object.keys(escritas().at(-1)!.corpo).filter((k) => /anexo/i.test(k))).toEqual([]);
  });
});

describe("PMOC › Ocorrências: editar", () => {
  it("abre com o que está gravado e salva por PUT; a linha é atualizada no lugar", async () => {
    await abrir();
    await clicar(linha("filtro")!.querySelector("[data-editar]"));
    expect(valor(`${M} input[aria-label='Data da ocorrência']`)).toBe("02/11/2026");
    expect([valor(`${M} select[aria-label='Equipamento']`), valor(`${M} textarea[aria-label='Descrição do problema']`), valor(`${M} select[aria-label='Situação da ocorrência']`)]).toEqual(["q2", "Filtro danificado", "RESOLVIDA"]);
    expect($(`${M} [data-gravidade-opcao='MEDIA']`)!.getAttribute("aria-checked")).toBe("true");
    expect([valor(`${M} input[aria-label='Data da resolução']`), valor(`${M} textarea[aria-label='O que foi feito']`)]).toEqual(["04/11/2026", "Trocado por um filtro novo"]);
    expect(texto($("[data-salvar-ocorrencia]"))).toBe("Salvar");
    await digitar(`${M} textarea[aria-label='Descrição do problema']`, "Filtro danificado, com a tela rasgada");
    await clicar($(`${M} [data-gravidade-opcao='ALTA']`));
    responder(`PUT ${url("filtro")}`, { ...FILTRO, descricao: "Filtro danificado, com a tela rasgada", gravidade: "ALTA" });
    await clicar($("[data-salvar-ocorrencia]"));
    expect(escritas()).toEqual([{ url: url("filtro"), metodo: "PUT", corpo: {
      data: "2026-11-02", equipamentoId: "q2", descricao: "Filtro danificado, com a tela rasgada", gravidade: "ALTA", situacao: "RESOLVIDA", resolvidaEm: "2026-11-04", resolucao: "Trocado por um filtro novo", ordemServicoId: null,
    } }]);
    expect($(M)).toBeNull();
    expect(naLista()).toEqual(["vazamento", "ruido", "filtro", "corrosao"]);
    expect(texto(linha("filtro")!.querySelector("[data-descricao-ocorrencia]"))).toBe("Filtro danificado, com a tela rasgada");
    expect(texto(linha("filtro")!.querySelector("[data-gravidade]"))).toBe("Alta");
  });

  it("equipamento que saiu do plano e OS fora da lista recente continuam escolhidos na edição (marcados)", async () => {
    await abrir([CORROSAO, oc("antiga", { ordemServico: { id: "os-velha", numero: "OS-007" } })]);
    await clicar(linha("corrosao")!.querySelector("[data-editar]"));
    expect(valor(`${M} select[aria-label='Equipamento']`)).toBe("q3");
    expect(opcoes(`${M} select[aria-label='Equipamento']`)).toEqual(["Geral da unidade", "AC-001 · Split da recepção", "AC-002 · Split UTI 1", "CH-001 · Chiller central (fora do plano)"]);
    await clicar($$(`${M} button`).find((b) => texto(b) === "Cancelar"));
    await clicar(linha("antiga")!.querySelector("[data-editar]"));
    expect(valor(`${M} select[aria-label='OS onde foi detectada']`)).toBe("os-velha");
    expect(opcoes(`${M} select[aria-label='OS onde foi detectada']`)).toEqual(["Nenhuma", "OS-007", "OS-102 · Limpeza Química", "OS-101"]);
    expect(opcoes(`${M} select[aria-label='Equipamento']`)).toHaveLength(3); // o q1 já está no plano: não repete
  });
});

/* ───────── resolver, reabrir, excluir e restaurar ───────── */
describe("PMOC › Ocorrências: resolver e reabrir", () => {
  const R = "[data-modal-resolver]";
  it("'Resolver' só aparece na que não está resolvida; a resolvida tem 'Reabrir'", async () => {
    await abrir();
    const botoes = (id: string) => ["resolver", "reabrir", "editar", "excluir", "restaurar"].filter((b) => linha(id)!.querySelector(`[data-${b}]`));
    expect(botoes("vazamento")).toEqual(["resolver", "editar", "excluir"]);
    expect(botoes("ruido")).toEqual(["resolver", "editar", "excluir"]);
    expect(botoes("filtro")).toEqual(["reabrir", "editar", "excluir"]);
  });

  it("RESOLVER: o diálogo diz qual é, propõe hoje, e manda a data e o que foi feito; a linha passa a 'Resolvida em …'", async () => {
    await abrir();
    await clicar(linha("ruido")!.querySelector("[data-resolver]"));
    expect(texto($(`${R} p`))).toBe("Geral da unidade · 07/11/2026 · Ruído anormal no compressor");
    expect(valor(`${R} input[aria-label='Data da resolução']`)).toBe("12/11/2026");
    await digitar(`${R} input[aria-label='Data da resolução']`, "06/11/2026");
    await clicar($("[data-confirmar-resolver]"));
    expect(texto($(`${R} [data-erro-ocorrencia]`))).toBe("A resolução não pode ser antes da data da ocorrência.");
    await digitar(`${R} input[aria-label='Data da resolução']`, "13/11/2026");
    await clicar($("[data-confirmar-resolver]"));
    expect(texto($(`${R} [data-erro-ocorrencia]`))).toBe("A data da resolução não pode ser futura.");
    expect(escritas()).toEqual([]);
    await digitar(`${R} input[aria-label='Data da resolução']`, "11/11/2026");
    await digitar(`${R} textarea[aria-label='O que foi feito']`, "Coxins trocados");
    responder(`PATCH ${url("ruido")}`, { ...RUIDO, situacao: "RESOLVIDA", resolvidaEm: "2026-11-11", resolucao: "Coxins trocados" });
    await clicar($("[data-confirmar-resolver]"));
    expect(escritas()).toEqual([{ url: url("ruido"), metodo: "PATCH", corpo: { situacao: "RESOLVIDA", resolvidaEm: "2026-11-11", resolucao: "Coxins trocados" } }]);
    expect($(R)).toBeNull();
    expect(texto(linha("ruido")!.querySelector("[data-pilula-situacao]"))).toBe("Resolvida em 11/11/2026");
    expect(texto(linha("ruido")!.querySelector("[data-resolucao-ocorrencia]"))).toBe("Resolução: Coxins trocados");
    expect(linha("ruido")!.querySelector("[data-resolver]")).toBeNull();
    expect(mudancas).toEqual([3, 2]);
  });

  it("erro ao resolver fica no diálogo; cancelar não muda nada", async () => {
    await abrir();
    await clicar(linha("vazamento")!.querySelector("[data-resolver]"));
    responder(`PATCH ${url("vazamento")}`, { erro: "Ocorrência excluída: restaure antes de editar." }, 409);
    await clicar($("[data-confirmar-resolver]"));
    expect(texto($(`${R} [data-erro-ocorrencia]`))).toBe("Ocorrência excluída: restaure antes de editar.");
    await clicar($$(`${R} button`).find((b) => texto(b) === "Cancelar"));
    expect($(R)).toBeNull();
    expect(texto(linha("vazamento")!.querySelector("[data-pilula-situacao]"))).toBe("Aberta");
    expect(mudancas).toEqual([3]);
  });

  it("REABRIR é um clique: manda a situação Aberta e a linha volta a ter 'Resolver'; erro aparece na lista", async () => {
    await abrir();
    responder(`PATCH ${url("filtro")}`, { ...FILTRO, situacao: "ABERTA", resolvidaEm: null, resolucao: null });
    await clicar(linha("filtro")!.querySelector("[data-reabrir]"));
    expect(escritas()).toEqual([{ url: url("filtro"), metodo: "PATCH", corpo: { situacao: "ABERTA" } }]);
    expect(texto(linha("filtro")!.querySelector("[data-pilula-situacao]"))).toBe("Aberta");
    expect(linha("filtro")!.querySelector("[data-resolver]")).toBeTruthy();
    expect(linha("filtro")!.querySelector("[data-resolucao-ocorrencia]")).toBeNull();
    expect(mudancas).toEqual([3, 4]);
    // Erro numa ação de um clique
    await abrir();
    responder(`PATCH ${url("filtro")}`, { erro: "PMOC inativo: reative antes de editar." }, 409);
    await clicar(linha("filtro")!.querySelector("[data-reabrir]"));
    expect(texto($("[data-erro-ocorrencias]"))).toBe("PMOC inativo: reative antes de editar.");
    expect(texto(linha("filtro")!.querySelector("[data-pilula-situacao]"))).toBe("Resolvida em 04/11/2026");
  });
});

describe("PMOC › Ocorrências: excluir e restaurar", () => {
  const X = "[data-modal-excluir]";
  it("EXCLUIR pede confirmação, diz o que acontece e só então manda o DELETE; a linha sai da lista e vai para 'Excluídas'", async () => {
    await abrir();
    await clicar(linha("vazamento")!.querySelector("[data-excluir]"));
    expect(texto($(`${X} p`))).toBe("AC-001 · Split da recepção · 10/11/2026 · Vazamento de água na bandeja");
    expect(texto($(X))).toContain("Ela sai da lista e do documento do plano. Fica guardada: o filtro “Excluídas” mostra e permite restaurar.");
    expect(escritas()).toEqual([]);
    await clicar($$(`${X} button`).find((b) => texto(b) === "Cancelar"));
    expect($(X)).toBeNull();
    expect(naLista()).toContain("vazamento");
    expect(escritas()).toEqual([]);

    await clicar(linha("vazamento")!.querySelector("[data-excluir]"));
    responder(`DELETE ${url("vazamento")}`, { ...VAZAMENTO, ativo: false });
    await clicar($("[data-confirmar-excluir]"));
    expect(escritas()).toEqual([{ url: url("vazamento"), metodo: "DELETE", corpo: undefined }]);
    expect($(X)).toBeNull();
    expect(naLista()).toEqual(["ruido", "filtro", "corrosao"]);
    expect(opcoes("[data-filtro-situacao]").at(-1)).toBe("Excluídas (2)");
    expect(texto($("[data-resumo-ocorrencias]"))).toMatch(/^3 ocorrências: 1 aberta, 1 em andamento e 1 resolvida\./);
    expect(mudancas).toEqual([3, 2]);
  });

  it("erro ao excluir fica no diálogo e a ocorrência continua na lista", async () => {
    await abrir();
    await clicar(linha("ruido")!.querySelector("[data-excluir]"));
    responder(`DELETE ${url("ruido")}`, { erro: "Sem permissão para esta ação" }, 403);
    await clicar($("[data-confirmar-excluir]"));
    expect(texto($(`${X} [data-erro-ocorrencia]`))).toBe("Sem permissão para esta ação");
    expect(naLista()).toContain("ruido");
  });

  it("RESTAURAR (no filtro 'Excluídas') devolve a ocorrência à lista", async () => {
    await abrir();
    await digitar("[data-filtro-situacao]", "EXCLUIDAS");
    responder(`PATCH ${url("engano")}`, { ...ENGANO, ativo: true });
    await clicar(linha("engano")!.querySelector("[data-restaurar]"));
    expect(escritas()).toEqual([{ url: url("engano"), metodo: "PATCH", corpo: { restaurar: true } }]);
    expect(naLista()).toEqual([]); // saiu das excluídas
    expect(opcoes("[data-filtro-situacao]").at(-1)).toBe("Excluídas");
    await digitar("[data-filtro-situacao]", "");
    expect(naLista()).toEqual(["engano", "vazamento", "ruido", "filtro", "corrosao"]);
    expect(mudancas).toEqual([3, 4]);
  });
});

describe("PMOC › Ocorrências: só leitura", () => {
  it("sem poder editar: a lista, a busca e os filtros funcionam; nenhum botão de mudança existe", async () => {
    await abrir(LISTA, { somenteLeitura: true });
    expect(naLista()).toEqual(["vazamento", "ruido", "filtro", "corrosao"]);
    expect($$("[data-nova-ocorrencia], [data-acoes-ocorrencia], [data-resolver], [data-editar], [data-excluir], [data-reabrir]")).toHaveLength(0);
    await digitar("[data-filtro-situacao]", "EXCLUIDAS");
    expect(naLista()).toEqual(["engano"]);
    expect($("[data-restaurar]")).toBeNull();
    expect(linha("engano")).toBeTruthy();
    await digitar("[data-filtro-situacao]", "");
    await digitar("[data-busca-ocorrencias]", "chiller");
    expect(naLista()).toEqual(["corrosao"]);
    expect(escritas()).toEqual([]);
  });
});
