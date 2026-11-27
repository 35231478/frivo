// @vitest-environment happy-dom
/**
 * App de campo, leva 2 (PR B) — DESPESAS DE CAMPO na TELA, num DOM de verdade, com o banco do aparelho e o motor reais:
 *  - técnico: "Lançar despesa" no Meu dia e na OS (some com a permissão desligada); o lançamento só sai completo (com a
 *    foto do cupom; "Outros" pede descrição); sem sinal fica no aparelho e sobe sozinho; "Minhas despesas" com a
 *    situação, o motivo da recusa e o envio recusado;
 *  - escritório: Financeiro › Despesas de campo (aprovar do bolso com vencimento e categoria; pela empresa sem nada;
 *    recusar só com motivo; categorias; quem só vê não decide) e o card na OS (custo = só as aprovadas).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { SEM_OS, type DespesaTela } from "@/lib/tecnico/despesas";
import type { CartaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
const FOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
// A câmera do aparelho: o botão entrega a foto já pronta (a compressão tem teste próprio)
vi.mock("@/components/tecnico/captura", async () => {
  const { createElement: ce } = await import("react");
  return {
    BotaoFoto: ({ onFoto, rotulo }: { onFoto: (d: string) => void; rotulo?: string }) => ce("button", { type: "button", "data-foto-falsa": "", onClick: () => onFoto(FOTO) }, rotulo ?? "Tirar foto"),
    Miniatura: ({ src, onRemover }: { src: string; onRemover?: () => void }) => ce("div", { "data-miniatura": "" }, ce("img", { src }), onRemover && ce("button", { type: "button", "data-remover-foto": "", onClick: onRemover }, "x")),
  };
});

const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z");
const HOJE = "2026-11-12";
let online = true;
let enviadas: any[] = [];
let servidor: DespesaTela[] = [];
let recusarNoServidor = false;
const cartao = (): CartaoTela => ({
  atividadeId: "aA", osId: "osA", osNumero: "OS-1", titulo: "Preventiva", tipoOs: null, status: "EM_ANDAMENTO", prioridade: "NORMAL", dataAgendada: null, dia: HOJE, hora: "09:00",
  duracaoMin: 60, cliente: "Hospital", telefone: null, unidade: "Matriz", endereco: "Av. Paulista", rota: null, descricao: "Preventiva", equipamentos: 0, atendidos: 0, adicionais: 0, avisos: {},
} as CartaoTela);
const retrato = (): RetratoAtividade => ({
  cartao: cartao(),
  execucao: {
    atividade: { id: "aA", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "osA", numero: "OS-1", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
    bloqueada: false, adicionais: [], avisos: {}, materiais: [], comentarios: [], equipamentos: [],
    conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null, dispensa: null },
  },
  equipamentosUnidade: [], checklistsPorTipo: {}, cadastro: null, avisoCliente: null, geradoEm: new Date().toISOString(),
} as unknown as RetratoAtividade);
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: { id: "t1", nome: "João" }, dia: HOJE, atividades: [cartao()], anteriores: [] });
  if (url === "/api/tecnico/catalogo") return json({ produtos: [] });
  if (url === "/api/tecnico/despesas") return json({ despesas: servidor });
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato());
  if (url === "/api/tecnico/sync") {
    const corpo = JSON.parse(String(init!.body));
    enviadas.push(...corpo.operacoes);
    const resultados = corpo.operacoes.map((o: any) => {
      if (o.tipo === "despesa" && recusarNoServidor) return { id: o.id, ok: false, status: 422, erro: "A data não pode ser no futuro." };
      if (o.tipo === "despesa") servidor = [{ ...o.dados, id: `s-${o.dados.clientId}`, descricao: o.dados.descricao ?? null, osNumero: o.atividadeId === SEM_OS ? null : "OS-1", situacao: "PENDENTE", motivoRecusa: null, foto: undefined } as DespesaTela, ...servidor];
      return { id: o.id, ok: true, status: 201, dados: {} };
    });
    return json({ resultados });
  }
  return json({}, 404);
});

let root: Root; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync;
beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/meu-dia"), import("@/components/tecnico/execucao"), import("@/components/tecnico/despesas"),
    import("@/components/financeiro/despesas-campo-view"), import("@/components/os/despesas-campo-os")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; enviadas = []; servidor = []; recusarNoServidor = false;
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  banco = await BancoTecnico.abrir("uT");
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
  window.history.replaceState(null, "", "/tecnico");
  vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation(() => {});
});
afterEach(() => {
  if (root) act(() => root.unmount());
  caixa?.remove(); document.body.innerHTML = "";
  root = undefined as unknown as Root;
  banco.fechar(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});

const USUARIO = { id: "uT", nome: "João", email: "joao@clima.com", empresaNome: "Clima", podeGravar: true };
const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg = "condição") { for (let i = 0; i < 150; i++) { if (cond()) return; await esperar(1); } throw new Error(`não aconteceu: ${msg}`); }
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const digitar = async (el: HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement | null, valor: string) => {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor); el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
  await esperar();
};
async function abrirApp(endereco = "/tecnico", config = CONFIG_APP_PADRAO) {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { MeuDia } = await import("@/components/tecnico/meu-dia");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  const { VistaDespesas } = await import("@/components/tecnico/despesas");
  function Vistas() {
    const v = useVista();
    if (!v) return null;
    if (v.ver === "os") return createElement(VistaOs, { key: v.a, atividadeId: v.a });
    if (v.ver === "despesas") return createElement(VistaDespesas);
    return createElement(MeuDia);
  }
  window.history.replaceState(null, "", endereco);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: USUARIO, config, motorPronto: motor, children: createElement(Vistas) })); });
  await esperarAte(() => !!$("[data-vista]") && !$("[data-carregando]") && !$(".animate-spin"), "tela");
  await esperar();
}
const fechar = () => { act(() => root.unmount()); caixa.remove(); document.body.innerHTML = ""; };
const salvar = () => $<HTMLButtonElement>("[data-salvar-despesa]")!;

describe("técnico: lançar despesa", () => {
  it("o botão está no Meu dia (sem OS) e na OS (desta OS); com a permissão desligada, some dos dois e de Minhas despesas", async () => {
    await abrirApp();
    expect(texto($(`[data-lancar-despesa="${SEM_OS}"]`))).toBe("Lançar despesa");
    fechar();
    await abrirApp("/tecnico?ver=os&a=aA");
    expect(texto($('[data-lancar-despesa="aA"]'))).toBe("Lançar despesa desta OS");
    fechar();
    const desligada = { ...CONFIG_APP_PADRAO, lancarDespesas: false };
    await abrirApp("/tecnico", desligada);
    expect($("[data-lancar-despesa]")).toBeNull();
    fechar();
    await abrirApp("/tecnico?ver=os&a=aA", desligada);
    expect($("[data-lancar-despesa]")).toBeNull();
    fechar();
    await abrirApp("/tecnico?ver=despesas", desligada);
    expect($("[data-lancar-despesa]")).toBeNull();
  });

  it("só lança completo: categoria, valor > 0, como pagou e a FOTO do cupom; 'Outros' pede descrição", async () => {
    await abrirApp();
    await clicar($(`[data-lancar-despesa="${SEM_OS}"]`));
    expect($$("[data-modal-despesa] [data-categoria]").map(texto)).toEqual(["Combustível", "Pedágio", "Estacionamento", "Alimentação", "Hospedagem", "Material comprado em campo", "Outros"]);
    expect(salvar().disabled).toBe(true);
    await clicar($('[data-categoria="COMBUSTIVEL"]'));
    await digitar($("[data-valor-despesa-campo]"), "0");
    expect($("[data-valor-invalido]")).not.toBeNull();
    await digitar($("[data-valor-despesa-campo]"), "187,40");
    expect($("[data-valor-invalido]")).toBeNull();
    await clicar($('[data-modal-despesa] [data-pagamento="PROPRIO"]'));
    expect(salvar().disabled).toBe(true); // falta a foto
    await clicar($("[data-foto-falsa]"));
    expect(salvar().disabled).toBe(false);
    await clicar($('[data-categoria="OUTROS"]'));
    expect(salvar().disabled).toBe(true);
    await digitar($("[data-descricao-despesa]"), "Chaveiro");
    expect(salvar().disabled).toBe(false);
    await clicar($("[data-remover-foto]"));
    expect(salvar().disabled).toBe(true);
  });

  it("sem sinal: grava no aparelho (fila, sem OS) e aparece em Minhas despesas como 'No aparelho'; com sinal sobe e vira 'Aguardando aprovação'", async () => {
    await abrirApp();
    online = false;
    await clicar($(`[data-lancar-despesa="${SEM_OS}"]`));
    await clicar($('[data-categoria="PEDAGIO"]'));
    await digitar($("[data-valor-despesa-campo]"), "12,50");
    await clicar($('[data-modal-despesa] [data-pagamento="EMPRESA"]'));
    await clicar($("[data-foto-falsa]"));
    await clicar(salvar());
    expect($("[data-modal-despesa]")).toBeNull();
    const fila = (await banco.fila()).filter((o) => o.tipo === "despesa");
    expect(fila).toHaveLength(1);
    expect(fila[0].atividadeId).toBe(SEM_OS);
    expect((fila[0] as any).dados).toEqual({ clientId: expect.any(String), categoria: "PEDAGIO", valor: 12.5, data: HOJE, pagamento: "EMPRESA", foto: FOTO });
    fechar();
    await abrirApp("/tecnico?ver=despesas");
    await esperarAte(() => !!$("[data-despesa][data-pendente]"), "no aparelho");
    expect(texto($("[data-despesa][data-pendente] [data-situacao-despesa]"))).toBe("No aparelho");
    expect(texto($("[data-despesa] [data-valor-despesa]"))).toBe("R$ 12,50");
    online = true;
    await act(async () => { await motor.sincronizar(true); });
    await esperarAte(() => !$("[data-despesa][data-pendente]") && !!$("[data-despesa]"), "subiu");
    expect(enviadas.filter((o) => o.tipo === "despesa")).toHaveLength(1);
    expect($$("[data-despesa]")).toHaveLength(1);
    expect(texto($("[data-situacao-despesa]"))).toBe("Aguardando aprovação");
    expect((await banco.fila()).filter((o) => o.tipo === "despesa")).toHaveLength(0); // a fila se limpa depois da lista nova
  });

  it("da OS: a fila leva a atividade (a despesa fica ligada à OS)", async () => {
    await abrirApp("/tecnico?ver=os&a=aA");
    online = false;
    await clicar($('[data-lancar-despesa="aA"]'));
    expect(texto($("[role=dialog] h2, [data-modal-despesa]")?.closest("[role=dialog]") ?? document.body)).toContain("Despesa · OS-1");
    await clicar($('[data-categoria="ESTACIONAMENTO"]'));
    await digitar($("[data-valor-despesa-campo]"), "18");
    await clicar($('[data-modal-despesa] [data-pagamento="EMPRESA"]'));
    await clicar($("[data-foto-falsa]"));
    await clicar(salvar());
    const [op] = (await banco.fila()).filter((o) => o.tipo === "despesa");
    expect([op.atividadeId, (op as any).dados.categoria]).toEqual(["aA", "ESTACIONAMENTO"]);
  });

  it("Minhas despesas: situação, OS, como pagou, motivo da recusa; o envio recusado pelo servidor aparece como 'Não enviada' com o motivo", async () => {
    servidor = [
      { id: "1", clientId: "a", categoria: "COMBUSTIVEL", valor: 187.4, data: "2026-11-10", pagamento: "PROPRIO", descricao: "Van", osNumero: null, situacao: "REEMBOLSADA", motivoRecusa: null },
      { id: "2", clientId: "b", categoria: "HOSPEDAGEM", valor: 220, data: "2026-11-09", pagamento: "PROPRIO", descricao: null, osNumero: "OS-7", situacao: "RECUSADA", motivoRecusa: "Cupom ilegível." },
    ];
    recusarNoServidor = true;
    await abrirApp("/tecnico?ver=despesas");
    await esperarAte(() => $$("[data-despesa]").length === 2, "lista");
    expect($$("[data-situacao-despesa]").map(texto)).toEqual(["Reembolsada", "Recusada"]);
    expect(texto($("[data-despesa='REEMBOLSADA'] p"))).toBe("10/11/2026 · Do meu bolso · Van");
    expect(texto($("[data-motivo-recusa]"))).toBe("Motivo: Cupom ilegível.");
    await clicar($("[data-vista=despesas] > [data-lancar-despesa]"));
    await clicar($('[data-categoria="ALIMENTACAO"]'));
    await digitar($("[data-valor-despesa-campo]"), "35");
    await clicar($('[data-modal-despesa] [data-pagamento="PROPRIO"]'));
    await clicar($("[data-foto-falsa]"));
    await clicar(salvar());
    await act(async () => { await motor.sincronizar(true); });
    await esperarAte(() => !!$("[data-erro-envio]"), "não enviada");
    expect(texto($("[data-situacao-despesa='NAO_ENVIADA']"))).toBe("Não enviada");
    expect(texto($("[data-erro-envio]"))).toBe("A data não pode ser no futuro.");
  });

  it("sem colaborador ligado: o aviso no lugar do botão", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u: string, i?: RequestInit) => (u === "/api/tecnico/despesas" ? json({ despesas: [], aviso: "Seu usuário não está ligado a um colaborador. Fale com o escritório." }) : fetchFalso(u, i))));
    motor = new MotorSync(banco, { fetch: globalThis.fetch as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
    await abrirApp("/tecnico?ver=despesas");
    await esperarAte(() => !!$("[data-aviso-despesas]"), "aviso");
    expect($("[data-vista=despesas] > [data-lancar-despesa]")).toBeNull();
  });
});

/* ───────── escritório ───────── */

