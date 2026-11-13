// @vitest-environment happy-dom
/**
 * AVALIAÇÃO DO CLIENTE no aceite, nas telas, num DOM de verdade (as regras estão em os-aceite e o
 * servidor em os-aceite-pg):
 *  - as estrelas: escolher, trocar, tirar a nota; o comentário só aparece para quem deu nota;
 *  - link público/portal: a avaliação vai junto na confirmação e na confirmação com ressalva — e nunca
 *    é obrigatória; só aparece quando a empresa pede;
 *  - quadro de assinatura (app do técnico e escritório): a mesma avaliação, no local;
 *  - a nota na OS (estrelas + comentário), para quem vê a OS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const navegacao = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const tecnico = vi.hoisted(() => ({ valor: { config: { exibirDadosCliente: true }, estado: { situacao: "online" } } as any }));
vi.mock("next-auth/react", () => ({ signOut: () => {}, useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: navegacao.refresh, push: navegacao.push, replace: vi.fn() }), usePathname: () => "/x", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/tecnico/contexto", () => ({ useTecnico: () => tecnico.valor }));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<Record<string, unknown>>()), toast: () => {} }));
const ASSINATURA = `data:image/png;base64,${"QUJD".repeat(60)}`;
vi.mock("react-signature-canvas", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef((p: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({ isEmpty: () => false, clear: () => {}, getCanvas: () => ({ toDataURL: () => ASSINATURA }) }));
      return React.createElement("canvas", { ...p.canvasProps });
    }),
  };
});

let root: Root; let caixa: HTMLDivElement;
let pedidos: { url: string; metodo: string; corpo: any }[];
let respostas: Record<string, { status: number; corpo: unknown }>;

beforeEach(() => {
  navegacao.push.mockClear(); navegacao.refresh.mockClear();
  pedidos = []; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const u = String(entrada); const metodo = init?.method ?? "GET";
    pedidos.push({ url: u, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas[`${metodo} ${u}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "content-type": "application/json" } });
  }));
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
const estrela = (n: number) => $(`[data-avaliacao-cliente] [data-estrela='${n}']`);
const marcadas = () => $$("[data-avaliacao-cliente] [role='radio']").map((b) => b.getAttribute("aria-checked")).join(",");
const cheias = (raiz: string) => $$(`${raiz} svg`).filter((s) => (s.getAttribute("class") ?? "").includes("fill-atencao")).length;
const COMENTARIO = "textarea[aria-label='Comentário da avaliação']";

/* ───────── as estrelas ───────── */
describe("Avaliação do serviço: as estrelas", () => {
  async function abrir(inicial: number | null = null) {
    const { AvaliacaoDoCliente } = await import("@/components/os/avaliacao-cliente");
    const { useState } = await import("react");
    const Caixa = () => { const [n, setN] = useState<number | null>(inicial); const [c, setC] = useState(""); return createElement(AvaliacaoDoCliente, { nota: n, comentario: c, aoMudarNota: setN, aoMudarComentario: setC }); };
    await montar(createElement(Caixa));
  }

  it("começa SEM nota, diz que é opcional e oferece cinco estrelas com nome (leitor de tela) — o comentário ainda não aparece", async () => {
    await abrir();
    expect(texto($("[data-avaliacao-cliente] legend"))).toBe("Como foi o serviço? (opcional)");
    expect($("[role='radiogroup']")?.getAttribute("aria-label")).toBe("Avaliação do serviço");
    expect($$("[data-avaliacao-cliente] [role='radio']").map((b) => b.getAttribute("aria-label"))).toEqual(["1 estrela", "2 estrelas", "3 estrelas", "4 estrelas", "5 estrelas"]);
    expect(marcadas()).toBe("false,false,false,false,false");
    expect(texto($("[data-avaliacao-rotulo]"))).toBe("Toque nas estrelas para avaliar");
    expect(cheias("[data-avaliacao-cliente]")).toBe(0);
    expect($(COMENTARIO)).toBeNull();
    expect($("[data-avaliacao-cliente]")?.getAttribute("data-avaliacao-cliente")).toBe("");
  });

  it("tocar numa estrela dá a nota (as anteriores acendem junto), mostra a nota por extenso e abre o comentário opcional", async () => {
    await abrir();
    await clicar(estrela(4));
    expect(marcadas()).toBe("false,false,false,true,false");
    expect(cheias("[data-avaliacao-cliente]")).toBe(4);
    expect(texto($("[data-avaliacao-rotulo]"))).toBe("4 de 5 estrelas · Bom");
    expect($("[data-avaliacao-cliente]")?.getAttribute("data-avaliacao-cliente")).toBe("4");
    expect($(COMENTARIO)).toBeTruthy();
    expect(texto($("[data-avaliacao-cliente] label"))).toBe("Comentário (opcional)");
    await clicar(estrela(1));
    expect([marcadas(), cheias("[data-avaliacao-cliente]"), texto($("[data-avaliacao-rotulo]"))]).toEqual(["true,false,false,false,false", 1, "1 de 5 estrelas · Péssimo"]);
    await clicar(estrela(5));
    expect([cheias("[data-avaliacao-cliente]"), texto($("[data-avaliacao-rotulo]"))]).toEqual([5, "5 de 5 estrelas · Excelente"]);
  });

  it("tocar de novo na MESMA estrela tira a nota (a avaliação é opcional até o fim) — e o comentário some com ela", async () => {
    await abrir(3);
    expect([marcadas(), texto($("[data-avaliacao-rotulo]"))]).toEqual(["false,false,true,false,false", "3 de 5 estrelas · Regular"]);
    await clicar(estrela(3));
    expect(marcadas()).toBe("false,false,false,false,false");
    expect(cheias("[data-avaliacao-cliente]")).toBe(0);
    expect($(COMENTARIO)).toBeNull();
    expect(texto($("[data-avaliacao-rotulo]"))).toBe("Toque nas estrelas para avaliar");
  });

  it("a nota exibida (só leitura): estrelas cheias até a nota, com a nota por extenso para o leitor de tela e o PDF", async () => {
    const { Estrelas } = await import("@/components/os/estrelas");
    for (const nota of [1, 4, 5]) {
      await montar(createElement(Estrelas, { nota }));
      expect([$("[data-estrelas]")?.getAttribute("data-estrelas"), $("[data-estrelas]")?.getAttribute("aria-label"), cheias("[data-estrelas]"), $$("[data-estrelas] svg").length, texto($("[data-estrelas]"))])
        .toEqual([String(nota), `${nota} de 5 estrelas`, nota, 5, `${nota} de 5 estrelas`]);
    }
  });
});

