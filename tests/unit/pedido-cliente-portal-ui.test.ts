// @vitest-environment happy-dom
/**
 * PC-2 — Pedido do cliente no portal + lembretes, nas telas (DOM de verdade; o servidor é um substituto — o banco
 * está em pedido-cliente-portal-pg e a regra em pedido-cliente-portal):
 *  - PORTAL "Pedido de compra": a lista (nº, conclusão, valor, relatório), o item em conferência sem caixa de marcar,
 *    a validação (item, número, arquivo), o corpo enviado, o erro do servidor, o recusado com o motivo, a situação;
 *    o menu só para o comprador;
 *  - ESCRITÓRIO: a etiqueta "Pedido recebido — conferir" abre a conferência; o "Último lembrete em …"; confirmar;
 *    recusar exige o motivo; o erro do servidor fica na gaveta;
 *  - CONFIGURAÇÕES: a régua dos lembretes (validação e o que vai para o servidor) e o desligar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";
import { MSG_MOTIVO_RECUSA, MSG_REGUA } from "@/lib/pedido-cliente/lembretes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ refresh: vi.fn(), caminho: "/portal/pedidos-compra" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: nav.refresh, replace: vi.fn(), back: () => {} }),
  usePathname: () => nav.caminho, useSearchParams: () => new URLSearchParams(""),
}));
const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/components/ui/avisos", () => ({ toast: avisos.toast, confirmar: vi.fn(async () => true) }));
vi.mock("@/app/(portal)/portal/actions", () => ({ portalLogout: vi.fn(), portalLogin: vi.fn() }));

let root: Root | undefined;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
beforeEach(() => {
  chamadas.length = 0; respostas = {}; nav.refresh.mockClear(); avisos.toast.mockClear();
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
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el).not.toBeNull();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function anexar(el: Element | null, nome = "pedido.pdf") {
  const f = new File(["%PDF-1.7 fictício"], nome, { type: "application/pdf" });
  Object.defineProperty(el, "files", { configurable: true, value: [f] });
  await act(async () => { el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar(); await esperar();
}
async function montar(elemento: React.ReactElement) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  if (root) act(() => root!.unmount());
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(createElement(PermissoesProvider, { role: "ADMIN", permissoes: permissoesTotais() } as any, elemento)); });
  await esperar();
}
const enviar = async () => { await act(async () => { ($("[data-form-pedido-compra]") as HTMLFormElement).requestSubmit(); }); await esperar(); };

const ITENS = [
  { tipo: "os", id: "os1", numero: "OS-1410", concluidoEm: "2026-11-18T15:00:00.000Z", valor: 1800, diasEsperando: 9, unidade: "Fábrica", documento: "/relatorio/os/tk1", emConferencia: null },
  { tipo: "os", id: "os2", numero: "OS-1411", concluidoEm: "2026-11-23T15:00:00.000Z", valor: 950, diasEsperando: 4, unidade: null, documento: null, emConferencia: null },
  { tipo: "orcamento", id: "orc1", numero: "ORC-7", concluidoEm: "2026-11-05T15:00:00.000Z", valor: 2000, diasEsperando: 22, unidade: null, documento: "/orcamento/tk", emConferencia: { pedidoId: "p0", numero: "4500100" } },
  { tipo: "os", id: "os3", numero: "OS-1412", concluidoEm: null, valor: 0, diasEsperando: null, unidade: null, documento: null, emConferencia: null },
] as const;

async function montarPortal(itens: readonly any[] = ITENS, enviados: any[] = []) {
  const { PedidoCompraPortal } = await import("@/components/portal/pedido-compra-portal");
  await montar(createElement(PedidoCompraPortal, { itens: itens as any, enviados }));
}

describe("portal: Pedido de compra", () => {
  it("a lista: nº, unidade, conclusão, dias, valor e o relatório (PDF); o em conferência sem caixa de marcar; o em execução sem dias", async () => {
    await montarPortal();
    expect($$("[data-item-pendente]").map((li) => li.getAttribute("data-item-pendente"))).toEqual(["os:os1", "os:os2", "orcamento:orc1", "os:os3"]);
    const linha = $('[data-item-pendente="os:os1"]')!;
    expect([...linha.querySelectorAll("p, a")].map(txt)).toEqual(["OS-1410 · Fábrica", "Concluída em 18/11/2026 · há 9 dias", "R$ 1.800,00", "Relatório (PDF)"]);
    expect(($('[data-item-pendente="os:os1"] [data-documento-item]') as HTMLAnchorElement).getAttribute("href")).toBe("/relatorio/os/tk1");
    expect($('[data-item-pendente="orcamento:orc1"] [data-marcar-item]')).toBeNull();
    expect(txt($('[data-item-pendente="orcamento:orc1"] [data-em-conferencia]'))).toBe("Pedido nº 4500100 enviado — em conferência");
    expect(txt($('[data-item-pendente="os:os3"]'))).toContain("Em execução");
    expect(txt($('[data-item-pendente="os:os3"]'))).not.toContain("há");
    // os alvos de toque: a caixa de marcar e o link do relatório têm 44 px
    expect($('[data-item-pendente="os:os1"] label')!.className).toContain("w-11 h-11");
    expect($('[data-item-pendente="os:os1"] [data-documento-item]')!.className).toContain("min-h-[44px]");
    expect($("[data-enviar-pc]")!.className).toContain("min-h-[44px]");
  });

  it("valida antes de enviar: o item, o número e o arquivo (nada vai ao servidor)", async () => {
    await montarPortal();
    await enviar();
    expect(txt($("[data-erro-pc]"))).toBe("Escolha ao menos um serviço que o pedido cobre.");
    await clicar($('[data-marcar-item="os:os1"]'));
    await enviar();
    expect(txt($("[data-form-pedido-compra]"))).toContain("Informe o número do pedido de compra.");
    await digitar($("[data-pc-numero]"), "4500123");
    await digitar($("[data-pc-valor]"), "abc");
    await enviar();
    expect(txt($("[data-form-pedido-compra]"))).toContain("Valor inválido.");
    await digitar($("[data-pc-valor]"), "1.800,00");
    await enviar();
    expect(txt($("[data-erro-pc]"))).toBe("Anexe o pedido de compra (PDF ou foto).");
    expect(chamadas).toEqual([]);
  });

  it("envia: os itens marcados (OS e orçamento), número, data, valor, arquivo e observação; mostra o recebido e atualiza", async () => {
    await montarPortal([...ITENS.slice(0, 2), { ...ITENS[2], emConferencia: null }]);
    await clicar($('[data-marcar-item="os:os1"]'));
    await clicar($('[data-marcar-item="orcamento:orc1"]'));
    expect(txt($("[data-resumo-escolhidos]"))).toBe("Cobre OS-1410, Orçamento ORC-7 · total R$ 3.800,00");
    await digitar($("[data-pc-numero]"), "  4500123 ");
    await digitar($("[data-pc-data] input[data-input-data]"), "20/11/2026");
    await digitar($("[data-pc-valor]"), "3.800,00");
    await digitar($("[data-pc-observacao]"), "Pedido do mês");
    await anexar($("[data-pc-anexo]"));
    expect(txt($("[data-pc-anexo-nome]"))).toBe("pedido.pdf");
    respostas["POST /api/portal/pedidos-compra"] = { status: 201, corpo: { ok: true, pedidoId: "p1" } };
    await enviar();
    expect(chamadas).toHaveLength(1);
    const c = chamadas[0];
    expect([c.url, c.metodo]).toEqual(["/api/portal/pedidos-compra", "POST"]);
    expect(c.corpo).toMatchObject({ numero: "4500123", data: "2026-11-20", valor: 3800, observacao: "Pedido do mês", osIds: ["os1"], orcamentoIds: ["orc1"] });
    expect(c.corpo.anexo.nome).toBe("pedido.pdf");
    expect(c.corpo.anexo.conteudo).toMatch(/^data:application\/pdf;base64,/);
    expect(txt($("[data-pedido-enviado]"))).toBe("Pedido de compra nº 4500123 recebido. A equipe confere e libera o faturamento; a situação aparece abaixo.");
    expect(nav.refresh).toHaveBeenCalled();
    expect(($("[data-pc-numero]") as HTMLInputElement).value).toBe("");
  });

  it("um item só: já vem marcado; o erro do servidor aparece e nada some", async () => {
    await montarPortal([ITENS[0]]);
    expect(($('[data-marcar-item="os:os1"]') as HTMLInputElement).checked).toBe(true);
    await digitar($("[data-pc-numero]"), "4500123");
    await anexar($("[data-pc-anexo]"));
    respostas["POST /api/portal/pedidos-compra"] = { status: 400, corpo: { erro: "Algum serviço escolhido não aguarda mais o pedido de compra." } };
    await enviar();
    expect(txt($("[data-erro-pc]"))).toBe("Algum serviço escolhido não aguarda mais o pedido de compra.");
    expect(($("[data-pc-numero]") as HTMLInputElement).value).toBe("4500123");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("os enviados: a situação de cada um; o recusado com o motivo do escritório (no topo e na linha); tudo em conferência: sem formulário", async () => {
    await montarPortal([{ ...ITENS[0], emConferencia: { pedidoId: "p2", numero: "4500124" } }], [
      { id: "p2", numero: "4500124", data: "2026-11-21T00:00:00.000Z", valor: 1800, situacao: "CONFERIR", motivoRecusa: null, enviadoEm: "2026-11-21T13:00:00.000Z", itens: ["OS-1410"] },
      { id: "p1", numero: "4500123", data: "2026-11-20T00:00:00.000Z", valor: null, situacao: "RECUSADO", motivoRecusa: "O valor não confere com a OS-1410.", enviadoEm: "2026-11-20T13:00:00.000Z", itens: ["OS-1410"] },
      { id: "p0", numero: "4500100", data: "2026-11-01T00:00:00.000Z", valor: 500, situacao: "CONFIRMADO", motivoRecusa: null, enviadoEm: "2026-11-01T13:00:00.000Z", itens: ["OS-1300"] },
    ]);
    expect(txt($("[data-pedido-recusado]"))).toBe("Pedido de compra nº 4500123 recusado: O valor não confere com a OS-1410. Envie um novo pedido para os serviços abaixo.");
    expect($$("[data-situacao-pedido]").map(txt)).toEqual(["Recebido — em conferência", "Recusado", "Confirmado"]);
    expect(txt($('[data-pedido-enviado-linha="RECUSADO"] [data-motivo-recusa-portal]'))).toBe("Motivo: O valor não confere com a OS-1410.");
    expect(txt($('[data-pedido-enviado-linha="CONFERIR"]'))).toContain("Pedido nº 4500124 · 21/11/2026 · R$ 1.800,00");
    expect($("[data-form-pedido-compra]")).toBeNull();
  });

  it("nada pendente: a mensagem, sem formulário", async () => {
    await montarPortal([]);
    expect(txt($("[data-nada-pendente]"))).toBe("Nenhum serviço aguardando pedido de compra.");
    expect($("[data-form-pedido-compra]")).toBeNull();
  });

  it("o menu do portal: 'Pedido de compra' só para o comprador ('Pedido' no rodapé do celular)", async () => {
    const { PortalShell } = await import("@/components/portal/portal-shell");
    const props = { contatoNome: "Bruno", clienteNome: "Indústria", branding: { empresaNome: "Polar", logo: null, cor: "#0EA5E9" }, permissoes: { verOS: true } };
    await montar(createElement(PortalShell as any, { ...props, pedidoCompra: true }, "x"));
    const links = $$('a[href="/portal/pedidos-compra"]').map(txt);
    expect(links).toEqual(["Pedido de compra", "Pedido"]);
    await montar(createElement(PortalShell as any, { ...props, pedidoCompra: false }, "x"));
    expect($$('a[href="/portal/pedidos-compra"]')).toEqual([]);
  });
});

const PEDIDO = {
  id: "p1", numero: "4500123", data: "2026-11-20", valor: 1000, observacao: "Pedido do mês", situacao: "CONFERIR", temAnexo: true, anexoNome: "pedido.pdf",
  total: 3800, alerta: "O valor do pedido (R$ 1.000,00) é menor que o total das OS e orçamentos que ele cobre (R$ 3.800,00).", cliente: "Indústria Exemplo",
  enviadoPor: "Bruno Compras · compras@industria.test", criadoEm: "2026-11-21T13:00:00Z", ordens: [{ id: "os1", numero: "OS-1410" }], orcamentos: [{ id: "orc1", codigo: "ORC-7" }],
};

describe("escritório: conferir o pedido do portal", () => {
  async function montarEtiqueta(situacao: any, tamanho: "sm" | "md" = "md") {
    const { EtiquetaPedido } = await import("@/components/pedido-cliente/etiqueta-pedido");
    respostas["GET /api/pedidos-cliente/p1"] = { status: 200, corpo: PEDIDO };
    await montar(createElement(EtiquetaPedido, { situacao, alvo: { osIds: ["os1"] }, tamanho }));
  }

  it("a etiqueta 'Pedido recebido — conferir' abre a conferência: o pedido, o que cobre, quem enviou, o arquivo e o alerta de valor", async () => {
    const linha = vi.fn();
    const { EtiquetaPedido } = await import("@/components/pedido-cliente/etiqueta-pedido");
    respostas["GET /api/pedidos-cliente/p1"] = { status: 200, corpo: PEDIDO };
    await montar(createElement("div", { onClick: linha }, createElement(EtiquetaPedido, { situacao: { aguardando: true, pedido: null, conferir: { id: "p1", numero: "4500123" } }, alvo: { osIds: ["os1"] } })));
    expect(txt($('[data-etiqueta-pedido="conferir"]'))).toBe("Pedido recebido — conferir");
    await clicar($('[data-etiqueta-pedido="conferir"]'));
    expect(linha).not.toHaveBeenCalled();
    expect(chamadas.map((c) => c.url)).toEqual(["/api/pedidos-cliente/p1"]);
    expect(txt($("[data-conferir-numero]"))).toBe("nº 4500123 · 20/11/2026");
    expect(txt($("[data-conferir-valor]"))).toBe("R$ 1.000,00");
    expect(txt($("[data-conferir-itens]"))).toBe("OS-1410, Orçamento ORC-7 · Total R$ 3.800,00");
    expect(txt($("[data-pedido-conferir]"))).toContain("Bruno Compras · compras@industria.test");
    expect(($("[data-conferir-anexo]") as HTMLAnchorElement).getAttribute("href")).toBe("/api/pedidos-cliente/p1/anexo?inline=1");
    expect(txt($("[data-conferir-alerta-valor]"))).toContain("é menor que o total");
  });

  it("CONFIRMAR: envia a ação, avisa que o faturamento foi liberado (e o alerta), atualiza e fecha", async () => {
    await montarEtiqueta({ aguardando: true, pedido: null, conferir: { id: "p1", numero: "4500123" } });
    await clicar($('[data-etiqueta-pedido="conferir"]'));
    respostas["POST /api/pedidos-cliente/p1/conferir"] = { status: 200, corpo: { ok: true, alerta: "valor menor" } };
    await clicar($("[data-confirmar-pedido]"));
    expect(chamadas.at(-1)).toEqual({ url: "/api/pedidos-cliente/p1/conferir", metodo: "POST", corpo: { acao: "confirmar" } });
    expect(avisos.toast.mock.calls.map((c) => c[0])).toEqual(["Pedido do cliente confirmado. O faturamento foi liberado.", "valor menor"]);
    expect(nav.refresh).toHaveBeenCalled();
    expect($("[data-gaveta-conferir]")).toBeNull();
  });

  it("RECUSAR: pede o motivo (o cliente vê); sem motivo, não envia; com motivo, envia; o erro do servidor fica na gaveta", async () => {
    await montarEtiqueta({ aguardando: true, pedido: null, conferir: { id: "p1", numero: "4500123" } });
    await clicar($('[data-etiqueta-pedido="conferir"]'));
    await clicar($("[data-recusar-pedido]"));
    expect(txt($("[data-gaveta-conferir]"))).toContain("O cliente vê este motivo no portal.");
    await clicar($("[data-confirmar-recusa]"));
    expect(txt($("[data-gaveta-conferir]"))).toContain(MSG_MOTIVO_RECUSA);
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);
    await digitar($("[data-motivo-recusa]"), "O valor não confere com a OS-1410.");
    respostas["POST /api/pedidos-cliente/p1/conferir"] = { status: 409, corpo: { erro: "Este pedido já foi conferido." } };
    await clicar($("[data-confirmar-recusa]"));
    expect(chamadas.at(-1)!.corpo).toEqual({ acao: "recusar", motivo: "O valor não confere com a OS-1410." });
    expect(txt($("[data-erro-conferir]"))).toBe("Este pedido já foi conferido.");
    expect(nav.refresh).not.toHaveBeenCalled();
    respostas["POST /api/pedidos-cliente/p1/conferir"] = { status: 200, corpo: { ok: true } };
    await clicar($("[data-confirmar-recusa]"));
    expect(avisos.toast).toHaveBeenCalledWith("Pedido recusado. O cliente vê o motivo no portal.");
  });

  it("'Último lembrete em …': ao lado da etiqueta no cabeçalho, no tooltip da lista; só enquanto aguarda", async () => {
    const quando = "2026-11-24T14:00:00.000Z";
    await montarEtiqueta({ aguardando: true, pedido: null, conferir: null, ultimoLembrete: quando }, "md");
    expect(txt($("[data-ultimo-lembrete]"))).toBe("Último lembrete em 24/11/2026");
    expect($('[data-etiqueta-pedido="aguardando"]')!.getAttribute("title")).toBe("Clique para informar o pedido do cliente · Último lembrete em 24/11/2026");
    await montarEtiqueta({ aguardando: true, pedido: null, conferir: null, ultimoLembrete: quando }, "sm");
    expect($("[data-ultimo-lembrete]")).toBeNull();
    expect($('[data-etiqueta-pedido="aguardando"]')!.getAttribute("title")).toContain("Último lembrete em 24/11/2026");
    await montarEtiqueta({ aguardando: false, pedido: { id: "p9", numero: "9" }, conferir: null, ultimoLembrete: quando }, "md");
    expect($("[data-ultimo-lembrete]")).toBeNull();
    await montarEtiqueta({ aguardando: true, pedido: null, conferir: null, ultimoLembrete: null }, "md");
    expect($("[data-ultimo-lembrete]")).toBeNull();
    expect($('[data-etiqueta-pedido="aguardando"]')!.getAttribute("title")).toBe("Clique para informar o pedido do cliente");
  });
});

describe("configurações: a régua dos lembretes", () => {
  async function montarConfig(extra: Record<string, unknown> = {}) {
    const { OrcamentoPadroesClient } = await import("@/components/config/orcamento-padroes-client");
    await montar(createElement(OrcamentoPadroesClient, { podeEditar: true, inicial: { orcamentoValidadeDias: 10, orcamentoGarantiaServico: null, orcamentoGarantiaPecas: null, orcamentoNaoIncluso: null, orcamentoNormas: [], pedidoClienteDiasAlerta: 7, ...extra } }));
  }
  const salvar = () => clicar($("[data-salvar-padroes-orcamento]"));

  it("padrão 3, 7 e 15 (ligado); a régua escrita vai em ordem; inválida não salva", async () => {
    await montarConfig();
    expect(($("[data-regua-lembretes]") as HTMLInputElement).value).toBe("3, 7, 15");
    expect(txt($("[data-lembretes-pedido]"))).toContain("Após 3, 7 e 15 dias de espera");
    await digitar($("[data-regua-lembretes]"), "10, 5, 0");
    expect(txt($("[data-lembretes-pedido]"))).toContain(MSG_REGUA);
    await salvar();
    expect(chamadas).toEqual([]);
    expect(txt($("[data-erro-padroes-orcamento]"))).toBe(MSG_REGUA);
    await digitar($("[data-regua-lembretes]"), "10, 5");
    await salvar();
    expect(chamadas.at(-1)!.corpo).toMatchObject({ pedidoLembretesAtivo: true, pedidoLembretesDias: [5, 10] });
  });

  it("desligado: a régua some e vai 'desligado' (a régua gravada fica)", async () => {
    await montarConfig({ pedidoLembretesAtivo: false, pedidoLembretesDias: [2, 4] });
    expect($("[data-regua-lembretes]")).toBeNull();
    await salvar();
    expect(chamadas.at(-1)!.corpo).toMatchObject({ pedidoLembretesAtivo: false, pedidoLembretesDias: [2, 4] });
  });
});
