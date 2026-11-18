// @vitest-environment happy-dom
/**
 * Pausa de SLA por causa do cliente — PR A, a gaveta da OS num DOM de verdade (happy-dom):
 *  - o campo "De quem foi a causa" é obrigatório, com os três valores e a ajuda de cada um;
 *  - o motivo SUGERE a causa (e só sugere: fica à vista e o gestor pode trocar; motivo ambíguo não
 *    sugere nada e o salvar cobra a escolha);
 *  - o que vai para o servidor é o valor escolhido, junto do motivo e da explicação;
 *  - a OS já justificada mostra motivo · causa, e "Alterar" reabre com o que está gravado;
 *  - o gatilho ampliado: a gaveta aparece no chamado que estourou só o comparecer;
 *  - quem não tem "Desempenho › Revisar" lê, mas não justifica.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";
import { AJUDA_RESPONSABILIDADE_ATRASO, MSG_ATRASO_SEM_RESPONSAVEL } from "@/lib/os/prazo-execucao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams() }));

let root: Root; let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeEach(() => {
  chamadas.length = 0;
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-18T18:00:00Z") });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url: String(url), metodo: String(init.method ?? "GET"), corpo: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ atrasoJustificadoMotivo: "CLIMA", atrasoResponsavel: "TERCEIROS" }), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { if (root) act(() => root.unmount()); caixa?.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const $ = <T extends Element = HTMLElement>(s: string) => document.body.querySelector(s) as T | null;
const $$ = (s: string) => [...document.body.querySelectorAll(s)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const esperar = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 2)); }); };
const clicar = async (el: Element | null) => { expect(el, "elemento a clicar").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function escolher(sel: string, valor: string) {
  const el = $<HTMLSelectElement>(sel);
  expect(el, sel).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, valor);
    el!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}

const GESTOR = montarPermissoes({ ordens: ["visualizar"], desempenho: ["visualizar", "revisar"] });
const SO_VE = montarPermissoes({ ordens: ["visualizar"] });

const br = (data: string, hora = "00:00") => new Date(`${data}T${hora}:00-03:00`).toISOString();
/** OS atrasada no prazo de execução (o caso de sempre) */
const OS = (x: Record<string, unknown> = {}) => ({
  id: "os1", numero: "OS-101", chamadoNumero: null, status: "CONCLUIDA",
  prazoExecucao: "2026-11-10T00:00:00.000Z", previsaoConclusao: null, dataConclusao: br("2026-11-12", "10:00"), atividades: [],
  atrasoJustificadoMotivo: null, atrasoJustificadoObs: null, atrasoResponsavel: null, atrasoJustificadoEm: null, atrasoJustificadoPor: null,
  mesesFechadosDoAtraso: [], ...x,
});
/** Chamado que estourou SÓ o comparecer: antes não dava para justificar */
const SO_COMPARECER = OS({
  id: "os2", numero: "OS-102", chamadoNumero: "CH-77", prazoExecucao: null, dataConclusao: br("2026-11-10", "18:00"),
  chamadoAbertoEm: br("2026-11-10", "08:00"), atendimentoComparecerAte: br("2026-11-10", "12:00"),
  atendimentoResolverAte: br("2026-11-11", "08:00"), atendimentoComparecidoEm: br("2026-11-10", "14:00"),
});

async function abrir(dados: any, permissoes: Permissoes = GESTOR) {
  const [{ AtrasoJustificado }, { PermissoesProvider }, { Avisos }] = await Promise.all([
    import("@/components/os/central/atraso-justificado"), import("@/components/providers/permissoes-provider"), import("@/components/ui/avisos"),
  ]);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: [
      createElement(Avisos, { key: "a" }), createElement(AtrasoJustificado, { key: "t", os: dados, onAtualizado: () => {} }),
    ] } as any));
  });
  await esperar();
}