const D = (x: Record<string, unknown>) => ({
  id: "d1", colaborador: "João Silva", categoria: "COMBUSTIVEL", categoriaNome: "Combustível", valor: 187.4, data: "2026-11-10", pagamento: "PROPRIO", descricao: "Van",
  os: null, status: "PENDENTE", motivoRecusa: null, decididoPor: null, decididoEm: null, contaPagar: null, criadoEm: "2026-11-10T12:00:00.000Z", ...x,
});
let pedidos: { url: string; metodo: string; corpo: any }[] = [];
let lista: any[] = [];
const CATS = { mapa: {}, ativas: [{ id: "cfC", nome: "Combustível" }, { id: "cfV", nome: "Veículos" }], efetivas: { COMBUSTIVEL: "cfC", PEDAGIO: null, ESTACIONAMENTO: null, ALIMENTACAO: null, HOSPEDAGEM: null, MATERIAL: null, OUTROS: null } };
async function montarEscritorio(podeDecidir = true) {
  pedidos = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    pedidos.push({ url: u, metodo: init?.method ?? "GET", corpo: init?.body ? JSON.parse(String(init.body)) : null });
    if (u === "/api/despesas-campo/categorias" && !init?.method) return json(CATS);
    if (u.startsWith("/api/despesas-campo?")) return json({ despesas: lista });
    if (u.endsWith("/aprovar")) return json({ contaPagarId: "cp1" });
    return json({ ok: true });
  }));
  const { DespesasCampoView } = await import("@/components/financeiro/despesas-campo-view");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(DespesasCampoView, { podeDecidir })); });
  await esperarAte(() => !$(".animate-spin"), "lista");
  await esperar();
}

