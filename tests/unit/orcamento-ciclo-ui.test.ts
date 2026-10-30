// @vitest-environment happy-dom
/**
 * Ciclo do orçamento num DOM de verdade:
 *  - link público: "Aprovar proposta" abre o aceite com o aviso do registro (nome, CPF, data/hora,
 *    IP); "Recusar" abre a recusa: nome + motivo (rápido ou escrito), validação antes de enviar,
 *    POST certo, erro do servidor na tela, "voltar";
 *  - envio rastreável: botões por etapa (enviar/reenviar por e-mail, WhatsApp, copiar link), o
 *    canal vai no corpo, retorno de cada canal na tela; "Cliente recusou" e "Voltar para rascunho"
 *    só depois de confirmar; expirado avisa e não deixa reenviar;
 *  - andamento: trilha com a data de cada etapa (fim que aconteceu no lugar do Aprovado) e linha do
 *    tempo com quem, quando, canal e IP; pílula com "desde";
 *  - sino: "Respostas de orçamentos" leva às respostas novas, só para quem vê orçamentos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos/o1", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
// Canvas de assinatura não existe no happy-dom: um "assinado" fixo basta (o foco aqui é o fluxo)
vi.mock("react-signature-canvas", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef((_p: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({ isEmpty: () => false, clear: () => {}, getCanvas: () => ({ toDataURL: () => "data:image/png;base64,QUJDREVGR0hJSktMTU5PUA==" }) }));
      return React.createElement("canvas", { "data-assinatura": true });
    }),
  };
});

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeEach(() => {
  chamadas.length = 0;
  nav.refresh.mockClear();
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function renderizar(el: React.ReactElement) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}

describe("resposta no link público", () => {
  const montar = async () => {
    const { RespostaPublica } = await import("@/components/orcamento/resposta-publica");
    await renderizar(createElement(RespostaPublica, { token: "tk1" }));
  };

  it("fechado: Aprovar e Recusar; Aprovar abre o aceite com o aviso do que é registrado e envia nome/CPF/assinatura", async () => {
    await montar();
    expect($("[data-abrir-aprovacao]")?.textContent).toContain("Aprovar proposta");
    expect($("[data-abrir-recusa]")?.textContent).toContain("Recusar");
    await clicar($("[data-abrir-aprovacao]"));
    expect($("[data-aviso-registro]")?.textContent).toContain("nome, CPF, a data e a hora e o endereço IP");
    const [nome, cpf] = $$<HTMLInputElement>("input");
    await digitar(nome, "Juliana Ramos");
    await digitar(cpf, "12345678909");
    expect(cpf.value).toBe("123.456.789-09");
    await clicar($$("button").find((b) => b.textContent?.includes("Confirmar")));
    const c = chamadas.find((x) => x.url === "/api/publico/orcamentos/tk1/aprovar");
    expect(c).toMatchObject({ metodo: "POST", corpo: { nome: "Juliana Ramos", cpf: "123.456.789-09" } });
    expect(c!.corpo.assinaturaUrl).toMatch(/^data:image\/png/);
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("Recusar: motivo rápido preenche, valida antes de enviar, manda nome + motivo e atualiza a página", async () => {
    await montar();
    await clicar($("[data-abrir-recusa]"));
    expect($("[data-form-recusa]")).toBeTruthy();
    expect($("[data-abrir-aprovacao]")).toBeNull();
    // Sem nome: não chama o servidor
    await clicar($("[data-confirmar-recusa]"));
    expect($("[role=alert]")?.textContent).toContain("Informe seu nome.");
    await digitar($("[data-recusa-nome]"), "  Juliana Ramos ");
    await clicar($("[data-confirmar-recusa]"));
    expect($("[role=alert]")?.textContent).toContain("Conte o motivo");
    expect(chamadas).toHaveLength(0);
    // Motivo rápido marca e preenche o campo (dá para editar depois)
    await clicar($("[data-motivo-rapido='Prazo não atende']"));
    expect($<HTMLTextAreaElement>("[data-recusa-motivo]")!.value).toBe("Prazo não atende");
    expect($("[data-motivo-rapido='Prazo não atende']")!.className).toContain("border-acento");
    expect($("[data-motivo-rapido='Preço acima do orçado']")!.className).not.toContain("bg-acento-claro");
    await digitar($("[data-recusa-motivo]"), "Prazo não atende: precisamos em 15 dias ");
    await clicar($("[data-confirmar-recusa]"));
    expect(chamadas).toEqual([{ url: "/api/publico/orcamentos/tk1/recusar", metodo: "POST", corpo: { nome: "Juliana Ramos", motivo: "Prazo não atende: precisamos em 15 dias" } }]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("erro do servidor aparece (ex.: expirado) e não atualiza; 'voltar' retorna aos dois botões", async () => {
    respostas["POST /api/publico/orcamentos/tk1/recusar"] = { status: 410, corpo: { erro: "Orçamento expirado" } };
    await montar();
    await clicar($("[data-abrir-recusa]"));
    await digitar($("[data-recusa-nome]"), "Juliana");
    await clicar($("[data-motivo-rapido='Optamos por outro fornecedor']"));
    await clicar($("[data-confirmar-recusa]"));
    expect($("[role=alert]")?.textContent).toContain("Orçamento expirado");
    expect(nav.refresh).not.toHaveBeenCalled();
    await clicar($$("button").find((b) => b.textContent === "voltar"));
    expect($("[data-abrir-aprovacao]")).toBeTruthy();
    expect($("[data-form-recusa]")).toBeNull();
  });
});

describe("envio rastreável (tela do orçamento)", () => {
  const montar = async (props: Record<string, unknown> = {}) => {
    const { AcoesEnvio } = await import("@/components/orcamento/acoes-envio");
    await renderizar(createElement(AcoesEnvio, { orcamentoId: "o1", codigo: "ORC-2026-0147", tokenPublico: "tk1", status: "ENVIADO", podeEditar: false, ...props } as any));
  };
  const ENVIAR = "POST /api/orcamentos/o1/enviar";

  it("rascunho: 'Enviar por e-mail' manda o canal e mostra para quem foi; WhatsApp abre o link; copiar link copia", async () => {
    const abrir = vi.fn();
    const copiar = vi.fn(async () => {});
    vi.stubGlobal("open", abrir);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: copiar }, configurable: true });
    await montar({ status: "RASCUNHO", etapa: "RASCUNHO", podeEditar: true });
    expect($("[data-enviar-email]")?.textContent).toContain("Enviar por e-mail");
    expect($("a[href='/orcamentos/o1/editar']")).toBeTruthy();
    expect($("[data-voltar-rascunho]")).toBeNull();
    expect($("[data-marcar-recusado]")).toBeNull();

    respostas[ENVIAR] = { status: 200, corpo: { emailEnviado: true, para: "compras@hsc.com.br" } };
    await clicar($("[data-enviar-email]"));
    expect(chamadas.at(-1)).toMatchObject({ url: "/api/orcamentos/o1/enviar", metodo: "POST", corpo: { canal: "EMAIL" } });
    expect($("[data-feedback-envio]")?.textContent).toContain("E-mail enviado para compras@hsc.com.br.");
    expect(nav.refresh).toHaveBeenCalledTimes(1);

    respostas[ENVIAR] = { status: 200, corpo: { whatsappUrl: "https://wa.me/5531988887777?text=oi" } };
    await clicar($("[data-enviar-whatsapp]"));
    expect(chamadas.at(-1)!.corpo).toEqual({ canal: "WHATSAPP" });
    expect(abrir).toHaveBeenCalledWith("https://wa.me/5531988887777?text=oi", "_blank", "noopener");

    respostas[ENVIAR] = { status: 200, corpo: { publicUrl: "https://app/orcamento/tk1" } };
    await clicar($("[data-copiar-link]"));
    expect(chamadas.at(-1)!.corpo).toEqual({ canal: "LINK" });
    expect(copiar).toHaveBeenCalledWith("https://app/orcamento/tk1");
    expect($("[data-feedback-envio]")?.textContent).toContain("Link copiado!");
  });

  it("retornos sem envio: sem WhatsApp cadastrado, sem e-mail, erro do servidor, erro do Resend", async () => {
    await montar({ etapa: "VISUALIZADO" });
    expect($("[data-enviar-email]")?.textContent).toContain("Reenviar por e-mail");
    respostas[ENVIAR] = { status: 200, corpo: { whatsappUrl: null } };
    await clicar($("[data-enviar-whatsapp]"));
    expect($("[data-feedback-envio]")?.textContent).toContain("Cliente sem telefone/WhatsApp cadastrado");
    respostas[ENVIAR] = { status: 200, corpo: { emailEnviado: false, mailtoUrl: null, erroEmail: null } };
    await clicar($("[data-enviar-email]"));
    expect($("[data-feedback-envio]")?.textContent).toContain("Cliente sem e-mail cadastrado");
    respostas[ENVIAR] = { status: 400, corpo: { erro: "A validade deste orçamento já venceu." } };
    await clicar($("[data-enviar-email]"));
    expect($("[data-feedback-envio]")?.textContent).toContain("A validade deste orçamento já venceu.");
    expect(nav.refresh).toHaveBeenCalledTimes(2); // o 400 não atualiza
  });

  it("aguardando resposta: 'Cliente recusou' e 'Voltar para rascunho' só depois de confirmar", async () => {
    const confirmar = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmar);
    await montar({ etapa: "ENVIADO" });
    await clicar($("[data-marcar-recusado]"));
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(chamadas).toHaveLength(0); // cancelou
    confirmar.mockReturnValue(true);
    await clicar($("[data-marcar-recusado]"));
    expect(chamadas.at(-1)).toMatchObject({ url: "/api/orcamentos/o1", metodo: "PUT", corpo: { status: "REPROVADO" } });
    respostas["PUT /api/orcamentos/o1"] = { status: 400, corpo: { erro: "Não é possível mudar o orçamento" } };
    await clicar($("[data-voltar-rascunho]"));
    expect(chamadas.at(-1)!.corpo).toEqual({ status: "RASCUNHO" });
    expect($("[data-feedback-envio]")?.textContent).toContain("Não é possível mudar o orçamento");
  });

  it("expirado: avisa, não reenvia, oferece voltar para rascunho; recusado pode reenviar; aprovado só PDF", async () => {
    await montar({ etapa: "EXPIRADO" });
    expect($("[data-aviso-expirado]")?.textContent).toContain("A validade venceu");
    expect($("[data-enviar-email]")).toBeNull();
    expect($("[data-voltar-rascunho]")).toBeTruthy();
    expect($("[data-marcar-recusado]")).toBeNull();
    act(() => root.unmount());
    await montar({ status: "REPROVADO" }); // sem etapa: deriva do status
    expect($("[data-enviar-email]")?.textContent).toContain("Reenviar");
    expect($("[data-voltar-rascunho]")).toBeTruthy();
    expect($("[data-marcar-recusado]")).toBeNull();
    act(() => root.unmount());
    await montar({ status: "APROVADO", etapa: "APROVADO" });
    expect($("[data-enviar-email]")).toBeNull();
    expect($("[data-voltar-rascunho]")).toBeNull();
    expect($("a[href='/orcamento/tk1/imprimir']")?.textContent).toContain("Gerar PDF");
  });
});

describe("andamento da proposta", () => {
  const html = async (orcamento: Record<string, unknown>, eventos: any[] = [], agora = new Date("2026-10-15T15:00:00Z")) => {
    const { CicloOrcamento } = await import("@/components/orcamento/ciclo-orcamento");
    const div = document.createElement("div");
    div.innerHTML = renderToStaticMarkup(createElement(CicloOrcamento, { orcamento: orcamento as any, eventos, agora }));
    document.body.appendChild(div);
    return div;
  };
  const marco = (d: Element, e: string) => d.querySelector(`[data-marco='${e}']`) as HTMLElement;

  it("aprovado: trilha com data de cada etapa, a atual marcada; linha do tempo com canal, quem e IP", async () => {
    const d = await html({
      status: "APROVADO", criadoEm: "2026-10-01T12:00:00Z", enviadoEm: "2026-10-02T13:00:00Z", visualizadoEm: "2026-10-03T14:00:00Z", visualizacoes: 2,
      assinadoEm: "2026-10-04T15:30:00Z", assinadoPor: "Juliana Ramos", aprovadoIp: "200.1.2.3",
    }, [
      { id: "e2", tipo: "APROVADO", detalhe: "Juliana Ramos", ip: "200.1.2.3", criadoEm: "2026-10-04T15:30:00Z", usuario: null },
      { id: "e1", tipo: "ENVIADO_EMAIL", detalhe: "compras@hsc.com.br", ip: null, criadoEm: "2026-10-02T13:00:00Z", usuario: { nome: "Ana" } },
    ]);
    expect([...d.querySelectorAll("[data-marco]")].map((x) => x.getAttribute("data-marco"))).toEqual(["RASCUNHO", "ENVIADO", "VISUALIZADO", "APROVADO"]);
    expect(marco(d, "RASCUNHO").textContent).toContain("Criado01/10/2026 09:00");
    expect(marco(d, "VISUALIZADO").textContent).toContain("aberto 2 vezes");
    expect(marco(d, "APROVADO").textContent).toContain("04/10/2026 12:30");
    expect(marco(d, "APROVADO").textContent).toContain("Juliana Ramos · IP 200.1.2.3");
    expect(marco(d, "APROVADO").getAttribute("aria-current")).toBe("step");
    expect(marco(d, "ENVIADO").getAttribute("aria-current")).toBeNull();
    const ev = [...d.querySelectorAll("[data-evento]")];
    expect(ev.map((x) => x.getAttribute("data-evento"))).toEqual(["APROVADO", "ENVIADO_EMAIL"]);
    expect(ev[0].textContent).toContain("Aprovado pelo cliente — Juliana Ramos");
    expect(ev[0].textContent).toContain("04/10/2026 às 12:30 · cliente pelo link · IP 200.1.2.3");
    expect(ev[1].textContent).toContain("Enviado por e-mail — compras@hsc.com.br");
    expect(ev[1].textContent).toContain("· Ana");
    expect(ev[1].textContent).not.toContain("IP");
    expect(d.querySelector("[data-etapa='APROVADO']")).toBeTruthy();
  });

  it("recusado/expirado substituem o Aprovado; etapa ainda não alcançada fica sem data; sem eventos avisa", async () => {
    let d = await html({ status: "REPROVADO", criadoEm: "2026-10-01T12:00:00Z", enviadoEm: "2026-10-02T12:00:00Z", recusadoEm: "2026-10-05T12:00:00Z", recusadoPor: "Juliana", recusaMotivo: "Preço" });
    expect(marco(d, "APROVADO")).toBeNull();
    expect(marco(d, "RECUSADO").getAttribute("aria-current")).toBe("step");
    expect(marco(d, "RECUSADO").className).toContain("bg-atrasado-claro");
    expect(marco(d, "RECUSADO").textContent).toContain("Juliana · “Preço”");
    expect(marco(d, "VISUALIZADO").textContent).toContain("—"); // não abriu o link (recusa veio por fora)
    expect(marco(d, "VISUALIZADO").querySelector("svg.lucide-circle")).toBeTruthy(); // pulada: sem ✓
    expect(marco(d, "VISUALIZADO").className).toContain("border-dashed");
    expect(marco(d, "ENVIADO").querySelector("svg.lucide-circle-check-big, svg.lucide-check-circle-2, svg.lucide-circle-check")).toBeTruthy();
    expect(d.querySelector("[data-sem-eventos]")).toBeTruthy();
    d.remove();
    d = await html({ status: "ENVIADO", criadoEm: "2026-10-01T12:00:00Z", enviadoEm: "2026-10-02T12:00:00Z", validadeEm: "2026-10-10T00:00:00Z" });
    expect(marco(d, "EXPIRADO").textContent).toContain("11/10/2026");
    expect(marco(d, "EXPIRADO").textContent).not.toMatch(/\d\d:\d\d/); // dia civil, sem hora
    expect(marco(d, "EXPIRADO").getAttribute("aria-current")).toBe("step");
    d.remove();
    d = await html({ status: "ENVIADO", criadoEm: "2026-10-01T12:00:00Z", enviadoEm: "2026-10-02T12:00:00Z", validadeEm: "2026-10-20T00:00:00Z" });
    expect(marco(d, "ENVIADO").getAttribute("aria-current")).toBe("step");
    expect(marco(d, "VISUALIZADO").className).toContain("border-dashed");
    expect(marco(d, "APROVADO").textContent).toContain("—");
  });

  it("pílula da etapa com 'desde' (lista)", async () => {
    const { PilulaEtapa } = await import("@/components/orcamento/ciclo-orcamento");
    const h = renderToStaticMarkup(createElement(PilulaEtapa, { etapa: "VISUALIZADO", desde: "2026-10-03T14:05:00Z" }));
    expect(h).toContain('data-etapa="VISUALIZADO"');
    expect(h).toContain("Visualizado");
    expect(h).toContain("desde 03/10 11:05");
    expect(renderToStaticMarkup(createElement(PilulaEtapa, { etapa: "RASCUNHO", desde: null }))).not.toContain("desde");
    expect(renderToStaticMarkup(createElement(PilulaEtapa, { etapa: "EXPIRADO", desde: "2026-10-11T00:00:00Z" }))).toMatch(/desde 11\/10<\/span>/);
    // compacta (planilha): uma linha só, o "desde" no hover
    const c = renderToStaticMarkup(createElement(PilulaEtapa, { etapa: "VISUALIZADO", desde: "2026-10-03T14:05:00Z", compacta: true }));
    expect(c).toMatch(/^<span class="[^"]+" title="desde 03\/10 11:05" data-etapa="VISUALIZADO">Visualizado<\/span>$/);
  });
});

describe("sino: respostas do cliente", () => {
  const ALERTAS = {
    prazosVencidos: 0, etapasVencendoHoje: 0, pedidosPendentes: 0, atendimentosAtraso: 0, chamadosPortal: 0, checklistPendente: 0,
    checklistsComAlertas: 0, documentosVencendo: 0, veiculosManutencao: 0, revisaoChegando: 0, boletosPagos: 0, orcamentosRespondidos: 3, total: 3,
  };
  const abrirSino = async (permissoes: any) => {
    const { Header } = await import("@/components/layout/header");
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    respostas["GET /api/alertas"] = { status: 200, corpo: ALERTAS };
    const session = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role: "OPERADOR", permissoes }, expires: "2099-01-01T00:00:00Z" };
    await renderizar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(Header as any, { session, avatarUrl: null }) }));
    const sino = $$("button").find((b) => b.querySelector("svg.lucide-bell"));
    expect(sino?.textContent).toContain("3");
    await clicar(sino);
  };

  it("quem vê orçamentos: atalho com o número, para a lista filtrada nas respostas novas", async () => {
    const { permissoesTotais } = await import("@/lib/permissoes");
    await abrirSino(permissoesTotais());
    const a = $$<HTMLAnchorElement>("a").find((x) => x.textContent?.includes("Respostas de orçamentos"));
    expect(a?.getAttribute("href")).toBe("/orcamentos?resposta=nova&periodo=todos"); // respostas de qualquer mês
    expect(a?.textContent).toContain("3");
  });

  it("sem orçamentos no perfil: o atalho não aparece", async () => {
    const { montarPermissoes } = await import("@/lib/permissoes");
    await abrirSino(montarPermissoes({ ordens: ["visualizar"] }));
    expect(document.body.textContent).not.toContain("Respostas de orçamentos");
  });
});