describe("A gaveta: de quem foi a causa", () => {
  it("o campo é obrigatório, com os três valores na ordem e nada pré-escolhido antes do motivo", async () => {
    await abrir(OS());
    await clicar($("[data-justificar-atraso]"));
    const campo = $<HTMLSelectElement>("[data-responsavel]");
    expect(campo).toBeTruthy();
    expect([...campo!.options].map((o) => o.value)).toEqual(["", "CLIENTE", "INTERNA", "TERCEIROS"]);
    expect([...campo!.options].map((o) => o.text)).toEqual(["Escolha a causa", "Causa do cliente", "Causa interna", "Força maior ou terceiros"]);
    expect(campo!.value).toBe("");
    expect(texto($("[data-gaveta-atraso]"))).toContain("De quem foi a causa");
    // o campo vem logo abaixo do motivo, e tem o ⓘ explicando a que a marcação serve
    expect($$("[data-gaveta-atraso] [data-dica]").length).toBeGreaterThanOrEqual(2);
  });

  it("o motivo SUGERE a causa — e a sugestão fica à vista, com a explicação do que ela quer dizer", async () => {
    await abrir(OS());
    await clicar($("[data-justificar-atraso]"));

    await escolher("[data-motivo]", "CLIENTE_AUSENTE");
    expect($<HTMLSelectElement>("[data-responsavel]")!.value).toBe("CLIENTE");
    expect(texto($("[data-ajuda-responsavel]"))).toBe(AJUDA_RESPONSABILIDADE_ATRASO.CLIENTE);

    await escolher("[data-motivo]", "CLIMA");
    expect($<HTMLSelectElement>("[data-responsavel]")!.value).toBe("TERCEIROS");
    expect(texto($("[data-ajuda-responsavel]"))).toBe(AJUDA_RESPONSABILIDADE_ATRASO.TERCEIROS);
  });

  it("motivo ambíguo não sugere nada: 'peça faltando' deixa a escolha com o gestor", async () => {
    await abrir(OS());
    await clicar($("[data-justificar-atraso]"));
    await escolher("[data-motivo]", "PECA_FALTANDO");
    expect($<HTMLSelectElement>("[data-responsavel]")!.value).toBe("");
    await escolher("[data-motivo]", "OUTRO");
    expect($<HTMLSelectElement>("[data-responsavel]")!.value).toBe("");
  });

  it("trocar para um motivo ambíguo LIMPA a sugestão do motivo anterior (ninguém salva sem olhar)", async () => {
    await abrir(OS());
    await clicar($("[data-justificar-atraso]"));
    await escolher("[data-motivo]", "ACESSO_NEGADO");          // sugere CLIENTE
    expect($<HTMLSelectElement>("[data-responsavel]")!.value).toBe("CLIENTE");
    await escolher("[data-motivo]", "PECA_FALTANDO");          // ambíguo: a causa anterior não fica
    expect($<HTMLSelectElement>("[data-responsavel]")!.value).toBe("");
    await clicar($("[data-salvar-atraso]"));
    expect(texto($("[data-erro-atraso]"))).toBe(MSG_ATRASO_SEM_RESPONSAVEL);
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);
  });

  it("a sugestão é só sugestão: trocar para outra causa é o que vai ao servidor", async () => {
    await abrir(OS());
    await clicar($("[data-justificar-atraso]"));
    await escolher("[data-motivo]", "CLIENTE_AUSENTE");   // sugere CLIENTE
    await escolher("[data-responsavel]", "INTERNA");      // o gestor viu que a culpa foi nossa
    await clicar($("[data-salvar-atraso]"));
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([
      { url: "/api/ordens/os1/atraso-justificado", metodo: "POST", corpo: { motivo: "CLIENTE_AUSENTE", responsavel: "INTERNA", observacao: "" } },
    ]);
  });

  it("sem escolher a causa o salvar não chama o servidor e diz o que falta", async () => {
    await abrir(OS());
    await clicar($("[data-justificar-atraso]"));
    await escolher("[data-motivo]", "PECA_FALTANDO");
    await clicar($("[data-salvar-atraso]"));
    expect(texto($("[data-erro-atraso]"))).toBe(MSG_ATRASO_SEM_RESPONSAVEL);
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);
    expect($("[data-gaveta-atraso]")).not.toBeNull(); // a gaveta fica aberta com o que já foi escolhido
  });

  it("a explicação continua obrigatória em \"Outro\" — a causa não substitui a razão", async () => {
    await abrir(OS());
    await clicar($("[data-justificar-atraso]"));
    await escolher("[data-motivo]", "OUTRO");
    await escolher("[data-responsavel]", "INTERNA");
    await clicar($("[data-salvar-atraso]"));
    expect(texto($("[data-erro-atraso]"))).toContain("Explique o motivo do atraso");
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);
  });
});

