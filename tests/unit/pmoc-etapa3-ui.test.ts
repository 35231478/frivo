// @vitest-environment happy-dom
/**
 * PMOC — Etapa 3 nas telas, num DOM de verdade (o servidor é um substituto que devolve o que o teste manda;
 * as regras e o banco estão em pmoc-documento, pmoc-avisos e pmoc-etapa3-pg):
 *  - "Baixar documento" e "Enviar ao cliente" (WhatsApp, e-mail, copiar link) no cabeçalho do plano;
 *  - o aviso de vencimento com "Ciente" (só para quem edita), na antecedência da empresa;
 *  - a aba "Histórico";
 *  - a ART: até 3 MB, foto reduzida antes de enviar;
 *  - o texto técnico padrão da empresa no plano novo;
 *  - "Configurações" do PMOC na lista; o bloco PMOC do dashboard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as avisos from "@/components/ui/avisos";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { DESCRICAO_PADRAO_PMOC } from "@/lib/pmoc";
import type { PmocDados } from "@/components/pmoc/pmoc-editor";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navegacao = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: navegacao.refresh, push: navegacao.push, replace: vi.fn() }), usePathname: () => "/pmoc/p1", useSearchParams: () => new URLSearchParams() }));
// A redução de imagem usa o canvas do navegador: aqui é um dublê que o teste controla
const reducao = vi.hoisted(() => ({ fn: null as any }));
vi.mock("@/lib/imagem-cliente", () => ({ reduzirImagem: (...a: unknown[]) => reducao.fn(...a) }));

const AGORA = new Date("2026-11-12T15:00:00.000Z"); // 12:00 em Brasília
const URL_P = "/api/pmocs/p1";

let root: Root; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[];
let respostas: Record<string, { status: number; corpo: unknown }>;
let toast: ReturnType<typeof vi.spyOn>;
let aba: { closed: boolean; location: { href: string }; close: ReturnType<typeof vi.fn>; opener: unknown };

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
  toast = vi.spyOn(avisos, "toast").mockImplementation(() => {});
  aba = { closed: false, location: { href: "" }, close: vi.fn(() => { aba.closed = true; }), opener: {} };
  vi.spyOn(window, "open").mockImplementation(() => aba as unknown as Window);
  reducao.fn = vi.fn(async () => ({ imagem: { dataUrl: "data:image/jpeg;base64,UkVEVVpJREE=", largura: 2200, altura: 1500, bytes: 400_000 } }));
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); root = undefined as unknown as Root; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

const $ = <T extends Element = HTMLElement>(s: string) => (document.body.querySelector(s) as T | null);
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const texto = (el: Element | null = caixa) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (rotulo: string) => $$("button").find((b) => texto(b) === rotulo || b.getAttribute("aria-label") === rotulo);
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
/** Plano publicado que expira em 12 dias (24/11/2026) */
const plano = (extra: Partial<PmocDados> = {}): PmocDados => ({
  id: "p1", nome: "PMOC 2026 — Hospital", descricao: "Texto", clienteId: "c1", unidadeId: "u1", dataInicio: "2025-11-25", dataExpiracao: "2026-11-24",
  status: "PUBLICADO", responsavelTecnicoId: null, rtNome: "Eng. Paula", rtCrea: "SP-1", artNumero: "123", artArquivoNome: null, artArquivoTipo: null, artArquivoTamanho: null, ativo: true,
  cliente: { id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" }, unidade: { id: "u1", nome: "Matriz", cidade: "São Paulo", estado: "SP" },
  equipamentos: [], ...extra,
});
const DESTINO = { contato: "Maria Lima", whatsapp: "(11) 97777-1234", email: "maria@hospital.com.br" };
async function abrirEditor(props: Record<string, unknown> = {}, permissoes: Permissoes = permissoesTotais()) {
  const [{ PmocEditor }, { PermissoesProvider }] = await Promise.all([import("@/components/pmoc/pmoc-editor"), import("@/components/providers/permissoes-provider")]);
  await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(PmocEditor, { inicial: plano(), destino: DESTINO, ...props }) }));
}
const SO_VER = montarPermissoes({ pmoc: ["visualizar"] });
const envios = () => pedidos.filter((p) => p.url === `${URL_P}/enviar`);