/* ───────── link público / portal ───────── */
describe("Avaliação no link público (e no portal)", () => {
  async function abrir(pedirAvaliacao: boolean | "sem informar" = true, nomeSugerido: string | null = "Roberto Almeida") {
    const { AceitePublico } = await import("@/components/os/aceite-publico");
    await montar(createElement(AceitePublico, { token: "tok123", rotulo: "OS-123, concluída em 05/11/2026", nomeSugerido, ...(pedirAvaliacao === "sem informar" ? {} : { pedirAvaliacao }) }));
  }
  const corpo = () => pedidos.at(-1)!.corpo;

  it("NÃO trava a confirmação: sem tocar nas estrelas, confirma do mesmo jeito (a nota vai vazia)", async () => {
    await abrir();
    expect($("[data-avaliacao-cliente]")).toBeTruthy();
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(corpo()).toEqual({ nome: "Roberto Almeida", ressalva: null, avaliacao: null, avaliacaoComentario: null });
    expect($("[data-erro-aceite-publico]")).toBeNull();
    expect(navegacao.refresh).toHaveBeenCalledTimes(1);
  });

  it("CONFIRMAR com avaliação: a nota e o comentário (sem espaço sobrando) vão junto, separados da ressalva", async () => {
    await abrir();
    await clicar(estrela(5));
    await digitar(COMENTARIO, "  Equipe pontual e cuidadosa  ");
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(corpo()).toEqual({ nome: "Roberto Almeida", ressalva: null, avaliacao: 5, avaliacaoComentario: "Equipe pontual e cuidadosa" });
    // Só a nota, sem comentário
    await abrir();
    await clicar(estrela(3));
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(corpo()).toEqual({ nome: "Roberto Almeida", ressalva: null, avaliacao: 3, avaliacaoComentario: null });
  });

  it("CONFIRMAR COM RESSALVA também leva a avaliação — ressalva e comentário da avaliação são campos diferentes", async () => {
    await abrir();
    await clicar($("[data-tenho-ressalva]"));
    expect($("[data-avaliacao-cliente]")).toBeTruthy(); // as estrelas continuam lá no caminho da ressalva
    await digitar("textarea[aria-label='Ressalva']", "O split da recepção continua pingando");
    await clicar(estrela(2));
    await digitar(COMENTARIO, "Demorou para chegar");
    await clicar($("[data-confirmar-com-ressalva]"));
    expect(corpo()).toEqual({ nome: "Roberto Almeida", ressalva: "O split da recepção continua pingando", avaliacao: 2, avaliacaoComentario: "Demorou para chegar" });
    // E com ressalva sem avaliar: também passa
    await abrir();
    await clicar($("[data-tenho-ressalva]"));
    await digitar("textarea[aria-label='Ressalva']", "Faltou a tampa do dreno");
    await clicar($("[data-confirmar-com-ressalva]"));
    expect(corpo()).toEqual({ nome: "Roberto Almeida", ressalva: "Faltou a tampa do dreno", avaliacao: null, avaliacaoComentario: null });
  });

  it("quem tirou a nota depois de comentar confirma SEM avaliação: o comentário escrito não vai solto", async () => {
    await abrir();
    await clicar(estrela(4));
    await digitar(COMENTARIO, "Ia elogiar, mudei de ideia");
    await clicar(estrela(4)); // toca de novo: tira a nota
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(corpo()).toEqual({ nome: "Roberto Almeida", ressalva: null, avaliacao: null, avaliacaoComentario: null });
  });

  it("empresa que NÃO pede avaliação: as estrelas não aparecem e o pedido não fala em avaliação", async () => {
    await abrir(false);
    expect($("[data-avaliacao-cliente]")).toBeNull();
    expect($("[role='radiogroup']")).toBeNull();
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(corpo()).toEqual({ nome: "Roberto Almeida", ressalva: null });
    await abrir("sem informar"); // quem não informa nada também não pede
    expect($("[data-avaliacao-cliente]")).toBeNull();
  });

  it("a avaliação não dispensa o nome: sem nome, nada é enviado (e a nota escolhida continua na tela)", async () => {
    await abrir(true, null);
    await clicar(estrela(5));
    await clicar($("[data-confirmar-aceite-publico]"));
    expect(texto($("[data-erro-aceite-publico]"))).toBe("Informe o nome completo de quem confirma.");
    expect(pedidos).toEqual([]);
    expect(marcadas()).toBe("false,false,false,false,true");
  });
});

