// @vitest-environment happy-dom
/**
 * ACEITE DO CLIENTE nas telas, num DOM de verdade (o servidor é um substituto que devolve o que o
 * teste manda; as regras estão em os-aceite e o servidor em os-aceite-pg):
 *  - o quadro de assinatura (nome + assinatura obrigatórios) usado no app do técnico e no escritório;
 *  - o cartão da OS no escritório: aguardando × confirmada, enviar (um clique), copiar link, colher;
 *  - o app do técnico: quando oferece, assinar pela fila (vale sem sinal), enviar o link (precisa de sinal);
 *  - o link público: nome obrigatório, o aviso do que fica registrado, o que vai no pedido;
 *  - o portal: as pendências em destaque e o formulário do chamado — livre, bloqueado e emergência.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navegacao = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const quadro = vi.hoisted(() => ({ vazio: false, limpou: 0 }));
const tecnico = vi.hoisted(() => ({ valor: { config: { exibirDadosCliente: true }, estado: { situacao: "online" } } as any }));
const ditos = vi.hoisted(() => [] as [string, string][]);
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: navegacao.refresh, push: navegacao.push, replace: vi.fn() }), usePathname: () => "/x", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/tecnico/contexto", () => ({ useTecnico: () => tecnico.valor }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<Record<string, unknown>>()), toast: (m: string, t = "sucesso") => { ditos.push([m, t]); } }));
vi.mock("@/lib/imagem-cliente", () => ({ reduzirImagem: vi.fn(), FOTO_GALERIA: { ladoMax: 1600, qualidade: 0.8 } }));
// Canvas de assinatura não existe no happy-dom: o teste diz se o quadro está vazio e o que ele devolve
const ASSINATURA = `data:image/png;base64,${"QUJD".repeat(60)}`;
vi.mock("react-signature-canvas", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef((p: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({ isEmpty: () => quadro.vazio, clear: () => { quadro.limpou++; }, getCanvas: () => ({ toDataURL: () => ASSINATURA }) }));
      return React.createElement("canvas", { ...p.canvasProps });
    }),
  };
});

let root: Root; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[];
let respostas: Record<string, { status: number; corpo: unknown } | { status: number; corpo: unknown }[]>;
let aba: { closed: boolean; location: { href: string }; close: ReturnType<typeof vi.fn>; opener: unknown };
let copiados: string[];

beforeEach(() => {
  navegacao.push.mockClear(); navegacao.refresh.mockClear();
  quadro.vazio = false; quadro.limpou = 0; ditos.length = 0; copiados = [];
  tecnico.valor = { config: { exibirDadosCliente: true }, estado: { situacao: "online" } };
  pedidos = []; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const u = String(entrada); const metodo = init?.method ?? "GET";
    pedidos.push({ url: u, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const x = respostas[`${metodo} ${u}`] ?? { status: 200, corpo: {} };
    const r = Array.isArray(x) ? (x.length > 1 ? x.shift()! : x[0]) : x;
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
  aba = { closed: false, location: { href: "" }, close: vi.fn(), opener: {} };
  vi.spyOn(window, "open").mockImplementation(() => aba as unknown as Window);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => { copiados.push(t); } }, configurable: true });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); root = undefined as unknown as Root; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const $ = <T extends Element = HTMLElement>(s: string) => (document.body.querySelector(s) as T | null);
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const texto = (el: Element | null = caixa) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(seletor: string, valor: string) {
  const el = $(seletor) as HTMLInputElement | HTMLTextAreaElement; expect(el, seletor).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function montar(elemento: React.ReactElement) {
  if (root) { act(() => root.unmount()); caixa.remove(); }
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(elemento); });
  await esperar();
}
const escritas = () => pedidos.filter((p) => p.metodo !== "GET");
const NOME = "input[aria-label='Nome de quem recebeu o serviço']";

/* ───────── o quadro de assinatura ───────── */
describe("Quadro de assinatura do cliente (aceite no local)", () => {
  const confirmados: unknown[] = []; let falha: string | null = null; let cancelou = 0;
  async function abrir() {
    confirmados.length = 0; falha = null; cancelou = 0;
    const { AssinaturaDoCliente } = await import("@/components/os/aceite-assinatura");
    await montar(createElement(AssinaturaDoCliente, { resumo: "OS-123 · Hospital Santa Clara", aoConfirmar: async (d: unknown) => { confirmados.push(d); return falha; }, aoCancelar: () => { cancelou++; } }));
  }

  it("diz DE QUAL serviço se trata e o que fica registrado, antes de qualquer assinatura", async () => {
    await abrir();
    expect(texto($("[data-resumo-aceite]"))).toBe("Confirmo que o serviço foi realizado: OS-123 · Hospital Santa Clara.");
    expect(texto($("[data-aviso-registro]"))).toBe("Ficam registrados o nome, a assinatura, a data e a hora. A confirmação entra no relatório da OS.");
    expect($("canvas[aria-label='Quadro de assinatura']")).toBeTruthy();
    expect($("[data-erro-aceite]")).toBeNull();
  });

  it("sem nome não confirma; com nome e quadro vazio também não — e diz o que falta", async () => {
    await abrir();
    await clicar($("[data-confirmar-aceite]"));
    expect(texto($("[data-erro-aceite]"))).toBe("Informe o nome completo de quem confirma.");
    await digitar(NOME, "  Jo  ");
    await clicar($("[data-confirmar-aceite]"));
    expect(texto($("[data-erro-aceite]"))).toBe("Informe o nome completo de quem confirma.");
    quadro.vazio = true;
    await digitar(NOME, "João Pereira");
    await clicar($("[data-confirmar-aceite]"));
    expect(texto($("[data-erro-aceite]"))).toBe("Peça para o cliente assinar no quadro.");
    expect(confirmados).toEqual([]);
  });

  it("com nome e assinatura, entrega os dois (nome sem espaços nas pontas); a falha de quem grava aparece na tela", async () => {
    await abrir();
    await digitar(NOME, "  João Pereira da Silva ");
    await clicar($("[data-confirmar-aceite]"));
    expect(confirmados).toEqual([{ nome: "João Pereira da Silva", assinatura: ASSINATURA }]);
    expect($("[data-erro-aceite]")).toBeNull();
    falha = "Sem permissão para registrar o aceite do cliente.";
    await clicar($("[data-confirmar-aceite]"));
    expect(texto($("[data-erro-aceite]"))).toBe("Sem permissão para registrar o aceite do cliente.");
    expect(confirmados).toHaveLength(2);
  });

  it("Limpar apaga o quadro; Cancelar sai sem gravar", async () => {
    await abrir();
    await clicar($("[data-limpar-assinatura]"));
    expect(quadro.limpou).toBe(1);
    await clicar($$("[data-assinatura-cliente] button").find((b) => texto(b) === "Cancelar"));
    expect([cancelou, confirmados.length]).toEqual([1, 0]);
  });
});