describe("PMOC › cabeçalho do plano: baixar e enviar", () => {
  it("'Baixar documento' é um link para o PDF gerado no servidor — também para quem só visualiza; no plano novo não existe", async () => {
    await abrirEditor();
    const link = $("a[data-baixar-documento]") as HTMLAnchorElement;
    expect([texto(link), link.getAttribute("href")]).toEqual(["Baixar documento", "/api/pmocs/p1/documento"]);
    await abrirEditor({}, SO_VER);
    expect($("a[data-baixar-documento]")).toBeTruthy();
    expect($("[data-enviar-cliente]")).toBeTruthy(); // enviar também respeita "visualizar"
    expect(botao("Salvar")).toBeUndefined();
    await abrirEditor({ inicial: undefined });
    expect($("a[data-baixar-documento]")).toBeNull();
    expect($("[data-enviar-cliente]")).toBeNull();
  });

  it("'Enviar ao cliente' mostra para quem vai e os três caminhos; nada é enviado só por abrir", async () => {
    await abrirEditor();
    await clicar($("[data-enviar-cliente]"));
    expect(texto($("[role=dialog] h3"))).toBe("Enviar ao cliente");
    expect(texto($("[data-destino-envio]"))).toBe("WhatsApp(11) 97777-1234 · Maria LimaE-mailmaria@hospital.com.br");
    expect($$("[data-modal-enviar] [data-canal]").map((b) => [b.getAttribute("data-canal"), texto(b)])).toEqual([["WHATSAPP", "Enviar por WhatsApp"], ["EMAIL", "Enviar por e-mail"], ["LINK", "Copiar link"]]);
    expect(envios()).toEqual([]);
    // cliente sem WhatsApp nem e-mail: a tela diz o que acontece em cada caso
    await abrirEditor({ destino: { contato: null, whatsapp: null, email: null } });
    await clicar($("[data-enviar-cliente]"));
    expect(texto($("[data-destino-envio]"))).toBe("WhatsAppSem número no cadastro: o contato é escolhido na conversa.E-mailSem e-mail no cadastro do cliente.");
  });

  it("plano em rascunho ou inativo: o diálogo diz por que não dá para enviar e não oferece os botões", async () => {
    await abrirEditor({ inicial: plano({ status: "RASCUNHO" }) });
    await clicar($("[data-enviar-cliente]"));
    expect(texto($("[data-envio-bloqueado]"))).toBe("Publique o plano antes de enviar ao cliente.");
    expect($$("[data-canal]")).toEqual([]);
    await abrirEditor({ inicial: plano({ ativo: false }) });
    await clicar($("[data-enviar-cliente]"));
    expect(texto($("[data-envio-bloqueado]"))).toBe("PMOC inativo: reative antes de enviar ao cliente.");
    expect(envios()).toEqual([]);
  });

  it("WhatsApp: a aba abre JÁ no clique (senão o navegador bloqueia), o servidor registra o envio e a aba vai para o wa.me", async () => {
    respostas[`POST ${URL_P}/enviar`] = { status: 200, corpo: { canal: "WHATSAPP", publicUrl: "https://app/relatorio/pmoc/tok", whatsappUrl: "https://wa.me/5511977771234?text=oi", para: "(11) 97777-1234" } };
    await abrirEditor();
    await clicar($("[data-enviar-cliente]"));
    await clicar($("[data-canal='WHATSAPP']"));
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(envios()).toEqual([{ url: `${URL_P}/enviar`, metodo: "POST", corpo: { canal: "WHATSAPP" } }]);
    expect(aba.location.href).toBe("https://wa.me/5511977771234?text=oi");
    expect(aba.opener).toBeNull(); // a aba do WhatsApp não enxerga o sistema
    expect(toast).toHaveBeenCalledWith("Conversa aberta com (11) 97777-1234.", "sucesso");
    expect($("[data-modal-enviar]")).toBeNull();
  });

  it("o servidor recusou (plano voltou para rascunho noutra aba): a aba aberta é fechada e o motivo aparece no diálogo", async () => {
    respostas[`POST ${URL_P}/enviar`] = { status: 409, corpo: { erro: "Publique o plano antes de enviar ao cliente." } };
    await abrirEditor();
    await clicar($("[data-enviar-cliente]"));
    await clicar($("[data-canal='WHATSAPP']"));
    expect(aba.close).toHaveBeenCalledTimes(1);
    expect(aba.location.href).toBe("");
    expect(texto($("[data-erro-envio]"))).toBe("Publique o plano antes de enviar ao cliente.");
    expect(toast).not.toHaveBeenCalled();
    expect($("[data-modal-enviar]")).toBeTruthy(); // continua aberto
  });

  it("e-mail: enviado pelo e-mail da empresa → avisa para quem foi; erro do envio → fica no diálogo", async () => {
    respostas[`POST ${URL_P}/enviar`] = { status: 200, corpo: { canal: "EMAIL", emailEnviado: true, para: "maria@hospital.com.br", publicUrl: "https://app/x" } };
    await abrirEditor();
    await clicar($("[data-enviar-cliente]"));
    await clicar($("[data-canal='EMAIL']"));
    expect(envios().at(-1)!.corpo).toEqual({ canal: "EMAIL" });
    expect(toast).toHaveBeenCalledWith("E-mail enviado para maria@hospital.com.br.");
    expect($("[data-modal-enviar]")).toBeNull();

    respostas[`POST ${URL_P}/enviar`] = { status: 200, corpo: { canal: "EMAIL", emailEnviado: false, erroEmail: "Domínio não verificado.", mailtoUrl: "mailto:x" } };
    await clicar($("[data-enviar-cliente]"));
    await clicar($("[data-canal='EMAIL']"));
    expect(texto($("[data-erro-envio]"))).toBe("Domínio não verificado.");
    respostas[`POST ${URL_P}/enviar`] = { status: 422, corpo: { erro: "O cliente não tem e-mail no cadastro. Cadastre o e-mail do contato principal ou envie por WhatsApp." } };
    await clicar($("[data-canal='EMAIL']"));
    expect(texto($("[data-erro-envio]"))).toContain("O cliente não tem e-mail no cadastro.");
  });

  it("copiar link: copia o link público e avisa; se o navegador não deixar copiar, mostra o link para copiar à mão", async () => {
    const copiar = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: copiar } });
    respostas[`POST ${URL_P}/enviar`] = { status: 200, corpo: { canal: "LINK", publicUrl: "https://app/relatorio/pmoc/tok" } };
    await abrirEditor();
    await clicar($("[data-enviar-cliente]"));
    await clicar($("[data-canal='LINK']"));
    expect(copiar).toHaveBeenCalledWith("https://app/relatorio/pmoc/tok");
    expect(toast).toHaveBeenCalledWith("Link copiado.");
    copiar.mockRejectedValueOnce(new Error("sem permissão"));
    await clicar($("[data-enviar-cliente]"));
    await clicar($("[data-canal='LINK']"));
    expect(texto($("[data-erro-envio]"))).toBe("Copie o link: https://app/relatorio/pmoc/tok");
  });
});