/* ───────── no local: o quadro de assinatura ───────── */
describe("Avaliação no local (quadro de assinatura)", () => {
  const confirmados: unknown[] = [];
  async function abrir(pedirAvaliacao?: boolean) {
    confirmados.length = 0;
    const { AssinaturaDoCliente } = await import("@/components/os/aceite-assinatura");
    await montar(createElement(AssinaturaDoCliente, { resumo: "OS-123 · Hospital Santa Clara", aoConfirmar: async (d: unknown) => { confirmados.push(d); return null; }, aoCancelar: () => {}, ...(pedirAvaliacao === undefined ? {} : { pedirAvaliacao }) }));
  }
  const NOME = "input[aria-label='Nome de quem recebeu o serviço']";

  it("com a opção da empresa: o cliente assina e, se quiser, dá a nota ali mesmo — sem nota a assinatura vale igual", async () => {
    await abrir(true);
    expect($("[data-avaliacao-cliente]")).toBeTruthy();
    await digitar(NOME, "João Pereira da Silva");
    await clicar($("[data-confirmar-aceite]"));
    expect(confirmados).toEqual([{ nome: "João Pereira da Silva", assinatura: ASSINATURA, avaliacao: null, avaliacaoComentario: null }]);
    await clicar(estrela(4));
    await digitar(COMENTARIO, "  Muito atencioso ");
    await clicar($("[data-confirmar-aceite]"));
    expect(confirmados.at(-1)).toEqual({ nome: "João Pereira da Silva", assinatura: ASSINATURA, avaliacao: 4, avaliacaoComentario: "Muito atencioso" });
    expect($("[data-erro-aceite]")).toBeNull();
  });

  it("sem a opção (ou sem a informação, como num aparelho com dados antigos): só nome e assinatura, sem estrelas", async () => {
    await abrir(false);
    expect($("[data-avaliacao-cliente]")).toBeNull();
    await digitar(NOME, "João Pereira da Silva");
    await clicar($("[data-confirmar-aceite]"));
    expect(confirmados).toEqual([{ nome: "João Pereira da Silva", assinatura: ASSINATURA, avaliacao: null, avaliacaoComentario: null }]);
    await abrir(undefined);
    expect($("[data-avaliacao-cliente]")).toBeNull();
  });

  it("APP DO TÉCNICO: o retrato diz se a empresa pede — a nota entra na MESMA operação 'aceite' da fila (vale sem sinal)", async () => {
    const ops: any[] = [];
    const abrirApp = async (aceite: Record<string, unknown>) => {
      ops.length = 0;
      const { AceiteNaOs } = await import("@/components/tecnico/aceite-cliente");
      const r = { cartao: { cliente: "Hospital Santa Clara", osNumero: "OS-123" }, aceite: { situacao: "PENDENTE", nome: null, confirmadoEm: null, osConcluida: true, ultimaDaOs: true, ...aceite } } as any;
      const x = { atividade: { id: "a1", titulo: "Manutenção Preventiva", status: "CONCLUIDA" }, os: { id: "os1", numero: "OS-123" } } as any;
      await montar(createElement(AceiteNaOs, { r, x, aEnviar: 0, registrar: async (o: unknown[]) => { ops.push(...o); } }));
      await clicar($("[data-aceite-assinar]"));
    };
    await abrirApp({ pedirAvaliacao: true });
    expect($("[data-avaliacao-cliente]")).toBeTruthy();
    await digitar(NOME, "João Pereira da Silva");
    await clicar(estrela(5));
    await clicar($("[data-confirmar-aceite]"));
    expect(ops).toEqual([{ tipo: "aceite", atividadeId: "a1", dados: { nome: "João Pereira da Silva", assinatura: ASSINATURA, avaliacao: 5, avaliacaoComentario: null } }]);
    expect(pedidos).toEqual([]); // nada vai direto ao servidor: é a fila que leva
    await abrirApp({ pedirAvaliacao: false });
    expect($("[data-avaliacao-cliente]")).toBeNull();
    await abrirApp({}); // retrato guardado antes da atualização: não sabe da opção — não pede
    expect($("[data-avaliacao-cliente]")).toBeNull();
  });
});