/* ───────── o cartão da OS no escritório ───────── */
describe("Aceite na OS (escritório)", () => {
  const G = "GET /api/ordens/os1/aceite", ENVIAR = "POST /api/ordens/os1/aceite/enviar", COLHER = "POST /api/ordens/os1/aceite";
  const pendente = (extra: Record<string, unknown> = {}) => ({ token: "tok123", situacao: "PENDENTE", metodo: null, nome: null, observacao: null, ip: null, confirmadoEm: null, colhidoPor: null, assinatura: null, enviadoEm: null, enviadoCanal: null, enviadoPara: null, envios: 0, ...extra });
  const AGUARDANDO = { estado: "AGUARDANDO", statusOs: "CONCLUIDA", aceite: pendente(), caminhoPublico: "/relatorio/aceite/tok123" };
  const confirmado = (extra: Record<string, unknown> = {}) => ({ estado: "CONFIRMADO", statusOs: "CONCLUIDA", caminhoPublico: "/relatorio/aceite/tok123", aceite: pendente({ situacao: "CONFIRMADO", metodo: "REMOTO", nome: "Roberto Almeida", ip: "200.150.10.5", confirmadoEm: "2026-11-12T15:00:00.000Z", ...extra }) });
  const mudancas: unknown[] = [];
  async function abrir(permissoes: Permissoes = permissoesTotais(), statusOs = "CONCLUIDA") {
    mudancas.length = 0;
    const [{ OsAceite }, { PermissoesProvider }] = await Promise.all([import("@/components/os/os-aceite"), import("@/components/providers/permissoes-provider")]);
    await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(OsAceite, { osId: "os1", numero: "OS-123", cliente: "Hospital Santa Clara", statusOs, aoMudar: (a: unknown) => { mudancas.push(a); } }) }));
  }
  const soVer = montarPermissoes({ ordens: ["visualizar", "concluir"] });

  it("OS concluída sem aceite: 'Aguardando confirmação do cliente', dizendo que ela JÁ pode ser faturada; quem edita tem os três caminhos", async () => {
    respostas[G] = { status: 200, corpo: AGUARDANDO };
    await abrir();
    const c = $("[data-aceite-os='AGUARDANDO']");
    expect(texto($("[data-aceite-titulo]"))).toBe("Aguardando confirmação do cliente");
    expect(texto(c)).toContain("A OS está concluída e pode ser faturada. Falta o cliente confirmar o recebimento.");
    expect($$("[data-acoes-aceite] button").map((b) => texto(b))).toEqual(["Enviar ao cliente", "Copiar link", "Colher assinatura"]);
    expect($("[data-aceite-envio]")).toBeNull(); // ainda não foi pedido
    expect(mudancas).toEqual([{ situacao: "PENDENTE", nome: null, confirmadoEm: null, metodo: null }]);
  });

  it("quem só visualiza vê a situação, sem nenhum botão; OS que não concluiu não mostra nada", async () => {
    respostas[G] = { status: 200, corpo: { ...AGUARDANDO, aceite: pendente({ enviadoEm: "2026-11-12T14:00:00.000Z", enviadoCanal: "WHATSAPP_EMAIL", enviadoPara: "manutencao@hospital.com · WhatsApp (11) 96666-5555", envios: 1 }) } };
    await abrir(soVer);
    expect($("[data-aceite-os='AGUARDANDO']")).toBeTruthy();
    expect($("[data-acoes-aceite]")).toBeNull();
    expect($$("[data-aceite-os] button")).toEqual([]);
    expect(texto($("[data-aceite-envio]"))).toMatch(/^Último pedido em 12\/11\/2026.*WhatsApp e e-mail \(manutencao@hospital\.com · WhatsApp \(11\) 96666-5555\)\.$/);
    respostas[G] = { status: 200, corpo: { estado: "NAO_SE_APLICA", statusOs: "EM_ANDAMENTO", aceite: null, caminhoPublico: null } };
    await abrir(permissoesTotais(), "EM_ANDAMENTO");
    expect($("[data-aceite-os]")).toBeNull();
    respostas[G] = { status: 403, corpo: { erro: "Sem permissão" } };
    await abrir();
    expect($("[data-aceite-os]")).toBeNull();
  });

  it("ENVIAR AO CLIENTE (um clique): pede ao servidor, abre o WhatsApp com a mensagem e diz o que saiu", async () => {
    respostas[G] = [{ status: 200, corpo: AGUARDANDO }, { status: 200, corpo: { ...AGUARDANDO, aceite: pendente({ enviadoEm: "2026-11-12T15:00:00.000Z", enviadoCanal: "WHATSAPP_EMAIL", enviadoPara: "manutencao@hospital.com", envios: 1 }) } }];
    respostas[ENVIAR] = { status: 200, corpo: { publicUrl: "https://app/relatorio/aceite/tok123", mensagem: "Olá!", canal: "WHATSAPP_EMAIL", whatsappUrl: "https://wa.me/5511966665555?text=Ol%C3%A1!", emailEnviado: true, emailPara: "manutencao@hospital.com", erroEmail: null } };
    await abrir();
    await clicar($("[data-enviar-aceite]"));
    expect(escritas()).toEqual([{ url: "/api/ordens/os1/aceite/enviar", metodo: "POST", corpo: undefined }]);
    expect(window.open).toHaveBeenCalledTimes(1); // a aba abre no clique (depois o navegador bloquearia)
    expect(aba.location.href).toBe("https://wa.me/5511966665555?text=Ol%C3%A1!");
    expect(ditos).toEqual([["E-mail enviado para manutencao@hospital.com. O WhatsApp abriu com a mensagem pronta.", "sucesso"]]);
    expect($("[data-aceite-envio]")).toBeTruthy(); // releu: o último pedido aparece
    expect($("[data-erro-aceite-os]")).toBeNull();
  });

  it("sem WhatsApp nem e-mail: copia o link e avisa que fica pendente no portal; a recusa do servidor aparece e fecha a aba", async () => {
    respostas[G] = { status: 200, corpo: AGUARDANDO };
    respostas[ENVIAR] = { status: 200, corpo: { publicUrl: "https://app/relatorio/aceite/tok123", mensagem: "Olá!", canal: "LINK", whatsappUrl: null, emailEnviado: false, emailPara: null, erroEmail: "o cliente não tem e-mail para avisos de OS" } };
    await abrir();
    await clicar($("[data-enviar-aceite]"));
    expect(copiados).toEqual(["https://app/relatorio/aceite/tok123"]);
    expect(aba.close).toHaveBeenCalledTimes(1);
    expect(aba.location.href).toBe("");
    expect(ditos).toEqual([["Sem WhatsApp nem e-mail do cliente: o link foi copiado. E-mail não enviado: o cliente não tem e-mail para avisos de OS. A confirmação fica pendente no portal.", "info"]]);
    respostas[ENVIAR] = { status: 409, corpo: { erro: "Este serviço já foi confirmado." } };
    ditos.length = 0;
    await clicar($("[data-enviar-aceite]"));
    expect(texto($("[data-erro-aceite-os]"))).toBe("Este serviço já foi confirmado.");
    expect(aba.close).toHaveBeenCalledTimes(2);
    expect(ditos).toEqual([]);
  });

  it("COPIAR LINK: o endereço completo do link público vai para a área de transferência", async () => {
    respostas[G] = { status: 200, corpo: AGUARDANDO };
    await abrir();
    await clicar($("[data-copiar-aceite]"));
    expect(copiados).toEqual([`${window.location.origin}/relatorio/aceite/tok123`]);
    expect(ditos).toEqual([["Link copiado.", "sucesso"]]);
    expect(escritas()).toEqual([]);
  });

  it("COLHER ASSINATURA: abre o quadro com a OS e o cliente, grava nome + assinatura e o cartão vira 'Confirmada pelo cliente'", async () => {
    respostas[G] = [{ status: 200, corpo: AGUARDANDO }, { status: 200, corpo: confirmado({ metodo: "LOCAL", nome: "Marta Nunes", colhidoPor: "Ana Souza", ip: "177.1.2.3", assinatura: ASSINATURA }) }];
    await abrir();
    expect($("[data-assinatura-cliente]")).toBeNull();
    await clicar($("[data-colher-aceite]"));
    expect(texto($("[data-resumo-aceite]"))).toBe("Confirmo que o serviço foi realizado: OS-123 · Hospital Santa Clara.");
    await digitar(NOME, "Marta Nunes");
    respostas[COLHER] = { status: 409, corpo: { erro: "A OS ainda não está concluída." } };
    await clicar($("[data-confirmar-aceite]"));
    expect(texto($("[data-erro-aceite]"))).toBe("A OS ainda não está concluída."); // a recusa fica no quadro, que continua aberto
    respostas[COLHER] = { status: 200, corpo: {} };
    await clicar($("[data-confirmar-aceite]"));
    expect(escritas().at(-1)).toEqual({ url: "/api/ordens/os1/aceite", metodo: "POST", corpo: { nome: "Marta Nunes", assinatura: ASSINATURA } });
    expect($("[data-assinatura-cliente]")).toBeNull();
    expect(ditos).toEqual([["Aceite do cliente registrado.", "sucesso"]]);
    expect($("[data-aceite-os='CONFIRMADO']")).toBeTruthy();
    expect(texto($("[data-aceite-titulo]"))).toBe("Confirmada pelo cliente");
    expect(texto($("[data-aceite-quem]"))).toBe("Confirmado por Marta Nunes em 12/11/2026 às 12:00");
    expect(texto($("[data-aceite-prova]"))).toBe("no local, com assinatura colhida por Ana Souza · IP 177.1.2.3");
    expect($("[data-aceite-assinatura]")?.getAttribute("src")).toBe(ASSINATURA);
    expect($("[data-aceite-assinatura]")?.getAttribute("alt")).toBe("Assinatura de Marta Nunes");
    expect($$("[data-aceite-os] button")).toEqual([]);
    expect(mudancas.at(-1)).toEqual({ situacao: "CONFIRMADO", nome: "Marta Nunes", confirmadoEm: "2026-11-12T15:00:00.000Z", metodo: "LOCAL" });
  });

  it("confirmada pelo link: a PROVA — quem, quando, como, de onde e a observação do cliente (igual para quem só visualiza)", async () => {
    respostas[G] = { status: 200, corpo: confirmado({ observacao: "Tudo certo, equipe pontual" }) };
    await abrir(soVer);
    expect(texto($("[data-aceite-quem]"))).toBe("Confirmado por Roberto Almeida em 12/11/2026 às 12:00");
    expect(texto($("[data-aceite-prova]"))).toBe("pelo link de confirmação · IP 200.150.10.5");
    expect(texto($("[data-aceite-observacao]"))).toBe("Observação do cliente: Tudo certo, equipe pontual");
    expect($("[data-aceite-assinatura]")).toBeNull();
  });

  it("OS concluída ANTES do aceite existir: quem edita pode pedir a confirmação (só o envio); quem só visualiza não vê nada", async () => {
    respostas[G] = { status: 200, corpo: { estado: "NAO_SE_APLICA", statusOs: "CONCLUIDA", aceite: null, caminhoPublico: null } };
    await abrir();
    expect($("[data-aceite-os='SEM_REGISTRO']")).toBeTruthy();
    expect(texto($("[data-aceite-titulo]"))).toBe("Sem confirmação do cliente");
    expect($$("[data-acoes-aceite] button").map((b) => texto(b))).toEqual(["Enviar ao cliente"]);
    expect(mudancas).toEqual([null]);
    await abrir(soVer);
    expect($("[data-aceite-os]")).toBeNull();
  });
});