describe("PMOC › aviso de vencimento no plano", () => {
  const faixa = () => $("[data-aviso-vencimento]");

  it("plano perto de expirar: a faixa diz quando e como renovar; 'Ciente' registra e a faixa some", async () => {
    respostas[`POST ${URL_P}/aviso`] = { status: 200, corpo: { ok: true, tipo: "VENCENDO" } };
    await abrirEditor();
    expect(faixa()!.getAttribute("data-aviso-vencimento")).toBe("VENCENDO");
    expect(texto(faixa())).toBe("Expira em 12 dias (24/11/2026). Para renovar, use “Criar cópia” e informe a nova validade e a nova ART. Ciente");
    expect(faixa()!.className).toContain("bg-atencao-claro");
    await clicar($("[data-ciente]"));
    expect(pedidos.filter((p) => p.url === `${URL_P}/aviso`)).toEqual([{ url: `${URL_P}/aviso`, metodo: "POST", corpo: undefined }]);
    expect(faixa()).toBeNull();
    expect(navegacao.refresh).toHaveBeenCalled(); // o sino relê
  });

  it("expirado: faixa em tom de atraso; quem só visualiza vê a faixa, sem o botão 'Ciente'", async () => {
    await abrirEditor({ inicial: plano({ dataExpiracao: "2026-11-09" }) });
    expect(faixa()!.getAttribute("data-aviso-vencimento")).toBe("EXPIRADO");
    expect(texto(faixa())).toContain("Expirou há 3 dias (09/11/2026).");
    expect(faixa()!.className).toContain("bg-atrasado-claro");
    await abrirEditor({}, SO_VER);
    expect(faixa()).toBeTruthy();
    expect($("[data-ciente]")).toBeNull();
    expect(pedidos.filter((p) => p.url.endsWith("/aviso"))).toEqual([]);
  });

  it("sem faixa: quem já deu ciência, plano longe de expirar, rascunho e inativo; a ciência do 'vencendo' não esconde o 'expirado'", async () => {
    await abrirEditor({ avisoCiente: "VENCENDO" });
    expect(faixa()).toBeNull();
    await abrirEditor({ inicial: plano({ dataExpiracao: "2027-06-30" }) });
    expect(faixa()).toBeNull();
    await abrirEditor({ inicial: plano({ status: "RASCUNHO" }) });
    expect(faixa()).toBeNull();
    await abrirEditor({ inicial: plano({ ativo: false }) });
    expect(faixa()).toBeNull();
    await abrirEditor({ inicial: plano({ dataExpiracao: "2026-11-09" }), avisoCiente: "VENCENDO" });
    expect(faixa()!.getAttribute("data-aviso-vencimento")).toBe("EXPIRADO");
  });

  it("a antecedência é a da empresa: com 10 dias, o plano que expira em 12 ainda não avisa (nem no selo)", async () => {
    await abrirEditor({ config: { diasAviso: 10, textoPadrao: null } });
    expect(faixa()).toBeNull();
    expect($("[data-status-pmoc]")!.getAttribute("data-tom")).toBe("ok");
    await abrirEditor({ config: { diasAviso: 12, textoPadrao: null } });
    expect(faixa()).toBeTruthy();
    expect([$("[data-status-pmoc]")!.getAttribute("data-tom"), texto($("[data-status-pmoc]"))]).toEqual(["atencao", "Vigente · vence em 12 dias"]);
  });

  it("o servidor recusou a ciência: a faixa continua e o motivo aparece", async () => {
    respostas[`POST ${URL_P}/aviso`] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await abrirEditor();
    await clicar($("[data-ciente]"));
    expect(faixa()).toBeTruthy();
    expect(texto($("[data-msg='erro']"))).toBe("Sem permissão para esta ação");
  });
});