describe("A OS já justificada", () => {
  const JUSTIFICADA = {
    atrasoJustificadoMotivo: "ACESSO_NEGADO", atrasoResponsavel: "CLIENTE", atrasoJustificadoObs: "Sala trancada",
    atrasoJustificadoEm: "2026-11-14T14:00:00.000Z", atrasoJustificadoPor: { id: "u1", nome: "Gabi Gestora" },
  };

  it("mostra motivo · causa, a explicação e quem marcou", async () => {
    await abrir(OS(JUSTIFICADA));
    expect(texto($("[data-motivo-atraso]"))).toBe("Acesso ao local negado · Causa do cliente");
    expect($("[data-responsavel-atraso]")!.getAttribute("data-responsavel-atraso")).toBe("CLIENTE");
    expect(texto($("[data-obs-atraso]"))).toBe("Sala trancada");
    expect(texto($("[data-autor-atraso]"))).toContain("Gabi Gestora");
  });

  it("justificativa antiga (sem causa marcada) continua aparecendo, só sem a causa", async () => {
    await abrir(OS({ ...JUSTIFICADA, atrasoResponsavel: null }));
    expect(texto($("[data-motivo-atraso]"))).toBe("Acesso ao local negado");
    expect($("[data-responsavel-atraso]")).toBeNull();
  });

  it("\"Alterar\" reabre com o motivo e a causa que estão gravados", async () => {
    await abrir(OS(JUSTIFICADA));
    await clicar($("[data-alterar-atraso]"));
    expect($<HTMLSelectElement>("[data-motivo]")!.value).toBe("ACESSO_NEGADO");
    expect($<HTMLSelectElement>("[data-responsavel]")!.value).toBe("CLIENTE");
    expect($<HTMLTextAreaElement>("[data-observacao]")!.value).toBe("Sala trancada");
  });
});

describe("Quem vê o quê", () => {
  it("o gatilho ampliado: o chamado que estourou só o comparecer já oferece \"Justificar atraso\"", async () => {
    await abrir(SO_COMPARECER);
    expect($("[data-justificar-atraso]")).not.toBeNull();
    await clicar($("[data-justificar-atraso]"));
    expect($("[data-gaveta-atraso]")).not.toBeNull();
    expect($("[data-responsavel]")).not.toBeNull();
  });

  it("sem \"Desempenho › Revisar\": lê a justificativa, mas não justifica, altera nem desfaz", async () => {
    await abrir(OS({ atrasoJustificadoMotivo: "CLIMA", atrasoResponsavel: "TERCEIROS" }), SO_VE);
    expect(texto($("[data-motivo-atraso]"))).toBe("Chuva ou clima · Força maior ou terceiros");
    expect($("[data-alterar-atraso]")).toBeNull();
    expect($("[data-desfazer-atraso]")).toBeNull();
    expect($$("[data-justificar-atraso]")).toHaveLength(0);
  });

  it("sem nada descumprido, a gaveta nem aparece", async () => {
    await abrir(OS({ prazoExecucao: "2026-11-25T00:00:00.000Z", dataConclusao: null, status: "EM_ANDAMENTO" }));
    expect($("[data-justificar-atraso]")).toBeNull();
    expect($("[data-atraso-justificado]")).toBeNull(); // o bloco inteiro some
  });
});