/* ───────── app do técnico ───────── */
describe("Aceite no app do técnico (depois de concluir)", () => {
  const ops: unknown[] = []; let falhaAoGuardar = false;
  const retrato = (aceite: unknown) => ({ cartao: { cliente: "Hospital Santa Clara", osNumero: "OS-123" }, aceite }) as any;
  const tela = (status = "CONCLUIDA", aceiteLocal?: { nome: string; em: string }) => ({ atividade: { id: "a1", titulo: "Manutenção Preventiva", status }, os: { id: "os1", numero: "OS-123" }, aceiteLocal }) as any;
  const PENDENTE = { situacao: "PENDENTE", nome: null, confirmadoEm: null, osConcluida: true, ultimaDaOs: true };
  async function abrir(aceite: unknown = PENDENTE, x = tela(), aEnviar = 0) {
    ops.length = 0; falhaAoGuardar = false;
    const { AceiteNaOs } = await import("@/components/tecnico/aceite-cliente");
    await montar(createElement(AceiteNaOs, { r: retrato(aceite), x, aEnviar, registrar: async (o: unknown[]) => { if (falhaAoGuardar) throw new Error("cheio"); ops.push(...o); } }));
  }
  const ENVIAR = "POST /api/ordens/os1/aceite/enviar";

  it("só aparece depois de concluir, na atividade que fecha a OS, e para quem pode colher (retrato com aceite)", async () => {
    await abrir(PENDENTE, tela("EM_ANDAMENTO"));
    expect($("[data-aceite-app]")).toBeNull();
    await abrir(null);                                              // sem "OS › Editar": o servidor não manda o aceite
    expect($("[data-aceite-app]")).toBeNull();
    await abrir({ ...PENDENTE, situacao: null, osConcluida: false, ultimaDaOs: false }); // ainda há outra visita da OS em aberto
    expect($("[data-aceite-app]")).toBeNull();
    await abrir({ ...PENDENTE, situacao: null, osConcluida: false, ultimaDaOs: true });  // a última: concluiu no aparelho, ainda sem subir
    expect($("[data-aceite-app='OFERECE']")).toBeTruthy();
    await abrir();
    expect($$("[data-aceite-app] button").map((b) => texto(b))).toEqual(["Cliente assina agora", "Enviar link ao cliente"]);
    expect(texto($("[data-aceite-app]"))).toContain("Tem alguém do cliente no local? Peça a assinatura. Se não, envie o link para ele confirmar.");
  });

  it("CLIENTE ASSINA AGORA: a assinatura entra na FILA do aparelho (uma operação 'aceite' da atividade) — vale sem sinal", async () => {
    await abrir();
    await clicar($("[data-aceite-assinar]"));
    expect(texto($("[data-resumo-aceite]"))).toBe("Confirmo que o serviço foi realizado: OS-123 · Hospital Santa Clara.");
    await digitar(NOME, "João Pereira da Silva");
    await clicar($("[data-confirmar-aceite]"));
    expect(ops).toEqual([{ tipo: "aceite", atividadeId: "a1", dados: { nome: "João Pereira da Silva", assinatura: ASSINATURA } }]);
    expect(escritas()).toEqual([]); // nada vai direto ao servidor: é a fila que leva
    expect($("[data-assinatura-cliente]")).toBeNull();
    expect(ditos).toEqual([["Aceite do cliente registrado.", "sucesso"]]);
    // Sem sinal: a mesma operação, e o recado diz que sobe depois
    tecnico.valor = { config: { exibirDadosCliente: true }, estado: { situacao: "offline" } };
    await abrir(); ditos.length = 0;
    await clicar($("[data-aceite-assinar]"));
    await digitar(NOME, "João Pereira da Silva");
    await clicar($("[data-confirmar-aceite]"));
    expect(ops).toHaveLength(1);
    expect(ditos).toEqual([["Aceite guardado no aparelho: sobe quando houver sinal.", "sucesso"]]);
  });

  it("aparelho sem espaço: a assinatura não some calada — o quadro continua aberto com o motivo; dado do cliente oculto não aparece no resumo", async () => {
    tecnico.valor = { config: { exibirDadosCliente: false }, estado: { situacao: "online" } };
    await abrir();
    await clicar($("[data-aceite-assinar]"));
    expect(texto($("[data-resumo-aceite]"))).toBe("Confirmo que o serviço foi realizado: OS-123 · Manutenção Preventiva."); // sem o nome do cliente
    falhaAoGuardar = true;
    await digitar(NOME, "João Pereira da Silva");
    await clicar($("[data-confirmar-aceite]"));
    expect(texto($("[data-erro-aceite]"))).toBe("Não deu para guardar no aparelho (sem espaço?). Libere espaço e toque de novo.");
    expect($("[data-assinatura-cliente]")).toBeTruthy();
    expect(ditos).toEqual([]);
  });

  it("ENVIAR LINK (um toque): o servidor manda o e-mail e o WhatsApp abre com a mensagem pronta; o recado fica na tela", async () => {
    respostas[ENVIAR] = { status: 200, corpo: { publicUrl: "https://app/l", mensagem: "Olá!", canal: "WHATSAPP_EMAIL", whatsappUrl: "https://wa.me/5511966665555?text=x", emailEnviado: true, emailPara: "manutencao@hospital.com", erroEmail: null } };
    await abrir();
    await clicar($("[data-aceite-enviar]"));
    expect(escritas()).toEqual([{ url: "/api/ordens/os1/aceite/enviar", metodo: "POST", corpo: undefined }]);
    expect(aba.location.href).toBe("https://wa.me/5511966665555?text=x");
    expect(texto($("[data-aceite-pedido]"))).toBe("E-mail enviado para manutencao@hospital.com. O WhatsApp abriu com a mensagem pronta.");
    expect(ditos).toEqual([["E-mail enviado para manutencao@hospital.com. O WhatsApp abriu com a mensagem pronta.", "sucesso"]]);
    expect(ops).toEqual([]);
  });

  it("o envio precisa de sinal e da fila vazia: sem sinal ou com gravações a subir, não chama o servidor e explica", async () => {
    tecnico.valor = { config: { exibirDadosCliente: true }, estado: { situacao: "offline" } };
    await abrir();
    await clicar($("[data-aceite-enviar]"));
    expect(ditos).toEqual([["Sem sinal: a confirmação já fica pendente no portal do cliente. Envie o link quando o sinal voltar.", "info"]]);
    tecnico.valor = { config: { exibirDadosCliente: true }, estado: { situacao: "online" } };
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true }); // o navegador já sabe que caiu
    await abrir(); ditos.length = 0;
    await clicar($("[data-aceite-enviar]"));
    expect(ditos.map((d) => d[1])).toEqual(["info"]);
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    await abrir(PENDENTE, tela(), 2); ditos.length = 0; // a conclusão ainda não subiu: o servidor recusaria
    await clicar($("[data-aceite-enviar]"));
    expect(ditos).toEqual([["Aguarde as gravações desta OS subirem e toque de novo.", "info"]]);
    expect(escritas()).toEqual([]);
    expect(window.open).not.toHaveBeenCalled();
    expect($("[data-aceite-pedido]")).toBeNull();
  });

  it("contato do cliente não liberado para o app (sem WhatsApp nem e-mail): avisa o técnico; a recusa do servidor vira aviso de erro", async () => {
    respostas[ENVIAR] = { status: 200, corpo: { publicUrl: "https://app/l", mensagem: "Olá!", canal: "LINK", whatsappUrl: null, emailEnviado: false, emailPara: null, erroEmail: "x" } };
    await abrir();
    await clicar($("[data-aceite-enviar]"));
    const semCanal = "O cliente não tem WhatsApp nem e-mail liberado para o app. A confirmação fica pendente no portal; avise o escritório.";
    expect(ditos).toEqual([[semCanal, "info"]]);
    expect(texto($("[data-aceite-pedido]"))).toBe(semCanal);
    expect(aba.close).toHaveBeenCalledTimes(1);
    respostas[ENVIAR] = { status: 403, corpo: { erro: "Esta OS não está atribuída a você. Fale com o escritório." } };
    await abrir(); ditos.length = 0;
    await clicar($("[data-aceite-enviar]"));
    expect(ditos).toEqual([["Esta OS não está atribuída a você. Fale com o escritório.", "erro"]]);
    expect($("[data-aceite-pedido]")).toBeNull();
  });

  it("depois do aceite: mostra quem confirmou e quando — do servidor, ou o colhido neste aparelho (com 'a enviar' enquanto não subiu)", async () => {
    await abrir({ ...PENDENTE, situacao: "CONFIRMADO", nome: "Roberto Almeida", confirmadoEm: "2026-11-12T15:00:00.000Z" });
    expect($("[data-aceite-app='CONFIRMADO']")).toBeTruthy();
    expect(texto($("[data-aceite-app-texto]"))).toBe("Confirmado por Roberto Almeida em 12/11/2026 às 12:00");
    expect($$("[data-aceite-app] button")).toEqual([]);
    await abrir(PENDENTE, tela("CONCLUIDA", { nome: "João Pereira", em: "2026-11-12T16:30:00.000Z" }), 1);
    expect($("[data-aceite-app='COLHIDO_NO_APARELHO']")).toBeTruthy();
    expect(texto($("[data-aceite-app-texto]"))).toBe("Confirmado por João Pereira em 12/11/2026 às 13:30 (a enviar)");
    await abrir(PENDENTE, tela("CONCLUIDA", { nome: "João Pereira", em: "2026-11-12T16:30:00.000Z" }), 0);
    expect(texto($("[data-aceite-app-texto]"))).toBe("Confirmado por João Pereira em 12/11/2026 às 13:30");
    expect($$("[data-aceite-app] button")).toEqual([]); // já colhido: não oferece de novo
  });
});