describe("PMOC › aba Histórico", () => {
  const LINHAS = [
    { id: "h3", acao: "Documento enviado por WhatsApp", detalhes: "Maria Lima · (11) 97777-1234", criadoEm: "2026-11-12T14:30:00.000Z", usuario: "Ana Souza" },
    { id: "h2", acao: "Aviso: plano perto de expirar", detalhes: "O plano expira em 24/11/2026 (faltam 12 dias).", criadoEm: "2026-11-12T13:00:00.000Z", usuario: null },
    { id: "h1", acao: "Plano publicado", detalhes: null, criadoEm: "2025-11-25T12:00:00.000Z", usuario: "Ana Souza" },
  ];

  it("a aba existe no plano salvo e mostra a linha do tempo: o quê, o detalhe, quando (Brasília) e quem — ou 'automático'", async () => {
    respostas[`GET ${URL_P}/historico`] = { status: 200, corpo: { historico: LINHAS } };
    await abrirEditor();
    expect(pedidos.some((p) => p.url.endsWith("/historico"))).toBe(false); // só carrega quando a aba é aberta
    await clicar($("[role=tab][data-aba='historico']"));
    expect($$("[data-linha-historico]").map((l) => texto(l))).toEqual([
      "Documento enviado por WhatsAppMaria Lima · (11) 97777-123412/11/2026 às 11:30 · Ana Souza",
      "Aviso: plano perto de expirarO plano expira em 24/11/2026 (faltam 12 dias).12/11/2026 às 10:00 · automático",
      "Plano publicado25/11/2025 às 09:00 · Ana Souza",
    ]);
  });

  it("sem registro, com erro do servidor, e relê depois de uma ciência", async () => {
    respostas[`GET ${URL_P}/historico`] = { status: 200, corpo: { historico: [] } };
    respostas[`POST ${URL_P}/aviso`] = { status: 200, corpo: { ok: true, tipo: "VENCENDO" } };
    await abrirEditor();
    await clicar($("[role=tab][data-aba='historico']"));
    expect(texto($("[data-sem-historico]"))).toBe("Nada registrado ainda.");
    const leituras = () => pedidos.filter((p) => p.url === `${URL_P}/historico`).length;
    expect(leituras()).toBe(1);
    await clicar($("[data-ciente]"));
    expect(leituras()).toBe(2);
    respostas[`GET ${URL_P}/historico`] = { status: 403, corpo: { erro: "Sem permissão para esta ação" } };
    await abrirEditor();
    await clicar($("[role=tab][data-aba='historico']"));
    expect(texto($("[data-erro-historico]"))).toBe("Sem permissão para esta ação");
  });
});