/* ───────── a nota na OS ───────── */
describe("Avaliação na OS (escritório)", () => {
  const G = "GET /api/ordens/os1/aceite";
  const aceite = (extra: Record<string, unknown> = {}) => ({
    token: "tok123", situacao: "CONFIRMADO", metodo: "REMOTO", nome: "Roberto Almeida", ressalva: null, avaliacao: null, avaliacaoComentario: null, ip: "200.150.10.5",
    confirmadoEm: "2026-11-12T15:00:00.000Z", vistoEm: "2026-11-12T16:00:00.000Z", colhidoPor: null, assinatura: null, enviadoEm: null, enviadoCanal: null, enviadoPara: null, envios: 0, ...extra,
  });
  async function abrir(corpo: Record<string, unknown>, permissoes: Permissoes = permissoesTotais()) {
    respostas[G] = { status: 200, corpo };
    const [{ OsAceite }, { PermissoesProvider }] = await Promise.all([import("@/components/os/os-aceite"), import("@/components/providers/permissoes-provider")]);
    await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(OsAceite, { osId: "os1", numero: "OS-123", cliente: "Hospital Santa Clara", statusOs: "CONCLUIDA" }) }));
  }
  const confirmada = (extra: Record<string, unknown> = {}) => ({ estado: "CONFIRMADO", statusOs: "CONCLUIDA", caminhoPublico: "/relatorio/aceite/tok123", pedirAvaliacao: true, aceite: aceite(extra) });
  const soVer = montarPermissoes({ ordens: ["visualizar"] });

  it("a nota do cliente aparece no cartão do aceite: estrelas, a nota por extenso e o comentário — também para quem só visualiza", async () => {
    await abrir(confirmada({ avaliacao: 4, avaliacaoComentario: "Equipe pontual e cuidadosa" }), soVer);
    expect($("[data-aceite-avaliacao]")?.getAttribute("data-aceite-avaliacao")).toBe("4");
    expect(texto($("[data-aceite-avaliacao] p"))).toBe("Avaliação do cliente: 4 de 5 estrelas");
    expect([cheias("[data-aceite-avaliacao]"), $("[data-aceite-avaliacao] [data-estrelas]")?.getAttribute("aria-label")]).toEqual([4, "4 de 5 estrelas"]);
    expect(texto($("[data-aceite-avaliacao-comentario]"))).toBe("Equipe pontual e cuidadosa");
    expect(texto($("[data-aceite-titulo]"))).toBe("Confirmada pelo cliente"); // nota baixa ou alta não muda o estado do aceite
  });

  it("sem nota, nada de avaliação no cartão; com ressalva E nota, as duas aparecem, cada uma no seu lugar", async () => {
    await abrir(confirmada());
    expect($("[data-aceite-avaliacao]")).toBeNull();
    await abrir(confirmada({ avaliacao: 5 }));
    expect([$("[data-aceite-avaliacao]")?.getAttribute("data-aceite-avaliacao"), $("[data-aceite-avaliacao-comentario]")]).toEqual(["5", null]);
    await abrir(confirmada({ ressalva: "O split da recepção continua pingando", avaliacao: 2, avaliacaoComentario: "Demorou para chegar" }));
    expect(texto($("[data-aceite-ressalva]"))).toBe("Ressalva do cliente: O split da recepção continua pingando");
    expect(texto($("[data-aceite-avaliacao] p"))).toBe("Avaliação do cliente: 2 de 5 estrelas");
    expect(texto($("[data-aceite-avaliacao-comentario]"))).toBe("Demorou para chegar");
    expect(texto($("[data-aceite-titulo]"))).toBe("Confirmada pelo cliente, com ressalva");
  });

  it("COLHER ASSINATURA no escritório: o quadro pede a avaliação quando a empresa pede — e manda a nota junto", async () => {
    const aguardando = (pedirAvaliacao: boolean) => ({ estado: "AGUARDANDO", statusOs: "CONCLUIDA", caminhoPublico: "/relatorio/aceite/tok123", pedirAvaliacao, aceite: aceite({ situacao: "PENDENTE", metodo: null, nome: null, ip: null, confirmadoEm: null, vistoEm: null }) });
    await abrir(aguardando(true));
    await clicar($("[data-colher-aceite]"));
    expect($("[data-avaliacao-cliente]")).toBeTruthy();
    await digitar("input[aria-label='Nome de quem recebeu o serviço']", "Marta Nunes");
    await clicar(estrela(3));
    await clicar($("[data-confirmar-aceite]"));
    expect(pedidos.find((p) => p.metodo === "POST")).toEqual({ url: "/api/ordens/os1/aceite", metodo: "POST", corpo: { nome: "Marta Nunes", assinatura: ASSINATURA, avaliacao: 3, avaliacaoComentario: null } });
    await abrir(aguardando(false));
    await clicar($("[data-colher-aceite]"));
    expect($("[data-assinatura-cliente]")).toBeTruthy();
    expect($("[data-avaliacao-cliente]")).toBeNull();
  });
});