/* ───────── o link público ───────── */
describe("Confirmação pelo link público", () => {
  const CONFIRMAR = "POST /api/publico/aceites/tok%2F123/confirmar";
  async function abrir(nomeSugerido: string | null = null) {
    const { AceitePublico } = await import("@/components/os/aceite-publico");
    await montar(createElement(AceitePublico, { token: "tok/123", rotulo: "OS-123, concluída em 05/11/2026", nomeSugerido }));
  }
  const N = "input[aria-label='Nome completo']", O = "textarea[aria-label='Observação']";

  it("diz qual OS está sendo confirmada e avisa, antes do clique, que nome, data, hora e IP ficam registrados", async () => {
    await abrir();
    expect(texto($("[data-aceite-rotulo]"))).toBe("Confirmação do recebimento do serviço da OS-123, concluída em 05/11/2026.");
    expect(texto($("[data-aviso-registro]"))).toBe("Ao confirmar, registramos seu nome, a data e a hora e o endereço IP desta confirmação.");
    expect(texto($("[data-confirmar-aceite-publico]"))).toBe("Confirmo o recebimento do serviço");
    expect(($(N) as HTMLInputElement).value).toBe("");
  });

  it("sem nome não confirma (e não chama o servidor); com nome, manda nome + observação e relê a página", async () => {
    await abrir();
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(texto($("[data-erro-aceite-publico]"))).toBe("Informe o nome completo de quem confirma.");
    await digitar(N, " A ");
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(pedidos).toEqual([]);
    await digitar(N, "  Roberto Almeida ");
    await digitar(O, "  Tudo certo  ");
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(pedidos).toEqual([{ url: "/api/publico/aceites/tok%2F123/confirmar", metodo: "POST", corpo: { nome: "Roberto Almeida", observacao: "Tudo certo" } }]);
    expect(navegacao.refresh).toHaveBeenCalledTimes(1);
    expect($("[data-erro-aceite-publico]")).toBeNull();
  });

  it("logado no portal, o nome do contato já vem preenchido; sem observação vai null", async () => {
    await abrir("Dra. Paula Reis");
    expect(($(N) as HTMLInputElement).value).toBe("Dra. Paula Reis");
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(pedidos[0].corpo).toEqual({ nome: "Dra. Paula Reis", observacao: null });
  });

  it("recusa do servidor aparece; se já foi confirmado (409) a página relê para mostrar o que vale", async () => {
    respostas[CONFIRMAR] = { status: 409, corpo: { erro: "Este serviço já foi confirmado." } };
    await abrir("Roberto Almeida");
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(texto($("[data-erro-aceite-publico]"))).toBe("Este serviço já foi confirmado.");
    expect(navegacao.refresh).toHaveBeenCalledTimes(1);
    navegacao.refresh.mockClear();
    respostas[CONFIRMAR] = { status: 404, corpo: { erro: "Link de confirmação não encontrado" } };
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(texto($("[data-erro-aceite-publico]"))).toBe("Link de confirmação não encontrado");
    expect(navegacao.refresh).not.toHaveBeenCalled();
  });
});

