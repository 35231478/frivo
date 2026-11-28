// @vitest-environment happy-dom
/**
 * Pedido do cliente (PC-1) nas telas, num DOM de verdade (o servidor é um substituto; a regra está em
 * pedido-cliente-regra e o banco em pedido-cliente-pg):
 *  - a gaveta: o que ela cobre (cliente, OS, total, contato de compras), o alerta de valor menor ao vivo, a validação,
 *    o corpo enviado, clientes diferentes (não deixa salvar), liberar com motivo (só com a permissão), corrigir;
 *  - a etiqueta: "Aguardando pedido" abre a gaveta com 1 clique (sem abrir a OS da linha), "Pedido nº X", "Liberado";
 *  - o filtro rápido da barra compartilhada: contagem, total em R$, liga/desliga, some vazio, "Limpar filtros" tira;
 *  - a ação em massa: só com a permissão; leva os selecionados para a gaveta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ refresh: vi.fn(), qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: nav.refresh, replace: vi.fn(), back: () => {} }),
  usePathname: () => "/ordens", useSearchParams: () => new URLSearchParams(nav.qs),
}));
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/avisos", () => ({ toast: avisos.toast, confirmar: vi.fn(async () => true) }));
const selecao = vi.hoisted(() => ({ entidade: "ordens", selecionados: new Set<string>(["os1", "os2"]), limpar: vi.fn() }));
vi.mock("@/components/acoes-massa/selecao", () => ({ useSelecaoMassa: () => selecao }));

let root: Root | undefined;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
beforeEach(() => {
  chamadas.length = 0; respostas = {}; nav.qs = ""; nav.refresh.mockClear(); avisos.toast.mockClear(); selecao.limpar.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: { ok: true } };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function montar(elemento: React.ReactElement, permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  if (root) act(() => root!.unmount());
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes } as any, elemento)); });
  await esperar();
}
const ALVOS = (extra: Record<string, unknown> = {}) => ({
  itens: [
    { tipo: "os", id: "os1", numero: "OS-0401", valor: 1000, aguardando: true, pedido: null, liberado: false },
    { tipo: "os", id: "os2", numero: "OS-0402", valor: 500, aguardando: true, pedido: null, liberado: false },
  ],
  mesmoCliente: true, total: 1500, podeLiberar: true,
  cliente: { nome: "Instituto Horizonte", comprasNome: "Marta Lima", comprasEmail: "compras@horizonte.exemplo", comprasTelefone: null },
  ...extra,
});
async function gaveta(props: Record<string, unknown> = {}, alvos = ALVOS()) {
  respostas["GET /api/pedidos-cliente/alvos?os=os1%2Cos2"] = { status: 200, corpo: alvos };
  const { GavetaPedido } = await import("@/components/pedido-cliente/gaveta-pedido");
  const onConcluido = vi.fn(), onFechar = vi.fn();
  await montar(createElement(GavetaPedido, { aberto: true, onFechar, alvo: { osIds: ["os1", "os2"] }, onConcluido, ...props }));
  return { onConcluido, onFechar };
}

describe("a gaveta do pedido do cliente", () => {
  it("mostra o que cobre; alerta ao vivo se o valor é menor; exige o número; envia o pedido para todas as OS", async () => {
    const { onConcluido, onFechar } = await gaveta();
    expect(chamadas[0]).toMatchObject({ metodo: "GET", url: "/api/pedidos-cliente/alvos?os=os1%2Cos2" });
    expect([...$("[data-pedido-cobre]")!.querySelectorAll("p")].map(txt)).toEqual(["Instituto Horizonte", "OS-0401, OS-0402 · Total R$ 1.500,00", "Compras: Marta Lima · compras@horizonte.exemplo"]);
    await digitar($("[data-pedido-valor]"), "1.000,00");
    expect(txt($("[data-pedido-alerta-valor]"))).toBe("O valor do pedido (R$ 1.000,00) é menor que o total das OS e orçamentos que ele cobre (R$ 1.500,00).");
    await digitar($("[data-pedido-valor]"), "1500");
    expect($("[data-pedido-alerta-valor]")).toBeNull();
    // sem número: não envia
    await clicar($("[data-salvar-pedido]"));
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);
    expect(txt(document.body)).toContain("Informe o número do pedido do cliente.");
    await digitar($("[data-pedido-numero]"), " 4500012345 ");
    await digitar($("[data-pedido-observacao]"), "Pedido do semestre");
    respostas["POST /api/pedidos-cliente"] = { status: 201, corpo: { ok: true, alerta: null } };
    await clicar($("[data-salvar-pedido]"));
    const post = chamadas.find((c) => c.metodo === "POST")!;
    expect(post.url).toBe("/api/pedidos-cliente");
    expect(post.corpo).toMatchObject({ numero: "4500012345", valor: 1500, observacao: "Pedido do semestre", anexo: null, osIds: ["os1", "os2"], orcamentoIds: [] });
    expect(post.corpo.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(avisos.toast).toHaveBeenCalledWith("Pedido do cliente informado.");
    expect([nav.refresh.mock.calls.length, onConcluido.mock.calls.length, onFechar.mock.calls.length]).toEqual([1, 1, 1]);
  });

  it("o servidor recusa: a mensagem aparece e a gaveta fica aberta; o alerta do servidor vira aviso", async () => {
    const { onFechar } = await gaveta();
    await digitar($("[data-pedido-numero]"), "4500");
    respostas["POST /api/pedidos-cliente"] = { status: 403, corpo: { erro: "Sem permissão para informar o pedido do cliente." } };
    await clicar($("[data-salvar-pedido]"));
    expect(txt($("[data-erro-pedido]"))).toBe("Sem permissão para informar o pedido do cliente.");
    expect(onFechar).not.toHaveBeenCalled();
    respostas["POST /api/pedidos-cliente"] = { status: 201, corpo: { ok: true, alerta: "O valor do pedido é menor." } };
    await clicar($("[data-salvar-pedido]"));
    expect(avisos.toast).toHaveBeenCalledWith("O valor do pedido é menor.", "info");
  });

  it("clientes diferentes: avisa e não deixa salvar", async () => {
    await gaveta({}, ALVOS({ mesmoCliente: false }));
    expect(txt($("[data-pedido-clientes-diferentes]"))).toBe("Um pedido do cliente cobre itens de um cliente só. Selecione itens do mesmo cliente.");
    expect($<HTMLButtonElement>("[data-salvar-pedido]")!.disabled).toBe(true);
    expect($("[data-liberar-sem-pedido]")).toBeNull();
  });

  it("liberar sem pedido: só com a permissão; o motivo é obrigatório; libera só os que aguardam", async () => {
    await gaveta({}, ALVOS({ podeLiberar: false }));
    expect($("[data-liberar-sem-pedido]")).toBeNull();
    await gaveta({}, ALVOS({ itens: [...ALVOS().itens.slice(0, 1), { ...ALVOS().itens[1], aguardando: false, pedido: { id: "p", numero: "1" } }] }));
    await clicar($("[data-liberar-sem-pedido]"));
    expect($("[data-pedido-numero]")).toBeNull();
    await digitar($("[data-motivo-liberacao]"), "ok");
    await clicar($("[data-confirmar-liberacao]"));
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);
    expect(txt(document.body)).toContain("Escreva o motivo da liberação (de 5 a 300 caracteres).");
    await digitar($("[data-motivo-liberacao]"), "Atendimento emergencial autorizado");
    respostas["POST /api/pedidos-cliente/liberar"] = { status: 200, corpo: { ok: true, liberadas: 1 } };
    await clicar($("[data-confirmar-liberacao]"));
    expect(chamadas.find((c) => c.metodo === "POST")).toMatchObject({ url: "/api/pedidos-cliente/liberar", corpo: { osIds: ["os1"], orcamentoIds: [], motivo: "Atendimento emergencial autorizado" } });
    expect(avisos.toast).toHaveBeenCalledWith("Liberado sem pedido do cliente.");
  });

  it("corrigir o pedido já informado: carrega os dados e o anexo; salva com PATCH", async () => {
    respostas["GET /api/pedidos-cliente/p9"] = { status: 200, corpo: { numero: "PO-1", data: "2026-11-20", valor: 1500, observacao: "x", temAnexo: true } };
    await gaveta({ pedidoId: "p9" });
    expect($<HTMLInputElement>("[data-pedido-numero]")!.value).toBe("PO-1");
    expect($<HTMLInputElement>("[data-pedido-data] input")!.value).toBe("20/11/2026");
    expect($<HTMLInputElement>("[data-pedido-valor]")!.value).toBe("1500");
    expect($("[data-pedido-anexo-atual]")!.getAttribute("href")).toBe("/api/pedidos-cliente/p9/anexo?inline=1");
    expect($("[data-liberar-sem-pedido]")).toBeNull();
    await digitar($("[data-pedido-numero]"), "PO-2");
    respostas["PATCH /api/pedidos-cliente/p9"] = { status: 200, corpo: { ok: true, alerta: null } };
    await clicar($("[data-salvar-pedido]"));
    expect(chamadas.find((c) => c.metodo === "PATCH")).toMatchObject({ url: "/api/pedidos-cliente/p9", corpo: { numero: "PO-2" } });
    expect(avisos.toast).toHaveBeenCalledWith("Pedido do cliente corrigido.");
  });

  it("a fatura como alvo: a consulta leva a fatura (as OS e orçamentos dela vêm do servidor)", async () => {
    respostas["GET /api/pedidos-cliente/alvos?med=m1"] = { status: 200, corpo: ALVOS() };
    const { GavetaPedido } = await import("@/components/pedido-cliente/gaveta-pedido");
    await montar(createElement(GavetaPedido, { aberto: true, onFechar: () => {}, alvo: { medicaoId: "m1" } }));
    await digitar($("[data-pedido-numero]"), "OC-1");
    await clicar($("[data-salvar-pedido]"));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toMatchObject({ numero: "OC-1", medicaoId: "m1", osIds: [], orcamentoIds: [] });
  });
});

describe("a etiqueta", () => {
  it("'Aguardando pedido' abre a gaveta com 1 clique, sem disparar o clique da linha", async () => {
    respostas["GET /api/pedidos-cliente/alvos?os=os1"] = { status: 200, corpo: ALVOS() };
    const { EtiquetaPedido } = await import("@/components/pedido-cliente/etiqueta-pedido");
    const linha = vi.fn();
    await montar(createElement("div", { onClick: linha }, createElement(EtiquetaPedido, { situacao: { aguardando: true, pedido: null }, alvo: { osIds: ["os1"] } })));
    expect(txt($("[data-etiqueta-pedido=aguardando]"))).toBe("Aguardando pedido");
    expect($("[data-gaveta-pedido]")).toBeNull();
    await clicar($("[data-etiqueta-pedido=aguardando]"));
    expect($("[data-gaveta-pedido]")).not.toBeNull();
    expect(linha).not.toHaveBeenCalled();
  });
  it("'Pedido nº X' (abre para corrigir), 'Liberado sem pedido' (motivo no tooltip) e nada quando não exige", async () => {
    const { EtiquetaPedido } = await import("@/components/pedido-cliente/etiqueta-pedido");
    await montar(createElement(EtiquetaPedido, { situacao: { aguardando: false, pedido: { id: "p1", numero: "4500" } }, alvo: { osIds: ["os1"] } }));
    expect(txt($("[data-etiqueta-pedido=informado]"))).toBe("Pedido nº 4500");
    await montar(createElement(EtiquetaPedido, { situacao: { aguardando: false, pedido: null, liberadoMotivo: "Emergência" }, alvo: { osIds: ["os1"] } }));
    expect($("[data-etiqueta-pedido=liberado]")!.getAttribute("title")).toBe("Liberado sem pedido do cliente: Emergência");
    await montar(createElement(EtiquetaPedido, { situacao: null, alvo: { osIds: ["os1"] } }));
    expect($("[data-etiqueta-pedido]")).toBeNull();
    await montar(createElement(EtiquetaPedido, { situacao: { aguardando: false, pedido: null }, alvo: { osIds: ["os1"] } }));
    expect($("[data-etiqueta-pedido]")).toBeNull();
  });
});

describe("o filtro rápido da barra compartilhada", () => {
  const rapido = { param: "pedido", valor: "aguardando", rotulo: "Aguardando pedido", quantidade: 4, total: 2050, dica: "porquê" };
  async function barra(qs = "", r = rapido) {
    nav.qs = qs;
    const { BarraFiltros } = await import("@/components/listagem/barra-filtros");
    const navegar = vi.fn();
    await montar(createElement(BarraFiltros, { busca: null, navegar, rapidos: [r] }));
    return navegar;
  }
  it("contagem e total em R$; liga e desliga pela URL (volta à 1ª página); o porquê no tooltip", async () => {
    let navegar = await barra();
    const b = $("[data-filtro-rapido=pedido]")!;
    expect([txt(b), txt(b.querySelector("[data-filtro-rapido-qtd]")), txt(b.querySelector("[data-filtro-rapido-total]")), b.getAttribute("aria-pressed"), b.getAttribute("title")])
      .toEqual(["Aguardando pedido4· R$ 2.050,00", "4", "· R$ 2.050,00", "false", "porquê"]);
    await clicar(b);
    expect(navegar).toHaveBeenCalledWith({ pedido: "aguardando", pagina: null });
    navegar = await barra("pedido=aguardando");
    expect($("[data-filtro-rapido=pedido]")!.getAttribute("aria-pressed")).toBe("true");
    await clicar($("[data-filtro-rapido=pedido]"));
    expect(navegar).toHaveBeenCalledWith({ pedido: null, pagina: null });
    // ligado conta como filtro ativo: "Limpar filtros" tira
    await clicar($("[data-limpar-filtros]"));
    expect(navegar).toHaveBeenLastCalledWith(expect.objectContaining({ pedido: null }));
  });
  it("sem nada e desligado, some; desligado mas ligado na URL, fica (para dar para tirar)", async () => {
    await barra("", { ...rapido, quantidade: 0 });
    expect($("[data-filtro-rapido]")).toBeNull();
    await barra("pedido=aguardando", { ...rapido, quantidade: 0 });
    expect($("[data-filtro-rapido]")).not.toBeNull();
  });
});

describe("a ação em massa", () => {
  it("leva as OS selecionadas para a gaveta; ao concluir, limpa a seleção", async () => {
    respostas["GET /api/pedidos-cliente/alvos?os=os1%2Cos2"] = { status: 200, corpo: ALVOS() };
    const { AcaoMassaPedido } = await import("@/components/pedido-cliente/acao-massa-pedido");
    await montar(createElement(AcaoMassaPedido));
    await clicar($("[data-acao-massa=informar-pedido]"));
    expect($("[data-gaveta-pedido]")).not.toBeNull();
    await digitar($("[data-pedido-numero]"), "4500");
    respostas["POST /api/pedidos-cliente"] = { status: 201, corpo: { ok: true } };
    await clicar($("[data-salvar-pedido]"));
    expect(chamadas.find((c) => c.metodo === "POST")!.corpo).toMatchObject({ osIds: ["os1", "os2"] });
    expect(selecao.limpar).toHaveBeenCalled();
  });
  it("sem editar OS nem lançar faturas, não aparece; nos orçamentos, vale editar orçamentos", async () => {
    const { AcaoMassaPedido } = await import("@/components/pedido-cliente/acao-massa-pedido");
    await montar(createElement(AcaoMassaPedido), montarPermissoes({ ordens: ["visualizar"] }));
    expect($("[data-acao-massa=informar-pedido]")).toBeNull();
    selecao.entidade = "orcamentos";
    await montar(createElement(AcaoMassaPedido), montarPermissoes({ orcamentos: ["visualizar", "editar"] }));
    expect($("[data-acao-massa=informar-pedido]")).not.toBeNull();
    selecao.entidade = "clientes";
    await montar(createElement(AcaoMassaPedido));
    expect($("[data-acao-massa=informar-pedido]")).toBeNull();
    selecao.entidade = "ordens";
  });
});