describe("PMOC › ART e texto técnico", () => {
  async function escolher(arquivo: File) {
    const input = $("input[aria-label='Arquivo da ART']") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [arquivo] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await esperar();
  }
  const arquivo = (nome: string, tipo: string, tamanho = 1000) => new File([new Uint8Array(tamanho)], nome, { type: tipo });

  it("o limite é 3 MB e a tela diz que o arquivo entra no documento; PDF maior é recusado sem sair do navegador", async () => {
    await abrirEditor();
    expect(texto()).toContain("PDF, JPG ou PNG até 3 MB. Entra no fim do documento do plano.");
    await escolher(arquivo("ART.pdf", "application/pdf", 3 * 1024 * 1024 + 1));
    expect(texto($("[data-msg='erro']"))).toBe("Arquivo da ART acima de 3 MB.");
    expect($("[data-art-arquivo]")).toBeNull();
    await escolher(arquivo("ART.pdf", "application/pdf"));
    expect(texto($("[data-art-arquivo]"))).toBe("ART.pdfa salvar");
    expect(reducao.fn).not.toHaveBeenCalled(); // PDF vai como é
    await escolher(arquivo("art.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    expect(texto($("[data-msg='erro']"))).toBe("A ART deve ser PDF, JPG ou PNG.");
  });

  it("FOTO da ART é reduzida antes de enviar (cabe no pedido e no documento) e vai como JPG; o que é salvo é a foto reduzida", async () => {
    respostas[`PUT ${URL_P}`] = { status: 200, corpo: { ...plano({ status: "RASCUNHO" }), artArquivoNome: "ART assinada.jpg" } };
    await abrirEditor({ inicial: plano({ status: "RASCUNHO" }) }); // rascunho: salva sem as exigências da publicação
    const foto = arquivo("ART assinada.png", "image/png", 6 * 1024 * 1024); // foto de celular, 6 MB
    await escolher(foto);
    expect(reducao.fn).toHaveBeenCalledWith(foto, 2200, 0.85);
    expect(texto($("[data-art-arquivo]"))).toBe("ART assinada.jpga salvar");
    await clicar(botao("Salvar"));
    expect(pedidos.find((p) => p.metodo === "PUT")!.corpo).toMatchObject({ artArquivo: "data:image/jpeg;base64,UkVEVVpJREE=", artArquivoNome: "ART assinada.jpg" });
    // foto que, mesmo reduzida, passa do limite
    reducao.fn = vi.fn(async () => ({ imagem: { dataUrl: "data:image/jpeg;base64,AAAA", bytes: 3 * 1024 * 1024 + 1 } }));
    await abrirEditor();
    await escolher(arquivo("enorme.jpg", "image/jpeg", 9 * 1024 * 1024));
    expect(texto($("[data-msg='erro']"))).toBe("Arquivo da ART acima de 3 MB.");
    expect($("[data-art-arquivo]")).toBeNull();
  });

  it("plano NOVO nasce com o texto técnico padrão DA EMPRESA (ou o do sistema, se ela não tiver o seu); 'Restaurar' volta para ele", async () => {
    const campo = () => ($("textarea[aria-label='Descrição']") as HTMLTextAreaElement).value;
    await abrirEditor({ inicial: undefined });
    expect(campo()).toBe(DESCRICAO_PADRAO_PMOC);
    await abrirEditor({ inicial: undefined, config: { diasAviso: 30, textoPadrao: "Texto técnico da Clima Total." } });
    expect(campo()).toBe("Texto técnico da Clima Total.");
    expect($("[data-restaurar-descricao]")).toBeNull();
    await digitar("textarea[aria-label='Descrição']", "Texto mexido.");
    await clicar($("[data-restaurar-descricao]"));
    expect(campo()).toBe("Texto técnico da Clima Total.");
    // plano que já existe mantém o texto dele
    await abrirEditor({ config: { diasAviso: 30, textoPadrao: "Texto técnico da Clima Total." } });
    expect(campo()).toBe("Texto");
  });
});

describe("PMOC › Configurações (na lista)", () => {
  async function abrirConfig() {
    const { PmocConfigBotao } = await import("@/components/pmoc/pmoc-config-botao");
    await montar(createElement(PmocConfigBotao));
    await clicar($("[data-config-pmoc]"));
  }
  const dias = () => ($("input[aria-label='Dias de antecedência do aviso']") as HTMLInputElement).value;
  const txt = () => ($("textarea[aria-label='Texto técnico padrão']") as HTMLTextAreaElement).value;

  it("abre com o que está gravado; sem texto próprio, mostra o do sistema (pronto para ajustar)", async () => {
    respostas["GET /api/pmocs/configuracao"] = { status: 200, corpo: { diasAviso: 30, textoPadrao: null, textoDoSistema: "Texto do sistema." } };
    await abrirConfig();
    expect(texto($("[role=dialog] h3"))).toBe("Configurações do PMOC");
    expect([dias(), txt()]).toEqual(["30", "Texto do sistema."]);
    expect($("[data-restaurar-texto]")).toBeNull();
    respostas["GET /api/pmocs/configuracao"] = { status: 200, corpo: { diasAviso: 45, textoPadrao: "Texto da empresa.", textoDoSistema: "Texto do sistema." } };
    await abrirConfig();
    expect([dias(), txt()]).toEqual(["45", "Texto da empresa."]);
    await clicar($("[data-restaurar-texto]"));
    expect(txt()).toBe("Texto do sistema.");
  });

  it("salvar manda a antecedência e o texto; o erro do servidor aparece no diálogo; salvo, avisa e relê a lista", async () => {
    respostas["GET /api/pmocs/configuracao"] = { status: 200, corpo: { diasAviso: 30, textoPadrao: null, textoDoSistema: "Texto do sistema." } };
    respostas["PUT /api/pmocs/configuracao"] = { status: 400, corpo: { erro: "A antecedência vai de 1 a 365 dias." } };
    await abrirConfig();
    await digitar("input[aria-label='Dias de antecedência do aviso']", "400");
    await clicar($("[data-salvar-config]"));
    expect(texto($("[data-erro-config]"))).toBe("A antecedência vai de 1 a 365 dias.");
    expect(toast).not.toHaveBeenCalled();
    respostas["PUT /api/pmocs/configuracao"] = { status: 200, corpo: { diasAviso: 45, textoPadrao: "Novo texto." } };
    await digitar("input[aria-label='Dias de antecedência do aviso']", "45");
    await digitar("textarea[aria-label='Texto técnico padrão']", "Novo texto.");
    await clicar($("[data-salvar-config]"));
    expect(pedidos.filter((p) => p.metodo === "PUT").at(-1)).toEqual({ url: "/api/pmocs/configuracao", metodo: "PUT", corpo: { diasAviso: 45, textoPadrao: "Novo texto." } });
    expect(toast).toHaveBeenCalledWith("Configurações do PMOC salvas.");
    expect(navegacao.refresh).toHaveBeenCalled();
    expect($("[data-form-config-pmoc]")).toBeNull();
    // campo de dias vazio não vira 0 escondido: vai inválido e o servidor recusa
    await clicar($("[data-config-pmoc]"));
    await digitar("input[aria-label='Dias de antecedência do aviso']", "");
    await clicar($("[data-salvar-config]"));
    expect(pedidos.filter((p) => p.metodo === "PUT").at(-1)!.corpo.diasAviso).toBeNull(); // NaN em JSON
  });
});

describe("Dashboard › bloco PMOC", () => {
  it("vigentes, vencendo (na antecedência da empresa) e expirados, com os planos em aviso e o link de cada um", async () => {
    const { BlocoPmoc } = await import("@/components/dashboard/blocos");
    await montar(createElement(BlocoPmoc, { d: { vigentes: 7, diasAviso: 45, vencendo: 2, expirados: 1, avisos: [
      { id: "p9", nome: "PMOC do anexo", cliente: "Hospital Santa Clara", tipo: "EXPIRADO", texto: "Expirou há 3 dias (09/11/2026)" },
      { id: "p1", nome: "PMOC 2026 — Hospital", cliente: "Hospital Santa Clara", tipo: "VENCENDO", texto: "Expira em 12 dias (24/11/2026)" },
    ] } }));
    expect(texto()).toContain("Vigentes7");
    expect(texto()).toContain("Vencendo2em até 45 dias");
    expect(texto()).toContain("Expirados1");
    expect($$("[data-avisos-pmoc] a").map((a) => [a.getAttribute("href"), texto(a)])).toEqual([
      ["/pmoc/p9", "PMOC do anexoHospital Santa Clara · Expirou há 3 dias (09/11/2026)"],
      ["/pmoc/p1", "PMOC 2026 — HospitalHospital Santa Clara · Expira em 12 dias (24/11/2026)"],
    ]);
    expect($$("a").map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining(["/pmoc", "/pmoc?status=VIGENTE", "/pmoc?status=VENCENDO", "/pmoc?status=EXPIRADO"]));
    await montar(createElement(BlocoPmoc, { d: { vigentes: 3, diasAviso: 30, vencendo: 0, expirados: 0, avisos: [] } }));
    expect($("[data-avisos-pmoc]")).toBeNull();
  });

  it("o bloco só existe para quem vê o PMOC", async () => {
    const { blocosPermitidos } = await import("@/lib/dashboard/blocos");
    const ids = (p: Permissoes) => blocosPermitidos(p, "OPERADOR").map((b) => b.id);
    expect(ids(SO_VER)).toEqual(["pmoc"]);
    expect(ids(montarPermissoes({ ordens: ["visualizar"], equipamentos: ["visualizar"] }))).not.toContain("pmoc");
    expect(ids(permissoesTotais())).toContain("pmoc");
  });
});