/* ───────── portal do cliente ───────── */
describe("Portal do cliente: pendências e o novo chamado", () => {
  const P1 = { osId: "os1", numero: "OS-123", token: "tok1", concluidaEm: "2026-11-05T15:00:00.000Z", servico: "Manutenção preventiva" };
  const P2 = { osId: "os2", numero: "OS-98", token: "tok/2", concluidaEm: "2026-10-20T15:00:00.000Z", servico: "Limpeza química" };
  async function pendencias(lista: unknown[], obrigatorio = false) {
    const { AceitesPendentes } = await import("@/components/portal/aceites-pendentes");
    await montar(createElement(AceitesPendentes, { pendencias: lista as any, obrigatorio }));
  }
  async function formulario(confirmacoesPendentes?: number) {
    const { ChamadoForm } = await import("@/components/portal/chamado-form");
    await montar(createElement(ChamadoForm, { unidades: [], equipamentos: [], tiposProblema: ["Não gela"], ...(confirmacoesPendentes === undefined ? {} : { confirmacoesPendentes }) }));
  }

  it("PENDÊNCIAS em destaque: quantas são, qual OS, de quando e o que foi feito — com o botão de confirmar ao lado de cada uma", async () => {
    await pendencias([P1, P2]);
    expect($("[data-aceites-pendentes]")?.getAttribute("data-aceites-pendentes")).toBe("2");
    expect(texto($("[data-aceites-pendentes] h2"))).toBe("2 serviços aguardando sua confirmação");
    expect($$("[data-aceite-pendente]").map((li) => texto(li))).toEqual(["OS-123 · 05/11 · Manutenção preventivaVer e confirmar", "OS-98 · 20/10 · Limpeza químicaVer e confirmar"]);
    expect($$("[data-confirmar-pendente]").map((a) => a.getAttribute("href"))).toEqual(["/relatorio/aceite/tok1", "/relatorio/aceite/tok%2F2"]);
    expect(texto($("[data-aceites-texto]"))).toBe("Leva menos de um minuto: veja o relatório e confirme o recebimento.");
    await pendencias([P1]);
    expect(texto($("[data-aceites-pendentes] h2"))).toBe("1 serviço aguardando sua confirmação");
    await pendencias([P1], true);
    expect(texto($("[data-aceites-texto]"))).toBe("Confirme os serviços abaixo antes de abrir um novo chamado.");
    await pendencias([]);
    expect($("[data-aceites-pendentes]")).toBeNull(); // sem pendência, sem faixa
  });

  it("SOFT GATE (padrão): o formulário do chamado abre direto e o pedido não fala em emergência", async () => {
    await formulario();
    expect($("[data-chamado-bloqueado]")).toBeNull();
    expect($("form textarea")).toBeTruthy();
    respostas["POST /api/portal/chamados"] = { status: 201, corpo: { id: "novo1" } };
    await digitar("form textarea", "Split da recepção pingando água");
    await clicar($("form button[type='submit']"));
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].corpo).toEqual({ unidadeId: null, equipamentoId: null, tipoProblema: null, descricao: "Split da recepção pingando água", urgencia: "NORMAL", fotos: [] });
    expect(navegacao.push).toHaveBeenCalledWith("/portal/chamados/novo1");
    await formulario(0);
    expect($("[data-chamado-bloqueado]")).toBeNull();
  });

  it("BLOQUEIO DA EMPRESA: no lugar do formulário, o pedido de confirmar — e a saída de EMERGÊNCIA sempre à mão", async () => {
    await formulario(2);
    expect($("form")).toBeNull();
    expect(texto($("[data-chamado-bloqueado]"))).toContain("Para abrir um novo chamado, confirme primeiro os serviços acima. Depois de confirmar, é só voltar a esta página.");
    expect(texto($("[data-chamado-bloqueado]"))).toContain("Equipamento parado ou risco no local? O chamado de emergência abre agora, sem esperar a confirmação.");
    expect(texto($("[data-emergencia]"))).toBe("É uma emergência: abrir chamado agora");
    await formulario(1);
    expect(texto($("[data-chamado-bloqueado]"))).toContain("confirme primeiro o serviço acima.");
  });

  it("EMERGÊNCIA: um toque abre o formulário, que avisa e manda `emergencia: true`; a recusa do servidor aparece", async () => {
    await formulario(2);
    await clicar($("[data-emergencia]"));
    expect($("[data-chamado-bloqueado]")).toBeNull();
    expect(texto($("[data-chamado-emergencia]"))).toBe("Chamado de emergência. As confirmações continuam pendentes para depois.");
    await digitar("form textarea", "Chiller parado, UTI sem climatização");
    respostas["POST /api/portal/chamados"] = { status: 409, corpo: { erro: "Antes de abrir um novo chamado, confirme os serviços pendentes — ou abra como emergência." } };
    await clicar($("form button[type='submit']"));
    expect(pedidos[0].corpo).toMatchObject({ descricao: "Chiller parado, UTI sem climatização", emergencia: true });
    expect(texto($("form"))).toContain("Antes de abrir um novo chamado, confirme os serviços pendentes — ou abra como emergência.");
    expect(navegacao.push).not.toHaveBeenCalled();
    respostas["POST /api/portal/chamados"] = { status: 201, corpo: { id: "novo2" } };
    await clicar($("form button[type='submit']"));
    expect(navegacao.push).toHaveBeenCalledWith("/portal/chamados/novo2");
  });
});
