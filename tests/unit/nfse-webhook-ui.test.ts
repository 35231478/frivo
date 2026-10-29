// @vitest-environment happy-dom
/**
 * NFS-e PR3 (B) — telas num DOM de verdade (API simulada):
 *  - Dados fiscais › "Aviso automático do PlugNotas": desligado (sem emitente: botão travado e a
 *    explicação); ligar mostra a URL UMA vez com Copiar; cadastrado no PlugNotas; pendente com o
 *    motivo; girar pede confirmação (cancelar não chama nada); erro da API; ambiente mudou;
 *  - sino: NFS-e não aceitas / aguardando a prefeitura / autorizadas só com Fiscal e só quando há,
 *    com o link da medição (ou a lista de medições).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";
import type { EmitenteTela } from "@/lib/nfse/emitente-server";
import type { SituacaoWebhook } from "@/lib/nfse/webhook-server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/financeiro/fiscal" }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
const avisos = vi.hoisted(() => ({ toasts: [] as [string, string][], confirmar: true, perguntas: [] as any[] }));
vi.mock("@/components/ui/avisos", () => ({
  toast: (m: string, t = "sucesso") => { avisos.toasts.push([m, t]); },
  confirmar: async (o: any) => { avisos.perguntas.push(o); return avisos.confirmar; },
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string }[] = [];
const area = { escrito: [] as string[], falha: false };

beforeAll(async () => {
  await Promise.all([import("@/components/fiscal/dados-fiscais-client"), import("@/components/layout/header")]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0; avisos.toasts = []; avisos.confirmar = true; avisos.perguntas = []; respostas = {};
  area.escrito = []; area.falha = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (t: string) => { if (area.falha) throw new Error("negado"); area.escrito.push(t); } },
  });
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function montar(el: any) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}

const DESLIGADO: SituacaoWebhook = { ativo: false, podeGerar: true, geradoEm: null, ambiente: null, registradoEm: null, erro: null, recebidoEm: null, desatualizado: false };
const LIGADO: SituacaoWebhook = { ...DESLIGADO, ativo: true, geradoEm: "2026-10-29T13:00:00.000Z", ambiente: "HOMOLOGACAO", registradoEm: "2026-10-29T13:00:02.000Z", recebidoEm: "2026-10-29T14:10:00.000Z" };
const TELA: EmitenteTela = {
  dados: { regimeTributario: "SIMPLES_NACIONAL", regimeEspecial: null, incentivoFiscal: false, incentivadorCultural: false, ambiente: "HOMOLOGACAO", codigoMunicipio: "3550308", municipioNome: "São Paulo", municipioUf: "SP", inscricaoMunicipal: "12345678" },
  empresa: { cnpj: "12345678000190", nome: "Clima Total", endereco: "Rua das Flores, 100", cidade: "São Paulo", estado: "SP", cep: "01001-000" },
  status: "ATIVO", statusLabel: "Emitente ativo no PlugNotas",
  emitente: { cnpj: "12345678000190", ambiente: "HOMOLOGACAO", sincronizadoEm: "2026-10-28T13:00:00.000Z" },
  certificado: null, ultimoErro: null, ultimoTeste: null, pendencias: [], prefeitura: null,
  webhook: DESLIGADO, ambientesDisponiveis: { HOMOLOGACAO: true, PRODUCAO: false },
};
const URL_NOVA = `https://app.frivo.com.br/api/webhooks/plugnotas?token=${"e".repeat(64)}`;
async function tela(webhook: SituacaoWebhook) {
  const { DadosFiscaisClient } = await import("@/components/fiscal/dados-fiscais-client");
  await montar(createElement(DadosFiscaisClient, { inicial: { ...TELA, webhook } }));
}
const botao = () => $<HTMLButtonElement>("[data-gerar-webhook]")!;
const situacao = () => $("[data-situacao-webhook]")!.getAttribute("data-situacao-webhook");

describe("Dados fiscais › Aviso automático do PlugNotas", () => {
  it("sem o emitente no PlugNotas: desligado, botão travado e diz o que fazer", async () => {
    await tela({ ...DESLIGADO, podeGerar: false });
    expect([situacao(), txt($("[data-situacao-webhook]"))]).toEqual(["desligado", "Desligado"]);
    expect(botao().disabled).toBe(true);
    expect(txt(botao())).toBe("Ligar aviso automático");
    expect(txt($("[data-webhook-sem-emitente]"))).toBe("Salve os dados fiscais abaixo (cadastro da empresa no PlugNotas) para ligar o aviso.");
    expect($("[data-webhook-gerado]")).toBeNull();
    expect(txt($("[data-aviso-plugnotas]"))).toContain("o PlugNotas avisa o Frivo na hora");
  });

  it("ligar: POST sem confirmação; a URL aparece UMA vez com Copiar; cadastrado lá = ligado + toast", async () => {
    respostas["POST /api/fiscal/webhook"] = { status: 200, corpo: { url: URL_NOVA, registrado: true, erro: null, webhook: { ...LIGADO, recebidoEm: null } } };
    await tela(DESLIGADO);
    expect($("[data-webhook-sem-emitente]")).toBeNull();
    await clicar(botao());
    expect(avisos.perguntas).toEqual([]);
    expect(chamadas).toEqual([{ url: "/api/fiscal/webhook", metodo: "POST" }]);
    expect(txt($("[data-webhook-url] code"))).toBe(URL_NOVA);
    expect(txt($("[data-webhook-url]"))).toContain("só aparece agora. Gerar outra invalida esta.");
    expect(situacao()).toBe("ligado");
    expect(txt($("[data-webhook-recebido]"))).toBe("Nenhum ainda");
    expect(txt($("[data-webhook-gerado]"))).toContain("Homologação (testes)");
    expect($("[data-webhook-registrado]")).toBeNull(); // com a URL na tela, a frase "não é mostrada de novo" fica para depois
    expect(avisos.toasts).toEqual([["Aviso automático ligado no PlugNotas.", "sucesso"]]);
    expect(txt(botao())).toBe("Gerar nova URL");
    await clicar($("[data-copiar-webhook]"));
    expect(area.escrito).toEqual([URL_NOVA]);
    expect(avisos.toasts.at(-1)).toEqual(["URL copiada.", "sucesso"]);
    area.falha = true;
    await clicar($("[data-copiar-webhook]"));
    expect(avisos.toasts.at(-1)).toEqual(["Não foi possível copiar. Selecione e copie a URL.", "erro"]);
  });

  it("ligado (depois): mostra quando foi cadastrado e o último aviso, sem a URL", async () => {
    await tela(LIGADO);
    expect(situacao()).toBe("ligado");
    expect($("[data-webhook-url]")).toBeNull();
    expect(txt($("[data-webhook-registrado]"))).toMatch(/^Cadastrado no PlugNotas em \d\d\/\d\d\/2026.*Por segurança, a URL não é mostrada de novo\.$/);
    expect(txt($("[data-webhook-recebido]"))).toMatch(/^29\/10\/2026/);
  });

  it("PlugNotas recusou o cadastro: pendente, com o motivo e o que fazer; a URL aparece para colar lá", async () => {
    const pendente = { ...LIGADO, registradoEm: null, recebidoEm: null, erro: "URL não aceita: •••" };
    respostas["POST /api/fiscal/webhook"] = { status: 200, corpo: { url: URL_NOVA, registrado: false, erro: pendente.erro, webhook: pendente } };
    await tela(DESLIGADO);
    await clicar(botao());
    expect([situacao(), txt($("[data-situacao-webhook]"))]).toEqual(["pendente", "Cadastro pendente no PlugNotas"]);
    expect(txt($("[data-webhook-erro]"))).toBe("O PlugNotas não aceitou o cadastro automático: URL não aceita: ••• A URL vale do nosso lado: cole-a no painel do PlugNotas (Webhook da empresa) ou tente gerar de novo.");
    expect(txt($("[data-webhook-url] code"))).toBe(URL_NOVA);
    expect(avisos.toasts).toEqual([]);
  });

  it("girar pede confirmação: cancelar não chama nada; confirmar gera a nova", async () => {
    respostas["POST /api/fiscal/webhook"] = { status: 200, corpo: { url: URL_NOVA, registrado: true, erro: null, webhook: LIGADO } };
    await tela(LIGADO);
    avisos.confirmar = false;
    await clicar(botao());
    expect(avisos.perguntas[0]).toMatchObject({ titulo: "Gerar nova URL?", confirmarTexto: "Gerar nova URL" });
    expect(avisos.perguntas[0].mensagem).toContain("A URL atual para de valer na hora.");
    expect(chamadas).toEqual([]);
    avisos.confirmar = true;
    await clicar(botao());
    expect(chamadas).toEqual([{ url: "/api/fiscal/webhook", metodo: "POST" }]);
    expect(txt($("[data-webhook-url] code"))).toBe(URL_NOVA);
  });

  it("erro da API (ex.: sem permissão / emitente sumiu) e sem conexão: aviso na tela, nada muda", async () => {
    respostas["POST /api/fiscal/webhook"] = { status: 409, corpo: { erro: "Cadastre a empresa no PlugNotas (salve os Dados fiscais) antes de ligar o aviso automático." } };
    await tela(DESLIGADO);
    await clicar(botao());
    expect(txt($("[data-webhook-falha]"))).toBe("Cadastre a empresa no PlugNotas (salve os Dados fiscais) antes de ligar o aviso automático.");
    expect($("[data-webhook-falha]")!.getAttribute("role")).toBe("alert");
    expect([situacao(), $("[data-webhook-url]")]).toEqual(["desligado", null]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("rede"); }));
    await clicar(botao());
    expect(txt($("[data-webhook-falha]"))).toBe("Sem conexão. Tente de novo.");
    expect(botao().disabled).toBe(false);
  });

  it("o emitente mudou de ambiente depois da URL: pede para gerar de novo", async () => {
    await tela({ ...LIGADO, desatualizado: true });
    expect([situacao(), txt($("[data-situacao-webhook]"))]).toEqual(["desatualizado", "Gere de novo (ambiente mudou)"]);
  });
});

describe("sino: NFS-e", () => {
  const ALERTAS = { prazosVencidos: 0, etapasVencendoHoje: 0, pedidosPendentes: 0, atendimentosAtraso: 0, chamadosPortal: 0, checklistPendente: 0, checklistsComAlertas: 0, documentosVencendo: 0, veiculosManutencao: 0, boletosPagos: 0, orcamentosRespondidos: 0, nfPedidos: 0, nfPedidoId: null };
  async function sino(alertas: Record<string, unknown>, permissoes: Permissoes) {
    respostas["GET /api/alertas"] = { status: 200, corpo: { ...ALERTAS, ...alertas } };
    const { Header } = await import("@/components/layout/header");
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    const sessao = { user: { id: "u1", name: "Ana", email: "a@x.com", empresaId: "e1", role: "OPERADOR", permissoes }, expires: "2099-01-01T00:00:00Z" };
    await montar(createElement(PermissoesProvider, { role: "OPERADOR", permissoes } as any, createElement(Header, { session: sessao, avatarUrl: null } as any)));
    await clicar([...caixa.querySelectorAll("button")].find((b) => b.querySelector("svg.lucide-bell"))!);
  }
  const link = (rotulo: string) => [...caixa.querySelectorAll("a")].find((a) => a.textContent?.includes(rotulo)) ?? null;
  const FISCAL = montarPermissoes({ financeiro: ["visualizar", "medicoes", "fiscal"] });

  it("com Fiscal: os três avisos com a contagem e o link da medição", async () => {
    await sino({ nfseRejeitadas: 2, nfseRejeitadaMedicaoId: "m9", nfseAguardando: 1, nfseAguardandoMedicaoId: "m7", nfseAutorizadas: 3, nfseAutorizadaMedicaoId: "m1", total: 6 }, FISCAL);
    expect([link("NFS-e não aceitas")?.getAttribute("href"), txt(link("NFS-e não aceitas"))]).toEqual(["/financeiro/medicoes/m9", "NFS-e não aceitas2"]);
    expect([link("NFS-e aguardando a prefeitura")?.getAttribute("href"), txt(link("NFS-e aguardando a prefeitura"))]).toEqual(["/financeiro/medicoes/m7", "NFS-e aguardando a prefeitura1"]);
    expect([link("NFS-e autorizadas")?.getAttribute("href"), txt(link("NFS-e autorizadas"))]).toEqual(["/financeiro/medicoes/m1", "NFS-e autorizadas3"]);
  });

  it("zero não aparece; sem a medição, leva à lista de medições", async () => {
    await sino({ nfseRejeitadas: 0, nfseAguardando: 0, nfseAutorizadas: 1, nfseAutorizadaMedicaoId: null, total: 1 }, FISCAL);
    expect(link("NFS-e não aceitas")).toBeNull();
    expect(link("NFS-e aguardando a prefeitura")).toBeNull();
    expect(link("NFS-e autorizadas")?.getAttribute("href")).toBe("/financeiro/medicoes");
  });

  it("sem Fiscal: nunca mostra NFS-e (mesmo que a API mande)", async () => {
    await sino({ nfseRejeitadas: 2, nfseRejeitadaMedicaoId: "m9", nfseAguardando: 1, nfseAutorizadas: 3, total: 6 }, montarPermissoes({ financeiro: ["visualizar", "medicoes"] }));
    expect(txt(caixa)).not.toContain("NFS-e");
  });
});