describe("escritório: Financeiro › Despesas de campo", () => {
  it("lista as pendentes com o resumo; a do bolso pede vencimento (sugere +7 dias) e manda a categoria; a da empresa não manda nada", async () => {
    lista = [D({}), D({ id: "d2", categoria: "ESTACIONAMENTO", categoriaNome: "Estacionamento", valor: 18, pagamento: "EMPRESA", descricao: null, os: { id: "osA", numero: "OS-1" } })];
    await montarEscritorio();
    expect(pedidos[0].url).toBe("/api/despesas-campo?status=PENDENTE");
    expect(texto($("[data-resumo]"))).toBe("2 a aprovar · R$ 205,40 · R$ 187,40 de reembolso");
    expect(texto($("[data-despesa-campo=d1]"))).toContain("Do bolso do colaborador");
    expect(texto($("[data-despesa-campo=d2]"))).toContain("Pago pela empresa · OS-1");
    await clicar($("[data-despesa-campo=d1] [data-aprovar]"));
    expect((document.querySelector("[data-modal-aprovar] input") as HTMLInputElement).value).toBe("19/11/2026");
    expect(($("[data-categoria-financeira]") as HTMLSelectElement).value).toBe("cfC");
    await digitar($("[data-categoria-financeira]"), "cfV");
    await clicar($("[data-confirmar-aprovar]"));
    expect(pedidos.find((p) => p.metodo === "POST")).toEqual({ url: "/api/despesas-campo/d1/aprovar", metodo: "POST", corpo: { vencimento: "2026-11-19", categoriaId: "cfV" } });
    await clicar($("[data-despesa-campo=d2] [data-aprovar]"));
    expect($("[data-sem-reembolso]")).not.toBeNull();
    expect($("[data-categoria-financeira]")).toBeNull();
    await clicar($("[data-confirmar-aprovar]"));
    expect(pedidos.filter((p) => p.metodo === "POST")[1]).toEqual({ url: "/api/despesas-campo/d2/aprovar", metodo: "POST", corpo: {} });
  });

  it("recusar só com motivo (3+ letras), enviado sem espaços nas pontas", async () => {
    lista = [D({})];
    await montarEscritorio();
    await clicar($("[data-recusar]"));
    const ok = () => $<HTMLButtonElement>("[data-confirmar-recusar]")!.disabled;
    expect(ok()).toBe(true);
    await digitar($("[data-motivo-recusa-campo]"), "  ab ");
    expect(ok()).toBe(true);
    await digitar($("[data-motivo-recusa-campo]"), "  Cupom ilegível.  ");
    expect(ok()).toBe(false);
    await clicar($("[data-confirmar-recusar]"));
    expect(pedidos.find((p) => p.metodo === "POST")).toEqual({ url: "/api/despesas-campo/d1/recusar", metodo: "POST", corpo: { motivo: "Cupom ilegível." } });
  });

  it("categorias: mostra a efetiva de cada uma; salvar manda só as escolhidas", async () => {
    lista = [];
    await montarEscritorio();
    expect(texto($("[data-vazio]"))).toBe("Nenhuma despesa esperando aprovação.");
    await clicar($("[data-abrir-mapa]"));
    expect(($('[data-mapa="COMBUSTIVEL"]') as HTMLSelectElement).value).toBe("cfC");
    expect(($('[data-mapa="PEDAGIO"]') as HTMLSelectElement).value).toBe("");
    await digitar($('[data-mapa="ALIMENTACAO"]'), "cfV");
    await clicar($("[data-salvar-mapa]"));
    expect(pedidos.find((p) => p.metodo === "PUT")).toEqual({ url: "/api/despesas-campo/categorias", metodo: "PUT", corpo: { mapa: { COMBUSTIVEL: "cfC", ALIMENTACAO: "cfV" } } });
  });

  it("quem só vê o Financeiro: vê a lista, o cupom e o filtro, sem aprovar, recusar nem categorias; a decidida mostra a conta de reembolso", async () => {
    lista = [D({ status: "APROVADA", decididoPor: "Ana", decididoEm: "2026-11-11T13:00:00.000Z", contaPagar: { id: "cp1", numero: "CP-12", status: "PENDENTE" } }), D({ id: "d2" })];
    await montarEscritorio(false);
    expect($("[data-despesa-campo=d2]")).not.toBeNull(); // pendente na lista, mas sem os botões
    expect($("[data-aprovar]")).toBeNull();
    expect($("[data-recusar]")).toBeNull();
    expect($("[data-abrir-mapa]")).toBeNull();
    expect($("[data-ver-cupom]")).not.toBeNull();
    expect(texto($("[data-conta-reembolso]"))).toBe("Reembolso: CP-12");
    expect($("[data-conta-reembolso]")!.getAttribute("href")).toBe("/financeiro/contas-pagar/cp1");
    await clicar($('[data-filtro="RECUSADA"]'));
    expect(pedidos.at(-1)!.url).toBe("/api/despesas-campo?status=RECUSADA");
  });
});

describe("escritório: as despesas na OS", () => {
  async function montarOs(l: any[]) {
    vi.stubGlobal("fetch", vi.fn(async () => json({ despesas: l })));
    const { DespesasCampoOs } = await import("@/components/os/despesas-campo-os");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(DespesasCampoOs, { osId: "osA" })); });
    await esperar();
  }
  it("o custo da OS soma só as aprovadas; sem despesas, o card não aparece", async () => {
    await montarOs([D({ status: "APROVADA", valor: 18 }), D({ id: "d2", status: "PENDENTE", valor: 100 }), D({ id: "d3", status: "RECUSADA", valor: 50 }), D({ id: "d4", status: "APROVADA", valor: 0.4 })]);
    expect(texto($("[data-custo-despesas]"))).toBe("R$ 18,40");
    expect($$("[data-despesa-os]")).toHaveLength(4);
    fechar();
    await montarOs([]);
    expect($("[data-secao-despesas-campo]")).toBeNull();
  });
});
