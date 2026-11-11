// @vitest-environment happy-dom
/**
 * Acabamento do Tema 6 — hora inválida ou vazia NÃO agenda mais às 08:00 em silêncio.
 * Antes: no calendário, hora vazia/inválida caía em 08:00; nos campos de data e hora, apagar a hora
 * gravava 08:00 e uma hora inválida deixava valendo a anterior. Agora, com data escolhida, o horário
 * é exigido: o campo fica em vermelho, o salvar é bloqueado com mensagem clara e nada é gravado.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { permissoesTotais } from "@/lib/permissoes";
import { MSG_HORA_INVALIDA, completarHora } from "@/components/ui/input-data-hora";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/calendario", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<typeof import("@/components/ui/avisos")>()), toast: vi.fn() }));

let root: Root; let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, { status: number; corpo: unknown }> = {};

beforeAll(async () => {
  await Promise.all([import("@/components/os/os-atividades"), import("@/components/calendario/calendario-grid"), import("@/components/orcamento/gerar-os"), import("@/components/providers/permissoes-provider")]);
}, 120_000);
beforeEach(() => {
  chamadas.length = 0; nav.push.mockClear();
  respostas = {
    "GET /api/tecnicos": { status: 200, corpo: [{ id: "t1", nome: "João Silva", competencias: [] }] },
    "GET /api/equipes": { status: 200, corpo: [{ id: "eq1", nome: "Alfa", cor: null, liderId: "t1", membroIds: ["t1"] }] },
    "GET /api/veiculos": { status: 200, corpo: [] },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const texto = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const botao = (rotulo: RegExp) => [...document.querySelectorAll("button")].find((b) => rotulo.test((b.textContent ?? "").trim())) as HTMLButtonElement | undefined;
async function montar(el: any) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
const sair = async (el: Element | null) => { await act(async () => { el!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); await esperar(); };
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const gravacoes = () => chamadas.filter((c) => c.metodo !== "GET");

describe("campo de data e hora (InputDataHora): com data, a hora é exigida", () => {
  const emitidos: string[] = []; const problemas: (string | null)[] = [];
  async function montarCampo(inicial = "") {
    emitidos.length = 0; problemas.length = 0;
    const { InputDataHora } = await import("@/components/ui/input-data-hora");
    function Caso() {
      const [v, setV] = useState(inicial);
      return createElement(InputDataHora, { value: v, onChange: (iso: string) => { emitidos.push(iso); setV(iso); }, onProblema: (p: string | null) => problemas.push(p), "aria-label": "Agendar para" });
    }
    await montar(createElement(Caso));
    return { dia: $<HTMLInputElement>("input[aria-label='Agendar para — data']")!, hora: $<HTMLInputElement>("input[aria-label='Agendar para — hora']")! };
  }

  it("ao escolher a data, a hora 08:00 entra À VISTA no campo (a pessoa vê e pode trocar) — nada escondido", async () => {
    const { dia, hora } = await montarCampo();
    expect(problemas.at(-1)).toBeNull(); // sem data não há o que exigir
    await digitar(dia, "17112026");
    expect(hora.value).toBe("08:00");
    expect(emitidos.at(-1)).toBe("2026-11-17T11:00:00.000Z"); // 08:00 de Brasília
    expect(problemas.at(-1)).toBeNull();
  });

  it("apagar a hora NÃO grava 08:00: nada novo é entregue, o formulário é avisado e o campo fica em vermelho", async () => {
    const { hora } = await montarCampo("2026-11-17T17:00:00.000Z"); // 14:00 de Brasília
    expect(hora.value).toBe("14:00");
    await digitar(hora, "");
    expect(emitidos).toEqual([]); // nem 08:00 escondido, nem mexe no que estava
    expect(problemas.at(-1)).toBe(MSG_HORA_INVALIDA);
    expect(hora.value).toBe(""); // o campo NÃO volta sozinho para 08:00
    await sair(hora);
    expect(hora.getAttribute("aria-invalid")).toBe("true");
    expect($("[data-hora-erro]")!.textContent).toBe("Informe um horário válido (hh:mm).");
  });

  it("hora que não existe (25:60): vermelho na hora, nada entregue (a hora anterior NÃO fica valendo calada)", async () => {
    const { hora } = await montarCampo("2026-11-17T17:00:00.000Z");
    await digitar(hora, "2560");
    expect(hora.getAttribute("aria-invalid")).toBe("true");
    expect(emitidos).toEqual([]);
    expect(problemas.at(-1)).toBe(MSG_HORA_INVALIDA);
  });

  it("corrigir libera: hora válida entrega o instante certo e o aviso some; '9' ao sair vira 09:00", async () => {
    const { hora } = await montarCampo("2026-11-17T17:00:00.000Z");
    await digitar(hora, "");
    await digitar(hora, "1530");
    expect(emitidos.at(-1)).toBe("2026-11-17T18:30:00.000Z");
    expect(problemas.at(-1)).toBeNull();
    expect($("[data-hora-erro]")).toBeNull();
    await digitar(hora, "9");
    expect(problemas.at(-1)).toBe(MSG_HORA_INVALIDA); // incompleta: ainda não vale
    await sair(hora);
    expect(hora.value).toBe("09:00");
    expect(emitidos.at(-1)).toBe("2026-11-17T12:00:00.000Z");
    expect(problemas.at(-1)).toBeNull();
  });

  it("apagar a DATA tira o agendamento (campo opcional continua opcional): entrega vazio e não há o que exigir", async () => {
    const { dia, hora } = await montarCampo("2026-11-17T17:00:00.000Z");
    await digitar(hora, "");
    expect(problemas.at(-1)).toBe(MSG_HORA_INVALIDA);
    await digitar(dia, "");
    expect(emitidos.at(-1)).toBe("");
    expect(problemas.at(-1)).toBeNull();
  });

  it("completar ao sair: '9' → 09:00, '930' → 09:30, '1830' → 18:30; '25' e '990' não viram hora", () => {
    expect(["9", "930", "1830", "25", "990", ""].map(completarHora)).toEqual(["09:00", "09:30", "18:30", null, null, null]);
  });
});

describe("calendário › Nova OS: sem horário válido não cria (antes caía em 08:00)", () => {
  async function abrirNovaOs() {
    const { CalendarioGrid } = await import("@/components/calendario/calendario-grid");
    const celulas = Array.from({ length: 7 }, (_, i) => ({ dateKey: `2026-11-${15 + i}`, dayNum: 15 + i, inMonth: true, isToday: false, rowIndex: 0 }));
    const opcoes = { clientes: [{ value: "c1", label: "Hospital Santa Luzia" }], tiposOs: [{ value: "tp1", label: "Preventiva" }], tecnicos: [{ value: "t1", label: "João Silva" }] };
    await montar(createElement(CalendarioGrid, { celulas, eventosPorDia: {}, opcoes } as any));
    await clicar($('[data-dia="2026-11-17"]'));
    expect(texto()).toContain("Nova OS");
    // preenche tudo o que é obrigatório: só a hora fica em jogo
    await clicar(botao(/Pesquisar cliente/));
    await clicar(botao(/^Hospital Santa Luzia$/));
    await clicar($("[data-seletor-equipe] button"));
    await clicar($('[data-opcao-equipe="eq1"]'));
    await digitar($("textarea"), "Limpeza dos filtros");
    return $<HTMLInputElement>('input[aria-label="Hora de agendamento"]')!;
  }
  const criarOs = () => clicar(botao(/^Criar OS$/));
  beforeEach(() => { respostas["POST /api/ordens"] = { status: 201, corpo: { id: "osNova", numero: "OS-900" } }; });

  it("a hora já vem 08:00 à vista; com ela a OS é criada às 08:00 de Brasília (escolha visível, não escondida)", async () => {
    const hora = await abrirNovaOs();
    expect(hora.value).toBe("08:00");
    await criarOs();
    expect(gravacoes()[0].corpo.execucao.dataAgendada).toBe("2026-11-17T11:00:00.000Z");
  });

  it("hora VAZIA: não cria, mostra a mensagem e marca o campo — nada de 08:00 escondido", async () => {
    const hora = await abrirNovaOs();
    await digitar(hora, "");
    await criarOs();
    expect(gravacoes()).toEqual([]);
    expect(texto()).toContain(MSG_HORA_INVALIDA);
    expect(hora.getAttribute("aria-invalid")).toBe("true");
  });

  it("hora INVÁLIDA (25:00, em vermelho): não cria; ao corrigir para 14:30 a mensagem some e cria no horário certo", async () => {
    const hora = await abrirNovaOs();
    await digitar(hora, "2500");
    expect(hora.getAttribute("aria-invalid")).toBe("true");
    await criarOs();
    expect(gravacoes()).toEqual([]);
    expect(texto()).toContain(MSG_HORA_INVALIDA);
    await digitar(hora, "1430");
    expect(texto()).not.toContain(MSG_HORA_INVALIDA);
    await criarOs();
    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0].url).toBe("/api/ordens");
    expect(gravacoes()[0].corpo.execucao.dataAgendada).toBe("2026-11-17T17:30:00.000Z"); // 14:30 de Brasília
  });

  it("'Criar e abrir' segue a mesma regra", async () => {
    const hora = await abrirNovaOs();
    await digitar(hora, "");
    await clicar(botao(/^Criar e abrir$/));
    expect(gravacoes()).toEqual([]);
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("atividade da OS: editar com a hora vazia ou inválida não salva", () => {
  const atividade = {
    id: "a1", titulo: "Preventiva", status: "AGENDADA", dataAgendada: "2026-11-17T17:00:00.000Z", prazo: null, duracaoMin: 60, observacao: null, resumo: null,
    tipoOs: null, tipoOsId: null, tecnicoId: "t1", tecnico: { id: "t1", nome: "João" }, equipe: null, tecnicosEquipe: [{ tecnico: { id: "t1", nome: "João" } }], veiculo: null, equipamentos: [],
  };
  async function abrirEdicao() {
    respostas["PUT /api/ordens/os1/atividades/a1"] = { status: 200, corpo: { dataAgendada: "2026-11-17T18:00:00.000Z" } };
    const { OsAtividades } = await import("@/components/os/os-atividades");
    await montar(createElement(OsAtividades, { osId: "os1", atividades: [atividade] }));
    await clicar([...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Preventiva")));
    await clicar($("button[title='Editar atividade']"));
    return $<HTMLInputElement>("input[aria-label='Data/hora agendada — hora']")!;
  }
  const salvar = () => clicar(botao(/^Salvar$/));

  it("apagar a hora e salvar: nada vai para o servidor (antes ia 08:00) e a tela diz o que falta", async () => {
    const hora = await abrirEdicao();
    expect(hora.value).toBe("14:00");
    await digitar(hora, "");
    await salvar();
    expect(gravacoes()).toEqual([]);
    expect(texto()).toContain(MSG_HORA_INVALIDA);
  });

  it("hora que não existe: não salva (antes salvava a hora ANTERIOR, calada); corrigida, salva a nova", async () => {
    const hora = await abrirEdicao();
    await digitar(hora, "2480");
    await salvar();
    expect(gravacoes()).toEqual([]);
    expect(texto()).toContain(MSG_HORA_INVALIDA);
    await digitar(hora, "1500");
    expect(texto()).not.toContain(MSG_HORA_INVALIDA);
    await salvar();
    expect(gravacoes()).toHaveLength(1);
    expect(gravacoes()[0].corpo.dataAgendada).toBe("2026-11-17T18:00:00.000Z"); // 15h de Brasília
  });
});

describe("gerar OS do orçamento: 'Agendar para' com data exige a hora", () => {
  async function abrir() {
    respostas["POST /api/orcamentos/orc1/gerar-os"] = { status: 201, corpo: { os: { id: "osNova", numero: "OS-2026-0042" }, jaExistia: false } };
    const { GerarOs } = await import("@/components/orcamento/gerar-os");
    await montar(createElement(GerarOs, { orcamentoId: "orc1", codigo: "ORC-0007", itens: 3, os: null, podeCriar: true, podeVer: true } as any));
    await clicar($("[data-gerar-os]"));
    await clicar($("[data-seletor-equipe] button"));
    await clicar($('[data-opcao-equipe="eq1"]'));
    return { dia: $<HTMLInputElement>("input[aria-label='Agendar para — data']")!, hora: $<HTMLInputElement>("input[aria-label='Agendar para — hora']")! };
  }
  const gerar = () => clicar($("[data-confirmar-gerar-os]"));

  it("sem data: gera sem agendar (o campo é opcional)", async () => {
    await abrir();
    await gerar();
    expect(gravacoes()[0].corpo.execucao.dataAgendada).toBeNull();
  });

  it("com data e a hora apagada: não gera e avisa; com 09:30, gera às 09:30 de Brasília", async () => {
    const { dia, hora } = await abrir();
    await digitar(dia, "17112026");
    expect(hora.value).toBe("08:00");
    await digitar(hora, "");
    await gerar();
    expect(gravacoes()).toEqual([]);
    expect(texto()).toContain(MSG_HORA_INVALIDA);
    await digitar(hora, "0930");
    await gerar();
    expect(gravacoes()[0].corpo.execucao.dataAgendada).toBe("2026-11-17T12:30:00.000Z");
  });
});

describe("trava: todo campo de data e hora avisa o formulário", () => {
  const RAIZ = path.resolve(__dirname, "../..");
  function arquivos(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? arquivos(p) : /\.tsx$/.test(e.name) ? [p] : [];
    });
  }

  it("cada <InputDataHora> das telas passa onProblema, e o formulário usa o aviso para não salvar", () => {
    const semAviso: string[] = []; let usos = 0;
    for (const arq of [...arquivos(path.join(RAIZ, "app")), ...arquivos(path.join(RAIZ, "components"))]) {
      const rel = path.relative(RAIZ, arq);
      if (rel === "components/ui/input-data-hora.tsx") continue;
      const fonte = fs.readFileSync(arq, "utf8");
      for (const m of fonte.matchAll(/<InputDataHora\b[\s\S]*?\/>/g)) {
        usos++;
        if (!/onProblema=/.test(m[0])) semAviso.push(rel);
      }
      if (/<InputDataHora\b/.test(fonte)) expect(fonte, rel).toMatch(/if \(horaRuim\w*\) \{ set\w+\(horaRuim\w*\); return; \}/);
    }
    expect(usos).toBeGreaterThanOrEqual(5);
    expect(semAviso).toEqual([]);
  });

  it("o calendário não tem mais o 'ou 08:00' no lugar da hora que faltou", () => {
    const fonte = fs.readFileSync(path.join(RAIZ, "components/calendario/calendario-grid.tsx"), "utf8");
    expect(fonte).not.toMatch(/hora \|\| "08:00"/);
    expect(fonte).toMatch(/if \(!horaValida\(hora\)\) \{ setFaltaHora\(true\); setErro\(MSG_HORA_INVALIDA\); return; \}/);
  });
});
